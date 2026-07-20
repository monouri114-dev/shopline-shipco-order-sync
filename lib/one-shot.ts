import { config, type RuntimeConfig } from "./config";
import type { IdempotencyStore } from "./idempotency";

type OneShotClaim =
  | { enabled: false; allowed: true }
  | { enabled: true; allowed: true; key: string }
  | { enabled: true; allowed: false; key: string };

function oneShotStoreKey(runtime: RuntimeConfig) {
  return `shipco:one-shot:${runtime.shipco.oneShotKey || "default"}`;
}

export async function claimOneShotSlot(
  store: IdempotencyStore,
  runtime: RuntimeConfig = config
): Promise<OneShotClaim> {
  if (!runtime.shipco.oneShot) return { enabled: false, allowed: true };

  const key = oneShotStoreKey(runtime);
  const reserved = await store.reserve(key);
  return reserved ? { enabled: true, allowed: true, key } : { enabled: true, allowed: false, key };
}

export async function completeOneShotSlot(
  store: IdempotencyStore,
  claim: OneShotClaim,
  result: unknown
) {
  if (claim.enabled && claim.allowed) {
    await store.markDone(claim.key, result);
  }
}

export async function releaseOneShotSlot(store: IdempotencyStore, claim: OneShotClaim) {
  if (claim.enabled && claim.allowed) {
    await store.release(claim.key);
  }
}
