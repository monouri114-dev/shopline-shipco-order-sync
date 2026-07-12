import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShoplineHmac } from "@/lib/shopline";

describe("verifyShoplineHmac", () => {
  it("accepts the hex digest used by SHOPLINE webhook examples", () => {
    const body = JSON.stringify({ id: "1001", financial_status: "paid" });
    const secret = "shopline-secret";
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");

    expect(verifyShoplineHmac(body, signature, secret)).toBe(true);
  });

  it("also accepts base64 signatures when a shop sends that format", () => {
    const body = JSON.stringify({ id: "1001", financial_status: "paid" });
    const secret = "shopline-secret";
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64");

    expect(verifyShoplineHmac(body, signature, secret)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const secret = "shopline-secret";
    const signature = createHmac("sha256", secret)
      .update(JSON.stringify({ id: "1001" }), "utf8")
      .digest("hex");

    expect(verifyShoplineHmac(JSON.stringify({ id: "1002" }), signature, secret)).toBe(false);
  });
});
