import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getIdempotencyStore } from "@/lib/idempotency";
import { claimOneShotSlot, completeOneShotSlot, releaseOneShotSlot } from "@/lib/one-shot";
import { createShipcoOrder, ShipcoApiError } from "@/lib/shipco";
import {
  assertShoplineRequest,
  getHeader,
  isPaidOrder,
  parseShoplineOrder,
  shoplineIdempotencyKey,
  shoplineOrderReference
} from "@/lib/shopline";
import { buildShipcoOrder } from "@/lib/transform";

export const runtime = "nodejs";

function errorResponse(status: number, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, message, details }, { status });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = assertShoplineRequest(request.headers, rawBody);
  if (!auth.ok) return errorResponse(auth.status, auth.message);

  const topic = getHeader(request.headers, "x-shopline-topic");
  const webhookId = getHeader(request.headers, "x-shopline-webhook-id");
  const order = parseShoplineOrder(rawBody);

  if (!isPaidOrder(order, topic)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Order is not paid.",
      topic,
      financial_status: order.financial_status,
      pay_status: order.pay_status
    });
  }

  const idempotencyKey = shoplineIdempotencyKey(order, webhookId);
  if (!idempotencyKey) return errorResponse(400, "Cannot determine idempotency key.");

  const store = getIdempotencyStore();
  if (config.shipco.oneShot && !config.idempotency.usesDurableStore) {
    return errorResponse(
      500,
      "SHIPCO_ONE_SHOT requires KV_REST_API_URL and KV_REST_API_TOKEN in production."
    );
  }

  const reserved = await store.reserve(idempotencyKey);
  if (!reserved) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      reference: shoplineOrderReference(order)
    });
  }

  const oneShotClaim = await claimOneShotSlot(store);
  if (!oneShotClaim.allowed) {
    await store.markDone(idempotencyKey, {
      skipped: true,
      reason: "SHIPCO_ONE_SHOT has already sent one order."
    });

    return NextResponse.json({
      ok: true,
      skipped: true,
      one_shot: true,
      reason: "SHIPCO_ONE_SHOT has already sent one order. This order was not sent to Ship&Co.",
      reference: shoplineOrderReference(order)
    });
  }

  try {
    const transformed = buildShipcoOrder(order);
    const shipco = await createShipcoOrder(transformed.order);
    await store.markDone(idempotencyKey, shipco);
    await completeOneShotSlot(store, oneShotClaim, {
      reference: shoplineOrderReference(order),
      shipco
    });

    return NextResponse.json({
      ok: true,
      reference: shoplineOrderReference(order),
      shipco,
      one_shot: oneShotClaim.enabled ? { consumed: true } : undefined,
      warnings: transformed.warnings
    });
  } catch (error) {
    await store.release(idempotencyKey);
    await releaseOneShotSlot(store, oneShotClaim);
    if (error instanceof ShipcoApiError) {
      return errorResponse(error.status, error.message, error.responseBody);
    }

    return errorResponse(500, error instanceof Error ? error.message : "Unexpected error.");
  }
}
