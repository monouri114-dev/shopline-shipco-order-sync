import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { createShipcoOrder, ShipcoApiError } from "@/lib/shipco";
import { buildShipcoOrder, looksLikeShipcoOrder } from "@/lib/transform";
import type { ShoplineOrder } from "@/lib/types";

export const runtime = "nodejs";

function errorResponse(status: number, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, message, details }, { status });
}

function authorized(request: Request) {
  const apiKey = request.headers.get("x-internal-api-key") || "";
  return Boolean(config.internalApiKey && apiKey === config.internalApiKey);
}

export async function POST(request: Request) {
  if (!authorized(request)) return errorResponse(401, "Invalid internal API key.");

  const body = (await request.json()) as unknown;
  const dryRunOnly =
    typeof body === "object" &&
    body !== null &&
    "dry_run" in body &&
    Boolean((body as { dry_run?: unknown }).dry_run);

  const payload =
    typeof body === "object" && body !== null && "order" in body
      ? (body as { order: unknown }).order
      : body;

  const transformed = looksLikeShipcoOrder(payload)
    ? { order: payload, warnings: [] }
    : buildShipcoOrder(payload as ShoplineOrder);

  if (dryRunOnly) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      request: transformed.order,
      warnings: transformed.warnings
    });
  }

  try {
    const shipco = await createShipcoOrder(transformed.order);
    return NextResponse.json({ ok: true, shipco, warnings: transformed.warnings });
  } catch (error) {
    if (error instanceof ShipcoApiError) {
      return errorResponse(error.status, error.message, error.responseBody);
    }

    return errorResponse(500, error instanceof Error ? error.message : "Unexpected error.");
  }
}
