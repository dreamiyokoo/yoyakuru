# 利用開始の画面（登録 → お支払い）の上書きルール

作成日：2026-11-07。MASTER.md に対し、`app.` の `/signup` と、利用開始前のお支払いの画面では次を優先する。
UI UX Pro Max の検索（`--domain ux`）：Progress Indicators、Password Visibility、Inline Validation（blur）、
Error Placement、Focusable Error Summary、Loading Buttons、Submit Feedback。

## 構成

- 共通の枠 `Onboarding`：ロゴ、手順（1. 登録 → 2. お支払い）、見出し、説明、白いカード。背景は #ECFEFF
- 利用を始めるまでは、管理画面のタブ・「追加」ボタンを出さない（押しても使えないため）。ログアウトだけ置く

## 入力

- ラベルは常に表示。エラーは欄のすぐ下に出し、`aria-describedby` でつなぐ
- 入力を終えた欄（blur）から確かめる。送れなかったときだけ、上にエラーの一覧（`role="alert"`）を出してフォーカスを移し、各欄へのリンクを置く
- パスワードは「表示／隠す」で切り替えられる（ボタンの名前に「パスワード」を含めない。ラベル検索とぶつかるため）
- 予約ページのURLは、入力欄の後ろに `.ドメイン` を続けて見せる
- 補足の文字は 14px 以上

## お支払い

- 料金の表記は Stripe の価格から作る（`GET /api/v1/public/plan`、`PLAN_PRICE_LABEL` で上書き可）。LP と同じ表記にする
- 「カード番号はヨヤクルに保存しない」ことを鍵のアイコンと一緒に、支払いボタンのすぐ下に書く
- 「登録だけでは料金はかかりません」を登録画面の説明に書く
