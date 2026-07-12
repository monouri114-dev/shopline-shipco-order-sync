import { config } from "./config";

type StoreValue = {
  state: "processing" | "done";
  updatedAt: string;
  result?: unknown;
};

export interface IdempotencyStore {
  reserve(key: string): Promise<boolean>;
  markDone(key: string, result: unknown): Promise<void>;
  release(key: string): Promise<void>;
}

class MemoryStore implements IdempotencyStore {
  private values = new Map<string, { value: StoreValue; expiresAt: number }>();

  async reserve(key: string) {
    this.deleteExpired();
    if (this.values.has(key)) return false;
    this.values.set(key, {
      value: { state: "processing", updatedAt: new Date().toISOString() },
      expiresAt: Date.now() + config.idempotency.ttlSeconds * 1000
    });
    return true;
  }

  async markDone(key: string, result: unknown) {
    this.values.set(key, {
      value: { state: "done", updatedAt: new Date().toISOString(), result },
      expiresAt: Date.now() + config.idempotency.ttlSeconds * 1000
    });
  }

  async release(key: string) {
    this.values.delete(key);
  }

  private deleteExpired() {
    const now = Date.now();
    for (const [key, entry] of this.values.entries()) {
      if (entry.expiresAt <= now) this.values.delete(key);
    }
  }
}

class RedisRestStore implements IdempotencyStore {
  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  async reserve(key: string) {
    const result = await this.command([
      "SET",
      key,
      JSON.stringify({ state: "processing", updatedAt: new Date().toISOString() }),
      "EX",
      String(config.idempotency.ttlSeconds),
      "NX"
    ]);
    return result === "OK";
  }

  async markDone(key: string, result: unknown) {
    await this.command([
      "SET",
      key,
      JSON.stringify({ state: "done", updatedAt: new Date().toISOString(), result }),
      "EX",
      String(config.idempotency.ttlSeconds)
    ]);
  }

  async release(key: string) {
    await this.command(["DEL", key]);
  }

  private async command(command: string[]) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    });

    const body = (await response.json()) as { result?: unknown; error?: string };
    if (!response.ok || body.error) {
      throw new Error(`Idempotency store failed: ${body.error || response.statusText}`);
    }

    return body.result;
  }
}

const store: IdempotencyStore =
  config.idempotency.kvUrl && config.idempotency.kvToken
    ? new RedisRestStore(config.idempotency.kvUrl, config.idempotency.kvToken)
    : new MemoryStore();

export function getIdempotencyStore() {
  return store;
}
