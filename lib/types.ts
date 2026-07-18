export type JsonObject = Record<string, unknown>;

export type ShoplineAddress = {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  email?: string;
  phone?: string;
  country?: string;
  country_code?: string;
  province?: string;
  province_code?: string;
  standard_province_code?: string;
  city?: string;
  address1?: string;
  address2?: string;
  zip?: string;
};

export type ShoplineLineItem = {
  id?: string | number;
  name?: string;
  title?: string;
  sku?: string;
  quantity?: number | string;
  fulfillable_quantity?: number | string;
  price?: number | string;
  grams?: number | string;
  weight?: number | string;
  weight_unit?: string;
  required_shipping?: boolean;
  requires_shipping?: boolean;
  origin_country?: string;
  hs_code?: string;
  hs_description?: string;
};

export type ShoplineOrder = {
  [key: string]: unknown;
  id?: string | number;
  name?: string;
  order_number?: string | number;
  email?: string;
  phone?: string;
  note?: string;
  currency?: string;
  financial_status?: string;
  pay_status?: string;
  shipping_address?: ShoplineAddress;
  delivery_address?: ShoplineAddress;
  billing_address?: ShoplineAddress;
  customer?: {
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
  };
  line_items?: ShoplineLineItem[];
  shipping_lines?: Array<{
    title?: string;
    price?: string | number;
  }>;
};

export type ShipcoAddress = {
  full_name?: string;
  company?: string;
  email?: string;
  phone?: string;
  country: string;
  zip?: string;
  province?: string;
  city?: string;
  address1: string;
  address2?: string;
  extra?: string;
};

export type ShipcoProduct = {
  name: string;
  quantity: number;
  price: number;
  weight?: number;
  origin_country?: string;
  hs_code?: string;
  hs_description?: string;
};

export type ShipcoOrderRequest = {
  to_address: ShipcoAddress;
  products: ShipcoProduct[];
  setup: {
    carrier: string;
    service?: string;
    currency: string;
    warehouse_id?: string;
    ref_number?: string;
    delivery_note?: string;
    date?: string;
    time?: string;
    pack_size?: number;
    pack_amount?: number;
    [key: string]: unknown;
  };
  parcels?: Array<{
    width: number;
    height: number;
    depth: number;
    weight: number;
  }>;
  customs?: JsonObject;
};

export type TransformWarning = {
  field: string;
  message: string;
  original?: string;
  sent?: string;
};
