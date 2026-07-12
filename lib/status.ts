import { config } from "./config";

export function getPublicRuntimeStatus() {
  return [
    { label: "Ship&Co token", ready: Boolean(config.shipco.apiToken) || config.shipco.dryRun },
    { label: "Ship&Co warehouse", ready: true },
    {
      label: "Shopline secret",
      ready: Boolean(config.shopline.appSecret) || config.shopline.allowUnverifiedWebhooks
    },
    { label: "Internal API key", ready: Boolean(config.internalApiKey) },
    { label: "Idempotency store", ready: config.idempotency.usesDurableStore }
  ];
}
