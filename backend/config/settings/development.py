from .base import *  # noqa: F401, F403

DEBUG = True

ALLOWED_HOSTS = ["*"]

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:8000",
    "https://dreami.blog",
    "https://*.dreami.blog",
]

# Cloudflare/Next.js プロキシ経由のリダイレクトループ防止（開発用）
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Next.js が X-Forwarded-Host でテナントを通知するため有効化
USE_X_FORWARDED_HOST = True
