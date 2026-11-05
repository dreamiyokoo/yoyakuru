# ヨヤクル バックエンド（Django）

予約の空き判定・仮押さえ・確定・取消と、お客様向けの公開APIを提供する。要件は [docs/requirements.md](../docs/requirements.md) を参照。

## 開発環境

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DJANGO_DEBUG=1 POSTGRES_HOST=localhost POSTGRES_PORT=5432
python manage.py migrate
python manage.py runserver
```

PostgreSQL 16 が必要（同時予約の排他にトランザクションと行ロックを使う）。

## テスト

```bash
ruff check . && ruff format --check .
python -m pytest --cov --cov-fail-under=95
pip-audit -r requirements-dev.txt
```

## 公開API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/public/stores/{slug}/` | 店舗・サービス・担当者 |
| GET | `/api/public/stores/{slug}/availability?service=&date=&customer_type=&staff=` | 空き枠 |
| POST | `/api/public/stores/{slug}/bookings` | 15分の仮押さえ。確認メールを送る |
| POST | `/api/public/bookings/confirm` | 確認メールのトークンで確定。予定ファイル付きのメールを送る |
| GET | `/api/public/bookings/{token}` | 予約内容と取消の締切 |
| POST | `/api/public/bookings/{token}/cancel` | 取消（締切まで） |

期限切れの仮押さえは空き判定で自動的に除外される。記録の整理は `python manage.py expire_holds` で行う。

## 主な設計

- 空き判定（`bookings/availability.py`）：営業時間・勤務・休憩・休み・既存の予約・設備の数を同時に満たす枠だけを返す。準備時間を含めた占有時間は刻みの倍数に切り上げる。
- 二重予約の防止（`bookings/services.py`）：店舗の行をロックしてから空きを再確認する。同時に5件の予約を送っても1件だけが成立することをテストで確認している。
- 定員制の枠（EXT-01）：データ構造と空き判定は対応済み。画面は後続。
