# Shopline -> Ship&Co オーダー自動作成仕様

## 目的

Shoplineで支払い完了になった注文を、CSV手動アップロードではなくWebhook/APIで受信し、Ship&Co APIのオーダーとして自動登録する。

## 入力

- Shopline Webhook: `orders/paid`
- Webhook URL: `/api/shopline/webhook`
- 署名検証: `X-Shopline-Hmac-Sha256`
- 重複判定: Shopline注文IDを優先し、無ければ `X-Shopline-Webhook-Id`

## 出力

- Ship&Co API: `POST https://api.shipandco.com/v1/orders`
- 認証ヘッダー: `x-access-token`
- 送信する主な項目:
  - `to_address`
  - `products`
  - `setup.carrier`
  - `setup.service`
  - `setup.currency`
  - `setup.warehouse_id`
  - `setup.ref_number`
  - `setup.delivery_note`

## 長い氏名・住所の扱い

配送会社やサービスごとに住所欄の最大長が異なるため、固定の文字数上限を環境変数で調整できるようにする。

- 氏名は `MAX_NAME_CHARS` で短縮する。
- 会社名は `MAX_COMPANY_CHARS` で短縮する。
- 日本住所は `city + address1 + address2` を結合し、`address1`、`address2`、`extra` に分割する。
- 海外住所は `address1 + address2` を分割し、`city` は別フィールドに保持する。
- 住所が3フィールドに収まらない場合、残りの原文を `setup.delivery_note` に保存する。
- 変更が発生した項目はレスポンスの `warnings` に返す。

## 重複登録防止

ShoplineのWebhookは再送される可能性があるため、同じ注文IDは一度だけShip&Coへ送る。

- 本番では Upstash Redis / Vercel KV REST を使う。
- `KV_REST_API_URL` と `KV_REST_API_TOKEN` が無い場合はローカルメモリで動く。
- Ship&Co APIが失敗した場合は予約状態を解除し、Shopline側の再送で再試行できる。

## 手動・内部API

`/api/shipco/order` は `x-internal-api-key` で保護された直接作成API。

- Shopline形式の注文JSONを渡すとShip&Co形式へ変換して作成する。
- Ship&Co形式のJSONをそのまま渡すこともできる。
- `dry_run: true` を付けるとShip&Coへ送らず、作成予定payloadだけ返す。
