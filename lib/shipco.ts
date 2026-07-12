import { config } from "./config";
import type { ShipcoOrderRequest } from "./types";

export class ShipcoApiError extends Error {
  status: number;
  responseBody: unknown;

  constructor(status: number, responseBody: unknown) {
    super(`Ship&Co API request failed with status ${status}`);
    this.name = "ShipcoApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function createShipcoOrder(order: ShipcoOrderRequest) {
  if (config.shipco.dryRun) {
    return {
      dry_run: true,
      id: `DRY-RUN-${Date.now()}`,
      request: order
    };
  }

  if (!config.shipco.apiToken) {
    throw new Error("SHIPCO_API_TOKEN is not configured.");
  }

  const response = await fetch(`${config.shipco.apiUrl}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": config.shipco.apiToken
    },
    body: JSON.stringify(order)
  });
  const body = await parseResponse(response);

  if (!response.ok) {
    throw new ShipcoApiError(response.status, body);
  }

  return body;
}
