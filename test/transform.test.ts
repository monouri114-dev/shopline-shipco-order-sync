import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { buildShipcoOrder } from "@/lib/transform";
import { charLength } from "@/lib/text";
import type { RuntimeConfig } from "@/lib/config";

const runtime: RuntimeConfig = {
  ...config,
  shipco: {
    ...config.shipco,
    carrier: "yamato",
    service: "yamato_regular",
    warehouseId: "warehouse_123"
  },
  limits: {
    ...config.limits,
    name: 10,
    address1: 8,
    address2: 8,
    addressExtra: 8,
    deliveryNote: 180,
    productName: 10
  }
};

describe("buildShipcoOrder", () => {
  it("splits long Japanese addresses into Ship&Co address fields", () => {
    const result = buildShipcoOrder(
      {
        id: "SL-1",
        name: "#1001",
        financial_status: "paid",
        currency: "JPY",
        shipping_address: {
          name: "非常に長い名前のお客様テスト",
          country_code: "JP",
          zip: "1500001",
          province: "東京都",
          city: "渋谷区",
          address1: "神宮前一丁目一番一号とても長い建物名",
          address2: "十二階千二百三十四号室追加情報"
        },
        line_items: [{ name: "とても長い商品名サンプル", quantity: 1, price: "5000" }]
      },
      runtime
    );

    expect(charLength(result.order.to_address.full_name || "")).toBeLessThanOrEqual(10);
    expect(charLength(result.order.to_address.address1)).toBeLessThanOrEqual(8);
    expect(charLength(result.order.to_address.address2 || "")).toBeLessThanOrEqual(8);
    expect(charLength(result.order.to_address.extra || "")).toBeLessThanOrEqual(8);
    expect(result.order.setup.delivery_note).toContain("Address overflow");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("keeps non-JP city separate and uses province codes", () => {
    const result = buildShipcoOrder(
      {
        id: "SL-2",
        financial_status: "paid",
        shipping_address: {
          name: "Jean Dupont",
          country_code: "US",
          province: "California",
          province_code: "CA",
          city: "Los Angeles",
          address1: "123 Long Street",
          address2: "Suite 400"
        },
        line_items: [{ name: "Shirt", quantity: 2, price: 20 }]
      },
      runtime
    );

    expect(result.order.to_address.country).toBe("US");
    expect(result.order.to_address.province).toBe("CA");
    expect(result.order.to_address.city).toBe("Los Angeles");
    expect(result.order.products[0].quantity).toBe(2);
  });

  it("copies the China unified social credit code to Ship&Co consignee tax id", () => {
    const result = buildShipcoOrder(
      {
        id: "SL-CN-1",
        financial_status: "paid",
        shipping_address: {
          name: "Li Wei",
          company: "Shanghai Sample Trading Co Ltd",
          country_code: "CN",
          province: "Shanghai",
          city: "Shanghai",
          address1: "100 Century Avenue",
          zip: "200120",
          phone: "+8613800138000"
        },
        custom_attributes: [
          {
            name: "Please enter your company number / unified social",
            value: "91310000625910362F"
          }
        ],
        line_items: [{ name: "Sample item", quantity: 1, price: 1000 }]
      },
      runtime
    );

    expect(result.order.to_address.country).toBe("CN");
    expect(result.order.setup.consignee_tax_id).toBe("91310000625910362F");
  });
});
