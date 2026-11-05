# ヨヤクル 素材一式（Issue #3）

カレンダー・吹き出し・チェックを組み合わせ、「予約・対話・受付」を表すマーク。配色は `pages/landing.md` に合わせ、シアン #0E7490 とグリーン #059669、文字 #164E63 を使用。

## 配置済みファイル

| パス | サイズ・形式 | 用途 |
|---|---|---|
| `frontend/public/brand/logo.svg` | SVG 400×110 | ヘッダー・フッター。文字はパス化済み |
| `frontend/public/brand/logo-white.svg` | SVG 400×110 | 濃い背景用の白抜き |
| `frontend/public/brand/mark.svg` | SVG 100×100 | シンボル原本 |
| `frontend/public/brand/logo-email.png` | PNG 480×132、透過 | メールでは240×66で表示 |
| `frontend/src/app/favicon.ico` | ICO 16・32・48px | ブラウザ用 |
| `frontend/src/app/icon.svg` | SVG 100×100 | Next.jsの自動アイコン |
| `frontend/src/app/apple-icon.png` | PNG 180×180、白背景・透過なし・角丸なし | Apple用 |
| `frontend/public/icons/icon-192.png` | PNG 192×192、白背景 | ホーム画面用 |
| `frontend/public/icons/icon-512.png` | PNG 512×512、白背景 | ホーム画面用 |
| `backend/apps/core/static/core/brand/mark.svg` | SVG 100×100 | Django用。マーク原本と同一 |
| `frontend/public/og/default.png` | PNG 1200×630、1MB以下 | サービス紹介のOGP |
| `frontend/public/og/store-base.png` | PNG 1200×630 | 店舗OGPの下地 |
| `frontend/public/lp/hero-pc.png` | PNG 920×840 | PCの460×420枠用 |
| `frontend/public/lp/hero-sp.png` | PNG 654×440 | スマホの327×220枠用 |

## 利用時の注意

- SVGロゴに `<text>`・フォント参照・外部リソースはない。フォント未導入の環境でも同じ形で表示できる。
- 白抜きロゴは #164E63 などの濃い背景に配置する。
- LP画像は実装前の独自画面モック。Figmaの書き出しや実装済み画面のスクリーンショットではない。画像内にも「画面イメージ」と記載。こもれび整体院・お客様名・予約はすべて架空。導入実績・お客様の声・価格は入れていない。
- 実装後、LP画像はデモ環境のスクリーンショットに差し替えられる。
- 店舗OGPの店舗名は未描画。実装側で **x=100〜1080、y=210〜400** の範囲に描画する（最大2行、長い名称は折り返し／文字サイズ調整）。上下左右60px以上の安全域を確保する。
- `public/og` 配置だけではOGPは出ない。ホスト別の `metadata` / `generateMetadata` で参照する。ホーム画面用PNGはmanifestから参照し、DjangoはUnfold等の設定からマークを参照する。これらの画面実装・設定変更は今回の素材追加には含めない。
- Basic認証が有効な開発環境ではSNS・メールから画像を取得できない。外部プレビュー確認は認証なしでアクセス可能な環境で行う。

## 原稿・再生成

- `wordmark.svg`：Noto Sans CJK JP Bold の「ヨヤクル」をアウトライン化した原稿。フォントファイルは同梱しない。
- `og-default.svg` / `og-store-base.svg` / `hero-pc.svg` / `hero-sp.svg`：PNGと対応する編集可能な原稿。SVG原稿の文字描画にはNoto Sans CJK JP / Noto Sans JPを使用。
- `scripts/generate-brand-assets.cjs`：ロゴと配信画像の生成スクリプト。Node.js、sharp、Noto Sans CJK JP（Regular / Bold）が必要。

```sh
# リポジトリルートから。アプリの依存関係は変更しない。
npm install --prefix /tmp/yoyakuru-asset-tools --no-save --package-lock=false sharp@0.34.5
NODE_PATH=/tmp/yoyakuru-asset-tools/node_modules node scripts/generate-brand-assets.cjs
```

PNGはそのまま使えるため、通常のアプリ起動・ビルドにsharpやフォントの追加は不要。
