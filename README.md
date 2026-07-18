# Shopline Ship&Co Order Sync

Shoplineの支払い完了Webhookを受け取り、Ship&Co APIでオーダーを作成するVercel向けNext.jsアプリです。

## 構成

- `POST /api/shopline/webhook`: Shopline `orders/paid` Webhookの受信口
- `POST /api/shipco/order`: 内部用の直接オーダー作成API
- `GET /api/health`: 環境変数の簡易チェック
- `/`: ランタイム状態の確認ページ

## セットアップ

```bash
npm.cmd install
copy .env.example .env.local
npm.cmd run dev
```

Vercelでは `.env.example` の値をEnvironment Variablesへ設定してください。

## 必須環境変数

- `SHIPCO_API_TOKEN`: Ship&Co APIトークン
- `SHOPLINE_APP_SECRET`: Shoplineアプリのsecret
- `INTERNAL_API_KEY`: `/api/shipco/order` 用の任意の共有キー

本番では、重複登録防止のため以下も設定してください。

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Vercel KV / Upstash Redis のREST URLとTokenに対応しています。

## Shopline側のWebhook

ShoplineのWebhookイベントは `orders/paid` を登録します。

Webhook URL:

```text
https://YOUR_DOMAIN/api/shopline/webhook
```

## 長い住所・氏名

Ship&Coや配送会社の住所欄には文字数制限があります。制限値は環境変数で調整できます。

```text
MAX_NAME_CHARS=35
MAX_COMPANY_CHARS=35
MAX_ADDRESS1_CHARS=45
MAX_ADDRESS2_CHARS=45
MAX_ADDRESS_EXTRA_CHARS=45
MAX_DELIVERY_NOTE_CHARS=250
```

日本住所は `city + address1 + address2` を `address1/address2/extra` に分割し、入りきらない原文は `setup.delivery_note` に保存します。短縮や分割が起きた場合はAPIレスポンスの `warnings` に出ます。

## 中国向けの会社番号 / Unified Social Credit Code

Shoplineのチェックアウト追加項目 `Please enter your company number / unified social` に入力された値は、中国配送時のみShip&Coの `setup.consignee_tax_id` に送信します。Ship&Co APIでは `consignee_tax_id` が受取人/輸入者のTax IDとして使われます。

## 旧CSV仕様から引き継いだ項目

- 香港配送は郵便番号を `999999` に固定します。
- アメリカ配送は `customs.duty_paid=true` としてDDP扱いにします。
- 配送方法名から `DHL`、`FedEx`、`UPS`、`EMS` などのキャリアを推定して `setup.carrier` に反映します。
- 品目名は既定で `Trading cards (30packs)` に固定します。
- HSコードは `harmonized_system_code` または `hs_code` から取得します。
- VAT ID / Tax ID / EORI は国際配送時に `setup.consignee_tax_id` へ反映します。

## Ship&Coの発送元倉庫

`SHIPCO_WAREHOUSE_ID` は任意です。空欄の場合、Ship&Coアプリ側で設定されているデフォルト倉庫が使われます。

## 直接APIの例

```bash
curl -X POST "https://YOUR_DOMAIN/api/shipco/order" \
  -H "content-type: application/json" \
  -H "x-internal-api-key: YOUR_INTERNAL_API_KEY" \
  -d "{\"dry_run\":true,\"order\":{\"id\":\"1001\",\"financial_status\":\"paid\",\"shipping_address\":{\"name\":\"山田 太郎\",\"country_code\":\"JP\",\"province\":\"東京都\",\"city\":\"渋谷区\",\"address1\":\"神宮前1-1-1\",\"zip\":\"1500001\",\"phone\":\"08012345678\"},\"line_items\":[{\"name\":\"商品A\",\"quantity\":1,\"price\":5000}]}}"
```

## 参考

- Ship&Co API docs: https://developer.shipandco.com/en/
- SHOPLINE order paid webhook: https://developer.shopline.com/docs/webhook/order/order-paid-successfully/
- SHOPLINE webhook overview: https://developer.shopline.com/docs/apps/api-instructions-for-use/webhooks/overview/
