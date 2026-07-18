function env(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name: string, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function numberEnv(name: string, fallback: number) {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberEnv(name: string) {
  const raw = env(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const kvUrl = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const kvToken = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");

export const config = {
  shipco: {
    apiToken: env("SHIPCO_API_TOKEN"),
    apiUrl: env("SHIPCO_API_URL", "https://api.shipandco.com/v1").replace(/\/+$/, ""),
    carrier: env("SHIPCO_DEFAULT_CARRIER", "yamato"),
    service: env("SHIPCO_DEFAULT_SERVICE", "yamato_regular"),
    currency: env("SHIPCO_DEFAULT_CURRENCY", "JPY"),
    warehouseId: env("SHIPCO_WAREHOUSE_ID"),
    defaultCountry: env("SHIPCO_DEFAULT_COUNTRY", "JP").toUpperCase(),
    defaultOriginCountry: env("SHIPCO_DEFAULT_ORIGIN_COUNTRY", "JP").toUpperCase(),
    defaultShipDate: env("SHIPCO_DEFAULT_SHIP_DATE"),
    defaultTime: env("SHIPCO_DEFAULT_TIME"),
    defaultPackSize: optionalNumberEnv("SHIPCO_DEFAULT_PACK_SIZE"),
    defaultPackAmount: optionalNumberEnv("SHIPCO_DEFAULT_PACK_AMOUNT"),
    defaultProductName: env("SHIPCO_DEFAULT_PRODUCT_NAME", "Trading cards (30packs)"),
    hongKongPostalCode: env("SHIPCO_HK_POSTAL_CODE", "999999"),
    usDdp: boolEnv("SHIPCO_US_DDP", true),
    dryRun: boolEnv("SHIPCO_DRY_RUN", false)
  },
  shopline: {
    appSecret: env("SHOPLINE_APP_SECRET"),
    allowedShopDomain: env("SHOPLINE_ALLOWED_SHOP_DOMAIN").toLowerCase(),
    allowUnverifiedWebhooks: boolEnv("ALLOW_UNVERIFIED_WEBHOOKS", false)
  },
  internalApiKey: env("INTERNAL_API_KEY"),
  limits: {
    name: numberEnv("MAX_NAME_CHARS", 35),
    company: numberEnv("MAX_COMPANY_CHARS", 35),
    address1: numberEnv("MAX_ADDRESS1_CHARS", 45),
    address2: numberEnv("MAX_ADDRESS2_CHARS", 45),
    addressExtra: numberEnv("MAX_ADDRESS_EXTRA_CHARS", 45),
    city: numberEnv("MAX_CITY_CHARS", 35),
    deliveryNote: numberEnv("MAX_DELIVERY_NOTE_CHARS", 250),
    productName: numberEnv("MAX_PRODUCT_NAME_CHARS", 80)
  },
  idempotency: {
    kvUrl,
    kvToken,
    ttlSeconds: numberEnv("IDEMPOTENCY_TTL_SECONDS", 60 * 60 * 24 * 30),
    usesDurableStore: Boolean(kvUrl && kvToken)
  }
} as const;

export type RuntimeConfig = typeof config;
