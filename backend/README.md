# ヨヤクル バックエンド（Django）

予約の空き判定・仮押さえ・確定・取消と、お客様向けの公開APIを提供する。要件は [docs/requirements.md](../docs/requirements.md) を参照。

## アプリの構成

| アプリ | 内容 |
|---|---|
| `apps.tenants` | 店舗（Tenant）と受付ルール。店舗のデータの基底クラス `TenantOwnedModel` |
| `apps.stores` | 担当者、設備、サービス、営業時間、臨時休業・特別営業、勤務と例外、休憩、休み、祝日、店舗の所属 |
| `apps.bookings` | 空き判定、予約（仮押さえ・確定・取消）、履歴、メール、予定ファイル、公開API |

運営者は `admin.` の管理画面（Unfold）から、店舗の設定と予約を確認・編集できる。

## 公開API（`/api/v1/public/`）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `tenants/{店舗名}/` | 店舗・サービス・担当者 |
| GET | `tenants/{店舗名}/availability?service=&date=&customer_type=&staff=` | 空き枠 |
| POST | `tenants/{店舗名}/bookings` | 15分の仮押さえ。確認メールを送る |
| POST | `tenants/{店舗名}/chat` | 自由入力の質問・予約の希望（CHAT-03〜07）。AIは店舗の登録内容（お客様への案内を含む）だけをもとに答え、メニュー・担当・日付の候補はサーバーで検証して空き枠と一緒に返す。予約の確定は通常の確認画面で行う。返す `chat_token` を仮押さえに付けると、AIが関わった予約（`ai_assisted`）として数える。APIキーがなければAIを使わず、選択肢と電話を案内する |
| POST | `bookings/confirm` | 確認メールのトークンで確定。予定ファイル付きのメールを送る |
| GET | `bookings/{token}` | 予約内容と取消の締切 |
| POST | `bookings/{token}/cancel` | 取消（締切まで） |
| GET | `bookings/{token}/ics` | 確定した予約の予定ファイル |
| GET | `calendar/{token}.ics` | 担当者ごとの読み取り専用カレンダー（CAL-06）。確定した予約の時間・メニュー・「予約あり」だけを載せる。お客様の名前は店舗の設定で載せられるが、連絡先は載せない（CAL-07） |

## 店舗利用者向けAPI

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/v1/auth/csrf` | CSRFトークンのCookieを発行 |
| POST | `/api/v1/auth/login`・`logout` | ログイン・ログアウト（セッション） |
| GET | `/api/v1/auth/me` | ログインユーザーと所属店舗 |
| GET | `/api/v1/admin/tenants/{店舗名}/options` | フォーム用のサービス・担当者と自分の権限 |
| GET・POST | `.../bookings` | 予約一覧（期間・担当で絞り込み）、手入力の予約（確定で作成） |
| GET | `.../bookings/{id}` | 予約の詳細と履歴 |
| POST | `.../bookings/{id}/cancel`・`reschedule` | 店舗による取消、日時・担当の変更（オーナーのみ） |
| GET | `.../availability`・`calendar` | 締切を適用しない空き枠、日表示のカレンダー |
| GET・POST・DELETE | `.../calendar-feed` | 自分（担当者）のカレンダー配信URLの確認・発行（再発行で古いURLは無効）・停止 |
| GET・POST・DELETE | `.../time-offs` | 休み・予約不可時間。登録時に影響を受ける予約を返す |
| GET・PUT・POST・PATCH・DELETE | `.../settings/*` | 設定（店舗・営業時間・休憩・臨時休業・設備・サービス・担当者・並び順・勤務・勤務の例外）。オーナーのみ。`?dry_run=1` は保存せず、新たに成り立たなくなる予約（`affected_bookings`）だけを返す。既存の予約は自動で取消さない |
| GET・POST | `.../settings/history`・`history/undo` | 設定の変更履歴（変更前の設定、変更した人、経路＝画面・AI・取り消し）と、直前の変更の取り消し（SETUP-07）。取り消しも `?dry_run=1` で影響を受ける予約を確認できる。あとから作られた担当者・サービスは停止し、使われていない設備は削除する |
| POST・GET | `.../settings/assistant`・`templates`・`templates/{key}` | AIで設定（SETUP）。店舗の様子や業種テンプレートから設定案を作り、設定APIへの手順（`steps`）として返す。ここでは何も保存しない。手順は画面で1つずつ確認し、上の設定APIで反映する。AIは決まった形の案しか作れず、契約・支払い・権限は扱えない。テンプレートはAIなしで使える |

所属していない店舗は403。スタッフは自分が担当する予約と自分の休みだけを扱える（3章の権限表）。

お客様へのメール（仮押さえ・確定・取消・変更）は Celery の worker が送る（`apps/bookings/tasks.py`）。送信に失敗したら間隔を空けて最大5回やり直す。依頼先の Redis に届かないときは、その場で送り、予約の処理は止めない。

期限切れの仮押さえは空き判定で自動的に除外される。記録の整理は `python manage.py expire_holds` で行う。

## 主な設計

- **空き判定**（`apps/bookings/availability.py`）：営業時間・勤務・休憩・休み・既存の予約・設備の数を同時に満たす枠だけを返す。準備時間を含めた占有時間は刻みの倍数に切り上げる。
- **二重予約の防止**（`apps/bookings/services.py`）：店舗の行をロックしてから空きを再確認する。同時に5件の予約を送っても1件だけが成立することをテストで確認している（AC-06）。
- **定員制の枠**（EXT-01）：データ構造と空き判定は対応済み。画面は後続。

## テスト

PostgreSQL 16 が必要。設定は `config.settings.test`（`pyproject.toml` で指定）。

```bash
pip install -r requirements-dev.txt
export DB_HOST=localhost DB_USER=postgres DB_PASSWORD=... DB_NAME=postgres
ruff check apps/stores apps/bookings tests && ruff format --check apps/stores apps/bookings tests
python -m pytest --cov --cov-fail-under=95
pip-audit -r requirements-dev.txt
```

開発・E2E用のデモ店舗は `python manage.py seed_demo`（`--reset` で作り直し）で作れる。`DEMO_USER_PASSWORD` を設定すると、オーナー（`owner@fushimi.example`）とスタッフ（`staff@fushimi.example`）のログインも作る。
