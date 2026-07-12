import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import type { ShoplineOrder } from "./types";

function hmacSha256(rawBody: string, secret: string, encoding: "hex" | "base64") {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest(encoding);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyShoplineHmac(rawBody: string, signature: string, secret: string) {
  const received = signature.trim();
  if (!received || !secret) return false;

  const expectedHex = hmacSha256(rawBody, secret, "hex");
  const expectedBase64 = hmacSha256(rawBody, secret, "base64");

  return safeEqual(received.toLowerCase(), expectedHex) || safeEqual(received, expectedBase64);
}

export function getHeader(headers: Headers, name: string) {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? "";
}

export function assertShoplineRequest(headers: Headers, rawBody: string) {
  const shopDomain = getHeader(headers, "x-shopline-shop-domain").toLowerCase();
  if (config.shopline.allowedShopDomain && shopDomain !== config.shopline.allowedShopDomain) {
    return {
      ok: false as const,
      status: 403,
      message: `Unexpected SHOPLINE shop domain: ${shopDomain || "(missing)"}`
    };
  }

  if (config.shopline.allowUnverifiedWebhooks) {
    return { ok: true as const };
  }

  const signature = getHeader(headers, "x-shopline-hmac-sha256");
  const verified = verifyShoplineHmac(rawBody, signature, config.shopline.appSecret);
  if (!verified) {
    return { ok: false as const, status: 401, message: "Invalid SHOPLINE webhook signature." };
  }

  return { ok: true as const };
}

export function parseShoplineOrder(rawBody: string): ShoplineOrder {
  const parsed = JSON.parse(rawBody) as ShoplineOrder;
  return parsed;
}

export function isPaidOrder(order: ShoplineOrder, topic: string) {
  return (
    topic === "orders/paid" ||
    order.financial_status === "paid" ||
    order.pay_status === "paid"
  );
}

export function shoplineOrderReference(order: ShoplineOrder) {
  const id = order.id === undefined ? "" : String(order.id);
  const name = order.name || order.order_number;
  if (name && id) return `${String(name)} (${id})`;
  return String(name || id || "shopline-order");
}

export function shoplineIdempotencyKey(order: ShoplineOrder, webhookId: string) {
  if (order.id !== undefined && order.id !== null) return `shopline:order:${String(order.id)}:shipco`;
  if (webhookId) return `shopline:webhook:${webhookId}:shipco`;
  return "";
}
