# ヨヤクル フロントエンド（Next.js）

お客様向けの予約画面。デザインは [design-system/yoyakuru](../design-system/yoyakuru/MASTER.md) とFigmaのワイヤーフレームに従う。

## 画面

`src/proxy.ts` がホスト名で表示するサイトを決める（`{店舗名}.{NEXT_PUBLIC_BASE_DOMAIN}` は店舗の予約ページ）。

| 店舗のサブドメインのパス | 画面 |
|---|---|
| `/` | 予約（メニュー → 担当 → 日時 → お客様情報 → 確認 → 確認メール送信） |
| `/confirm?token=` | 確認メールのリンク。確定（カレンダーに追加）または期限切れ |
| `/cancel?token=` | 予約の取消。締切後は店舗の電話番号を案内 |

`app.{NEXT_PUBLIC_BASE_DOMAIN}` は店舗利用者の管理画面（他のホストでは404）。

| `app.` のパス | 画面 |
|---|---|
| `/login` | ログイン |
| `/bookings` | 予約一覧（今日・明日・今週） |
| `/bookings/new` | 予約の手入力 |
| `/bookings/{id}` | 予約の詳細、取消、日時・担当の変更（オーナーのみ） |
| `/calendar` | 日表示のカレンダー（担当者ごとの列） |
| `/time-off` | 休み・予約不可時間 |
| `/settings` | 設定（予約ルール・営業時間・サービス・担当者と勤務・設備）。オーナーのみ。予約に影響する変更は、保存前に一覧で確認する |

`/api/*` は `BACKEND_INTERNAL_URL` のDjangoへ中継する。

## 開発

```bash
npm install
BACKEND_INTERNAL_URL=http://localhost:8000 npm run dev
```

## テスト

```bash
npm run lint && npm run typecheck
npm run test:coverage   # 単体テスト（Vitest）
npm audit
npx playwright test     # E2E。Djangoとこのアプリを起動し、fushimi.localhost のデモ店舗で予約〜確定〜取消を確かめる
```

E2Eでは、確認メールを `E2E_MAIL_DIR` にファイルとして書き出し、リンクのトークンを読み取る。
