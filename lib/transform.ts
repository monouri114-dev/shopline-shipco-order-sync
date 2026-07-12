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
  return normalizeText(address.country_code || address.country || runtime.shipco.defaultCountry).toUpperCase();
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
    zip: normalizeText(address.zip) || undefined,
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

function buildProduct(item: ShoplineLineItem, runtime: RuntimeConfig, warnings: TransformWarning[]) {
  const rawName = normalizeText(item.name || item.title || item.sku) || "Item";
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
    price: numeric(item.price, 0)
  };

  const weight = convertWeightToGrams(item);
  if (weight !== undefined && weight > 0) product.weight = Math.round(weight);
  if (item.origin_country) product.origin_country = normalizeText(item.origin_country).toUpperCase();
  if (item.hs_code) product.hs_code = normalizeText(item.hs_code);
  if (item.hs_description) product.hs_description = normalizeText(item.hs_description);

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
      note: compactJoin([order.note, addressOverflow ? `Address overflow: ${addressOverflow}` : ""], " / ")
    },
    noteWarnings,
    runtime
  );

  warnings.splice(0, warnings.length, ...noteWarnings);

  const setup: ShipcoOrderRequest["setup"] = {
    carrier: runtime.shipco.carrier,
    service: runtime.shipco.service || undefined,
    currency: normalizeText(order.currency || runtime.shipco.currency) || runtime.shipco.currency,
    warehouse_id: runtime.shipco.warehouseId || undefined,
    ref_number: orderRef(order),
    delivery_note: deliveryNote || undefined,
    date: runtime.shipco.defaultShipDate || undefined,
    time: runtime.shipco.defaultTime || undefined,
    pack_size: runtime.shipco.defaultPackSize,
    pack_amount: runtime.shipco.defaultPackAmount
  };

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
      setup
    },
    warnings
  };
}

export function looksLikeShipcoOrder(value: unknown): value is ShipcoOrderRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShipcoOrderRequest>;
  return Boolean(candidate.to_address && Array.isArray(candidate.products) && candidate.setup);
}
