"""E2Eテスト用の設定。確認メールをファイルに書き出し、テストがリンクを読み取る。"""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "e2e-only-insecure-key")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from .development import *  # noqa: E402, F401, F403

EMAIL_BACKEND = "django.core.mail.backends.filebased.EmailBackend"
EMAIL_FILE_PATH = os.environ.get("E2E_MAIL_DIR", "/tmp/yoyakuru-e2e-mail")
PUBLIC_BOOKING_URL_TEMPLATE = "http://{subdomain}.localhost:3000"
CSRF_TRUSTED_ORIGINS = [*CSRF_TRUSTED_ORIGINS, "http://app.localhost:3000"]  # noqa: F405
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "public_read": "10000/min",
        "public_hold": "10000/hour",
        "public_token": "10000/min",
        "login": "10000/min",
        "signup": "10000/hour",
        "public_chat": "10000/hour",
    },
}
CHAT_PROVIDER = "fake"
# Googleの認証とカレンダーは使わず、疑似ログイン（apps.core.e2e）と空のカレンダーで動かす
GOOGLE_FAKE = True
GOOGLE_LOGIN_PATH = "/api/v1/auth/e2e/google"
ADMIN_APP_URL = "http://app.localhost:3000"
# E2EではRedisとworkerを立てないので、メールの送信はその場で行う（本番はworkerが送る）
CELERY_TASK_ALWAYS_EAGER = True
