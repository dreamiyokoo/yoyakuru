"""テスト用の設定。CIとローカルのテストで使う。"""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-insecure-key")
os.environ.setdefault("DB_PASSWORD", "")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from .base import *  # noqa: E402, F401, F403

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CELERY_TASK_ALWAYS_EAGER = True
PUBLIC_BOOKING_URL_TEMPLATE = "https://{subdomain}.yoyakuru.test"
OPENAI_API_KEY = ""  # テストで外部のAIを呼ばない
CHAT_PROVIDER = ""
ADMIN_APP_URL = "https://app.yoyakuru.test"
