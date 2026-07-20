# Shopline -> Ship&Co オーダー自動作成仕様

## 目的

Shoplineで支払い完了になった注文を、CSV手動アップロードではなくWebhook/APIで受信し、Ship&Co APIのオーダーとして自動登録する。

## 入力

- Shopline Webhook: `Order paid successfully` / `orders/paid`
- Webhook URL: `/api/shopline/webhook`
- 署名検証: `X-Shopline-Hmac-Sha256`
- 重複判定: Shopline注文IDを優先し、無ければ `X-Shopline-Webhook-Id`

`Order payment created` / `order_transactions/create` は支払い明細のWebhookであり、住所・商品を含む注文本体ではないため使用しない。

## 出力

- Ship&Co API: `POST https://api.shipandco.com/v1/orders`
- 認証ヘッダー: `x-access-token`
- 送信する主な項目:
  - `to_address`
  - `products`
  - `setup.carrier`
  - `setup.service`
  - `setup.currency`
  - `setup.warehouse_id` 任意。未設定時はShip&Coアプリ側のデフォルト倉庫を使用する。
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

## 中国向け会社番号・統一社会信用コード

Shoplineのチェックアウト追加項目 `Please enter your company number / unified social` に入力された値は、中国配送時のみShip&Coの `setup.consignee_tax_id` に送信する。

- 対象配送先国: `CN`
- Ship&Co送信先: `setup.consignee_tax_id`
- 目的: 中国向け国際配送の受取人/輸入者Tax IDとして保持する。
- ShoplineのWebhook payload上のフィールド名が多少変わっても拾えるように、`custom_attributes`、`additional_fields`、`note` などの注文データ内から該当ラベルを探索する。

## 旧CSV仕様から引き継いだ項目

- 香港配送は郵便番号を `999999` に固定する。
- アメリカ配送はShopline側で関税を徴収している前提で、Ship&Co APIの `customs.duty_paid` を `true` にする。
- 国際配送には `customs.content_type: MERCHANDISE` を付与する。
- Shoplineの配送方法名に `DHL`、`FedEx`、`UPS`、`EMS`、`Japan Post`、`Sagawa`、`Yamato` が含まれる場合、Ship&Coの `setup.carrier` へ反映する。
- 品目名は既定で `Trading cards (30packs)` を使用する。
- HSコードは `line_items[].harmonized_system_code` または `line_items[].hs_code` から取得する。
- 代表的なHSコードについては品目説明を補完する。
- VAT ID、Tax ID、EORIなどは国際配送時に `setup.consignee_tax_id` へ反映する。
- アメリカ配送の送料は、関税除外済みの値がある場合のみ `setup.shipping_fee` に反映する。
- `PayPal Fee`、`Handling fee`、`Payment fee` などの手数料明細は、Ship&Coの商品明細から除外する。
- Shopline注文番号はShip&Coの `setup.ref_number` に反映する。

旧CSV画面にあったタブUI、localStorage保存、注文番号直接指定は、自動Webhook連携では画面機能としては引き継がない。設定はVercelのEnvironment Variablesで管理し、対象注文はShoplineの支払い完了Webhookで自動的に受け取る。

## 重複登録防止

ShoplineのWebhookは再送される可能性があるため、同じ注文IDは一度だけShip&Coへ送る。

- 本番では Upstash Redis / Vercel KV REST を使う。
- `KV_REST_API_URL` と `KV_REST_API_TOKEN` が無い場合はローカルメモリで動く。
- Ship&Co APIが失敗した場合は予約状態を解除し、Shopline側の再送で再試行できる。

## 1件限定の本番送信テスト

本番切り替え前に、次に入った支払い済み注文を1件だけShip&Coへ送るための安全モードを用意する。

- `SHIPCO_ONE_SHOT=true` の場合、最初に受け取った支払い完了WebhookだけShip&Coへ送る。
- 1件送信後はKVに `SHIPCO_ONE_SHOT_KEY` ごとの記録を残し、後続注文はShip&Coへ送らず `skipped=true` で返す。
- Ship&Co API送信に失敗した場合は1件枠を解除し、次のWebhookで再試行できる。
- もう一度1件だけ送る場合は、`SHIPCO_ONE_SHOT_KEY` を別の値へ変更して再デプロイする。
- 安全に動かすため、`SHIPCO_ONE_SHOT=true` ではUpstash Redis / Vercel KV RESTが必須。

## 手動・内部API

`/api/shipco/order` は `x-internal-api-key` で保護された直接作成API。

- Shopline形式の注文JSONを渡すとShip&Co形式へ変換して作成する。
- Ship&Co形式のJSONをそのまま渡すこともできる。
- `dry_run: true` を付けるとShip&Coへ送らず、作成予定payloadだけ返す。
