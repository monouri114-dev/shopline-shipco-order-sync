import { NextResponse } from "next/server";
import { getIdempotencyStore } from "@/lib/idempotency";
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
  const reserved = await store.reserve(idempotencyKey);
  if (!reserved) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      reference: shoplineOrderReference(order)
    });
  }

  try {
    const transformed = buildShipcoOrder(order);
    const shipco = await createShipcoOrder(transformed.order);
    await store.markDone(idempotencyKey, shipco);

    return NextResponse.json({
      ok: true,
      reference: shoplineOrderReference(order),
      shipco,
      warnings: transformed.warnings
    });
  } catch (error) {
    await store.release(idempotencyKey);
    if (error instanceof ShipcoApiError) {
      return errorResponse(error.status, error.message, error.responseBody);
    }

    return errorResponse(500, error instanceof Error ? error.message : "Unexpected error.");
  }
}
