import { config, type RuntimeConfig } from "./config";
import {
  compactJoin,
  limitText,
  normalizeText,
  numeric,
  positiveInteger,
  splitText
} from "./text";
import type {
  ShipcoAddress,
  ShipcoOrderRequest,
  ShipcoProduct,
  ShoplineAddress,
  ShoplineLineItem,
  ShoplineOrder,
  TransformWarning
} from "./types";

export type BuildResult = {
  order: ShipcoOrderRequest;
  warnings: TransformWarning[];
};

function chooseAddress(order: ShoplineOrder): ShoplineAddress {
  return order.shipping_address || order.delivery_address || order.billing_address || {};
}

function countryCode(address: ShoplineAddress, runtime: RuntimeConfig) {
  const raw = normalizeText(address.country_code || address.country || runtime.shipco.defaultCountry).toUpperCase();
  const aliases: Record<string, string> = {
    CHINA: "CN",
    "MAINLAND CHINA": "CN",
    "PEOPLE'S REPUBLIC OF CHINA": "CN",
    "PEOPLES REPUBLIC OF CHINA": "CN",
    PRC: "CN",
    JAPAN: "JP",
    "UNITED STATES": "US",
    USA: "US",
    "UNITED KINGDOM": "GB",
    UK: "GB"
  };
  return aliases[raw] || raw;
}

function isChinaDestination(country: string) {
  return ["CN", "CHN", "CHINA"].includes(normalizeText(country).toUpperCase());
}

function provinceValue(address: ShoplineAddress, country: string) {
  if (country === "JP") return normalizeText(address.province || address.province_code);
  return normalizeText(address.standard_province_code || address.province_code || address.province);
}

function appendWarning(
  warnings: TransformWarning[],
  field: string,
  message: string,
  original: string,
  sent: string
) {
  if (original && original !== sent) {
    warnings.push({ field, message, original, sent });
  }
}

function buildDeliveryNote(
  order: ShoplineOrder,
  warnings: TransformWarning[],
  runtime: RuntimeConfig
) {
  const originalNote = normalizeText(order.note);
  const overflowParts = warnings
    .filter((warning) => warning.original && warning.sent)
    .map((warning) => `${warning.field} original: ${warning.original}`);
  const note = compactJoin([originalNote, ...overflowParts], " / ");
  const limited = limitText(note, runtime.limits.deliveryNote);

  if (limited.overflow) {
    warnings.push({
      field: "setup.delivery_note",
      message: "Delivery note exceeded the configured limit and was shortened.",
      original: note,
      sent: limited.value
    });
  }

  return limited.value;
}

function buildAddress(order: ShoplineOrder, runtime: RuntimeConfig, warnings: TransformWarning[]) {
  const address = chooseAddress(order);
  const country = countryCode(address, runtime);
  const fullNameRaw =
    normalizeText(address.name) ||
    compactJoin([address.first_name, address.last_name]) ||
    normalizeText(order.customer?.name) ||
    compactJoin([order.customer?.first_name, order.customer?.last_name]) ||
    normalizeText(order.email) ||
    "Shopline Customer";
  const companyRaw = normalizeText(address.company);

  const limitedName = limitText(fullNameRaw, runtime.limits.name);
  appendWarning(
    warnings,
    "to_address.full_name",
    "Recipient name exceeded the configured limit and was shortened.",
    fullNameRaw,
    limitedName.value
  );

  const limitedCompany = limitText(companyRaw, runtime.limits.company);
  appendWarning(
    warnings,
    "to_address.company",
    "Company name exceeded the configured limit and was shortened.",
    companyRaw,
    limitedCompany.value
  );

  const rawAddressText =
    country === "JP"
      ? compactJoin([address.city, address.address1, address.address2], "")
      : compactJoin([address.address1, address.address2], " ");
  const splitAddress = splitText(rawAddressText, [
    runtime.limits.address1,
    runtime.limits.address2,
    runtime.limits.addressExtra
  ]);

  if (splitAddress.overflow) {
    warnings.push({
      field: "to_address.address",
      message: "Address exceeded address1/address2/extra capacity; overflow was moved to delivery note.",
      original: rawAddressText,
      sent: splitAddress.parts.filter(Boolean).join(" / ")
    });
  }

  const limitedCity = limitText(address.city, runtime.limits.city);
  if (country !== "JP") {
    appendWarning(
      warnings,
      "to_address.city",
      "City exceeded the configured limit and was shortened.",
      normalizeText(address.city),
      limitedCity.value
    );
  }

  const toAddress: ShipcoAddress = {
    full_name: limitedName.value,
    company: limitedCompany.value || undefined,
    email: normalizeText(order.email || address.email || order.customer?.email) || undefined,
    phone: normalizeText(address.phone || order.phone || order.customer?.phone) || undefined,
    country,
    zip: country === "HK" ? runtime.shipco.hongKongPostalCode : normalizeText(address.zip) || undefined,
    province: provinceValue(address, country) || undefined,
    city: country === "JP" ? undefined : limitedCity.value || undefined,
    address1: splitAddress.parts[0] || "Address missing",
    address2: splitAddress.parts[1] || undefined,
    extra: splitAddress.parts[2] || undefined
  };

  if (!toAddress.full_name && !toAddress.company) {
    toAddress.full_name = "Shopline Customer";
  }

  return { toAddress, addressOverflow: splitAddress.overflow };
}

function orderShippingMethod(order: ShoplineOrder) {
  const shippingLine = order.shipping_lines?.[0];
  return compactJoin([shippingLine?.title, shippingLine?.code], " ");
}

function carrierFromShippingMethod(order: ShoplineOrder, runtime: RuntimeConfig) {
  const method = orderShippingMethod(order).toLowerCase();
  if (!method) return { carrier: runtime.shipco.carrier, service: runtime.shipco.service || undefined };

  if (method.includes("dhl")) return { carrier: "dhl", service: undefined };
  if (method.includes("fedex") || method.includes("fed ex")) {
    return { carrier: "fedex", service: undefined };
  }
  if (method.includes("ups")) return { carrier: "ups", service: undefined };
  if (method.includes("ems")) return { carrier: "japanpost", service: "japanpost_ems" };
  if (method.includes("japan post") || method.includes("japanpost")) {
    return { carrier: "japanpost", service: undefined };
  }
  if (method.includes("sagawa")) return { carrier: "sagawa", service: undefined };
  if (method.includes("yamato") || method.includes("kuroneko")) {
    return { carrier: "yamato", service: runtime.shipco.service || undefined };
  }

  return { carrier: runtime.shipco.carrier, service: runtime.shipco.service || undefined };
}

function shippingFee(order: ShoplineOrder, country: string) {
  if (order._pureShippingFee !== undefined) return numeric(order._pureShippingFee);
  if (country === "US") return undefined;

  const shippingLine = order.shipping_lines?.[0];
  const fee = numeric(shippingLine?.price ?? shippingLine?.shipping_price);
  return fee > 0 ? fee : undefined;
}

function convertWeightToGrams(item: ShoplineLineItem) {
  if (item.grams !== undefined) return numeric(item.grams);
  const weight = numeric(item.weight);
  if (!weight) return undefined;

  switch (normalizeText(item.weight_unit).toLowerCase()) {
    case "kg":
    case "zh_kg":
      return weight * 1000;
    case "lb":
      return weight * 453.59237;
    case "oz":
      return weight * 28.349523125;
    case "g":
    default:
      return weight;
  }
}

const hsDescriptionMap: Record<string, string> = {
  "9504400000": "Trading cards",
  "9504.40.0000": "Trading cards",
  "9503000090": "Toys and scale models",
  "9502100000": "Dolls and figures",
  "9503000000": "Toys",
  "9504300000": "Games"
};

function hsDescription(item: ShoplineLineItem, hsCode: string) {
  return normalizeText(item.hs_description) || hsDescriptionMap[hsCode] || (hsCode ? "Trading cards" : "");
}

function buildProduct(item: ShoplineLineItem, runtime: RuntimeConfig, warnings: TransformWarning[]) {
  const rawName =
    normalizeText(runtime.shipco.defaultProductName) ||
    normalizeText(item.name || item.title || item.sku) ||
    "Item";
  const limitedName = limitText(rawName, runtime.limits.productName);
  appendWarning(
    warnings,
    "products.name",
    "Product name exceeded the configured limit and was shortened.",
    rawName,
    limitedName.value
  );

  const product: ShipcoProduct = {
    name: limitedName.value,
    quantity: positiveInteger(item.quantity ?? item.fulfillable_quantity, 1),
    price: numeric(item.price_set?.presentment_money?.amount ?? item.price, 0)
  };

  const weight = convertWeightToGrams(item);
  if (weight !== undefined && weight > 0) product.weight = Math.round(weight);
  if (item.origin_country) product.origin_country = normalizeText(item.origin_country).toUpperCase();
  const hsCode = normalizeText(item.harmonized_system_code || item.hs_code);
  if (hsCode) product.hs_code = hsCode;
  const hsDesc = hsDescription(item, hsCode);
  if (hsDesc) product.hs_description = hsDesc;

  return product;
}

function buildProducts(order: ShoplineOrder, runtime: RuntimeConfig, warnings: TransformWarning[]) {
  const shippableItems = (order.line_items || []).filter((item) => {
    if (item.required_shipping === false || item.requires_shipping === false) return false;
    return positiveInteger(item.quantity ?? item.fulfillable_quantity, 0) > 0;
  });

  const products = shippableItems.map((item) => buildProduct(item, runtime, warnings));
  if (products.length > 0) return products;

  warnings.push({
    field: "products",
    message: "No shippable line items were found; a placeholder product was sent."
  });

  return [{ name: "Shopline order", quantity: 1, price: 0 }];
}

function orderRef(order: ShoplineOrder) {
  return normalizeText(order.name || order.order_number || order.id || "Shopline order");
}

const taxIdFieldPatterns = [
  /company\s*number/i,
  /unified\s*social/i,
  /social\s*credit/i,
  /uscc/i,
  /usci/i,
  /tax\s*id/i,
  /vat/i,
  /eori/i,
  /統一社会信用/,
  /统一社会信用/,
  /会社番号/,
  /企業番号/
];

const labelKeys = ["name", "label", "title", "key", "field", "field_name", "question"];
const valueKeys = ["value", "answer", "text", "content", "input", "field_value", "fieldValue"];

function taxIdFieldNameMatches(value: unknown) {
  const text = normalizeText(value);
  return Boolean(text && taxIdFieldPatterns.some((pattern) => pattern.test(text)));
}

function primitiveString(value: unknown) {
  if (["string", "number"].includes(typeof value)) return normalizeText(value);
  return "";
}

function valueFromLabeledObject(record: Record<string, unknown>) {
  const hasMatchingLabel = labelKeys.some((key) => taxIdFieldNameMatches(record[key]));
  if (!hasMatchingLabel) return "";

  for (const key of valueKeys) {
    const value = primitiveString(record[key]);
    if (value) return value;
  }

  return "";
}

function valueFromNote(note: unknown) {
  const text = normalizeText(note);
  if (!text) return "";

  const patterns = [
    /(?:company\s*number|unified\s*social|social\s*credit|uscc|usci|tax\s*id)\s*[:：]\s*([A-Z0-9][A-Z0-9 -]{5,40})/i,
    /(?:統一社会信用|统一社会信用|会社番号|企業番号)\s*[:：]\s*([A-Z0-9][A-Z0-9 -]{5,40})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeText(match[1]).replace(/\s+/g, "");
  }

  return "";
}

function findCustomFieldValue(value: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (!value || depth > 8 || seen.has(value)) return "";

  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) {
      const found = findCustomFieldValue(item, depth + 1, seen);
      if (found) return found;
    }
    return "";
  }

  if (typeof value !== "object") return "";

  seen.add(value);
  const record = value as Record<string, unknown>;
  const labeledValue = valueFromLabeledObject(record);
  if (labeledValue) return labeledValue;

  for (const [key, child] of Object.entries(record)) {
    if (taxIdFieldNameMatches(key)) {
      const directValue = primitiveString(child);
      if (directValue) return directValue;

      const nestedValue = findCustomFieldValue(child, depth + 1, seen);
      if (nestedValue) return nestedValue;
    }
  }

  for (const child of Object.values(record)) {
    const found = findCustomFieldValue(child, depth + 1, seen);
    if (found) return found;
  }

  return "";
}

function consigneeTaxId(order: ShoplineOrder) {
  return normalizeText(order._vatId) || valueFromNote(order.note) || findCustomFieldValue(order);
}

export function buildShipcoOrder(
  order: ShoplineOrder,
  runtime: RuntimeConfig = config
): BuildResult {
  const warnings: TransformWarning[] = [];
  const { toAddress, addressOverflow } = buildAddress(order, runtime, warnings);
  const products = buildProducts(order, runtime, warnings);
  const noteWarnings = [...warnings];
  if (addressOverflow) {
    noteWarnings.push({
      field: "to_address.address_overflow",
      message: "Address overflow was preserved in delivery note.",
      original: addressOverflow,
      sent: ""
    });
  }

  const deliveryNote = buildDeliveryNote(
    {
      ...order,
      note: compactJoin(
        [
          order.note,
          orderShippingMethod(order) ? `Shipping method: ${orderShippingMethod(order)}` : "",
          addressOverflow ? `Address overflow: ${addressOverflow}` : ""
        ],
        " / "
      )
    },
    noteWarnings,
    runtime
  );

  warnings.splice(0, warnings.length, ...noteWarnings);
  const shippingSetup = carrierFromShippingMethod(order, runtime);

  const setup: ShipcoOrderRequest["setup"] = {
    carrier: shippingSetup.carrier,
    service: shippingSetup.service,
    currency: normalizeText(order.currency || runtime.shipco.currency) || runtime.shipco.currency,
    warehouse_id: runtime.shipco.warehouseId || undefined,
    ref_number: orderRef(order),
    delivery_note: deliveryNote || undefined,
    date: runtime.shipco.defaultShipDate || undefined,
    time: runtime.shipco.defaultTime || undefined,
    pack_size: runtime.shipco.defaultPackSize,
    pack_amount: runtime.shipco.defaultPackAmount
  };

  const fee = shippingFee(order, toAddress.country);
  if (fee !== undefined) setup.shipping_fee = fee;

  const taxId = consigneeTaxId(order);
  if (taxId && toAddress.country !== "JP") {
    setup.consignee_tax_id = taxId;
  }

  Object.keys(setup).forEach((key) => {
    if (setup[key] === undefined || setup[key] === "") delete setup[key];
  });

  const isInternational = toAddress.country !== "JP";
  const normalizedProducts = products.map((product) => ({
    origin_country: isInternational ? runtime.shipco.defaultOriginCountry : undefined,
    ...product
  }));

  return {
    order: {
      to_address: toAddress,
      products: normalizedProducts,
      setup,
      customs:
        toAddress.country === "JP"
          ? undefined
          : {
              duty_paid: toAddress.country === "US" && runtime.shipco.usDdp,
              content_type: "MERCHANDISE"
            }
    },
    warnings
  };
}

export function looksLikeShipcoOrder(value: unknown): value is ShipcoOrderRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShipcoOrderRequest>;
  return Boolean(candidate.to_address && Array.isArray(candidate.products) && candidate.setup);
}
