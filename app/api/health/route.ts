import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "@/lib/status";

export const runtime = "nodejs";

export function GET() {
  const status = getPublicRuntimeStatus();
  const ready = status.every((item) => item.ready || item.label === "Idempotency store");

  return NextResponse.json({
    ok: ready,
    status
  });
}
