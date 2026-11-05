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
| POST | `bookings/confirm` | 確認メールのトークンで確定。予定ファイル付きのメールを送る |
| GET | `bookings/{token}` | 予約内容と取消の締切 |
| POST | `bookings/{token}/cancel` | 取消（締切まで） |
| GET | `bookings/{token}/ics` | 確定した予約の予定ファイル |

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

開発・E2E用のデモ店舗は `python manage.py seed_demo`（`--reset` で作り直し）で作れる。
