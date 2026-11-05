import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]

DEBUG = False

TENANT_BASE_DOMAIN = os.environ.get("TENANT_BASE_DOMAIN", "dreami.blog")

ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "").split() or [
    f".{TENANT_BASE_DOMAIN}",
    TENANT_BASE_DOMAIN,
    "localhost",
    "127.0.0.1",
]

# django-tenants: SHARED_APPS は public スキーマに配置される
SHARED_APPS = [
    "django_tenants",
    "apps.tenants",
    "apps.core",
    # unfold は django.contrib.admin より前に必須
    "unfold",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.admin",
]

# django-tenants: TENANT_APPS はテナントスキーマごとに配置される
# （空だと起動できないため contenttypes を置く。予約機能のアプリはここに追加する）
TENANT_APPS = [
    "django.contrib.contenttypes",
]

INSTALLED_APPS = list(SHARED_APPS) + [
    app for app in TENANT_APPS if app not in SHARED_APPS
]

TENANT_MODEL = "tenants.Tenant"
TENANT_DOMAIN_MODEL = "tenants.Domain"

MIDDLEWARE = [
    "django_tenants.middleware.main.TenantMainMiddleware",  # 先頭に必須
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# public スキーマ（admin.<BASE_DOMAIN>）用 URL
PUBLIC_SCHEMA_URLCONF = "config.urls_public"
# テナントスキーマ（*.<BASE_DOMAIN>）用 URL
ROOT_URLCONF = "config.urls_tenant"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database — django-tenants PostgreSQL バックエンド
DATABASES = {
    "default": {
        "ENGINE": "django_tenants.postgresql_backend",
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "NAME": os.environ.get("DB_NAME", "yoyakuru_dev"),
        "USER": os.environ.get("DB_USER", "yoyakuru"),
        "PASSWORD": os.environ["DB_PASSWORD"],
    }
}

DATABASE_ROUTERS = ["django_tenants.routers.TenantSyncRouter"]

UNFOLD = {
    "SITE_TITLE": "ヨヤクル 管理画面",
    "SITE_HEADER": "ヨヤクル",
}

# Celery（仮押さえの期限切れ・メール送信などのジョブ）
CELERY_BROKER_URL = os.environ["REDIS_URL"]

# メール（開発では Mailpit、本番では SES 等の SMTP）
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "25"))
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", f"noreply@{TENANT_BASE_DOMAIN}")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ja"
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
