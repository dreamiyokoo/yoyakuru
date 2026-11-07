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

INSTALLED_APPS = [
    # unfold は django.contrib.admin より前に必須
    "unfold",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.admin",
    "rest_framework",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "apps.core",
    "apps.tenants",
    "apps.stores",
    "apps.bookings",
    "apps.billing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Django は api.<BASE_DOMAIN>（API）と admin.<BASE_DOMAIN>（運営者用の管理画面）で動く。
# 店舗の判定はホスト名ではなく、公開APIはURLの店舗名、管理APIはログインユーザーの所属で行う。
ROOT_URLCONF = "config.urls"

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

# Database — 全店舗で1つのスキーマを使い、各データに店舗IDを持たせる（SCALE-02）
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "NAME": os.environ.get("DB_NAME", "yoyakuru_dev"),
        "USER": os.environ.get("DB_USER", "yoyakuru"),
        "PASSWORD": os.environ["DB_PASSWORD"],
    }
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # お客様向けAPIの呼び出し回数の上限（CUST-07、SCALE-05）
    "DEFAULT_THROTTLE_RATES": {
        "public_read": os.environ.get("THROTTLE_PUBLIC_READ", "120/min"),
        "public_hold": os.environ.get("THROTTLE_PUBLIC_HOLD", "10/hour"),
        "public_token": os.environ.get("THROTTLE_PUBLIC_TOKEN", "30/min"),
        "login": os.environ.get("THROTTLE_LOGIN", "10/min"),
        "signup": os.environ.get("THROTTLE_SIGNUP", "10/hour"),
        "public_chat": os.environ.get("THROTTLE_PUBLIC_CHAT", "20/hour"),
    },
}

# お客様へのメールに載せる予約ページのURL（店舗のサブドメイン）
PUBLIC_BOOKING_URL_TEMPLATE = os.environ.get("PUBLIC_BOOKING_URL_TEMPLATE", "https://{subdomain}." + TENANT_BASE_DOMAIN)

# セッションCookieは発行したホスト限定とし、親ドメインには発行しない（TENANT-03）
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_DOMAIN = None

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

# 店舗の利用者（オーナー・スタッフ）はGoogleでログインする。パスワードは持たない（LOGIN-07〜09）。
# Django の管理サイト（運営者用）だけは、従来どおりユーザー名とパスワードを使う
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
SOCIALACCOUNT_ONLY = True
ACCOUNT_EMAIL_VERIFICATION = "none"  # メールアドレスの確認はGoogleに任せる
SOCIALACCOUNT_ADAPTER = "apps.core.accounts.SocialAccountAdapter"
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_STORE_TOKENS = True  # カレンダーの更新用トークンを保存する
SOCIALACCOUNT_LOGIN_ON_GET = True  # 開始前に /api/v1/auth/google/start でCSRFを確かめている
LOGIN_REDIRECT_URL = "/api/v1/auth/google/done"
# Googleの認証へ移るパス。E2Eでは、Googleの代わりに疑似ログインへ移す
GOOGLE_LOGIN_PATH = "/accounts/google/login/?process=login"
# True なら、Googleを呼ばず空のカレンダーとして扱う（E2E専用。本番では使わない）
GOOGLE_FAKE = False
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {"client_id": GOOGLE_CLIENT_ID, "secret": GOOGLE_CLIENT_SECRET, "key": ""},
        # ログインとカレンダーの許可を1回で済ませる。権限は予定の閲覧・書き込みだけ（最小限）
        "SCOPE": ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events"],
        # 更新用のトークンを毎回受け取る（最初の1回しか返らないため）
        "AUTH_PARAMS": {"access_type": "offline", "prompt": "consent"},
        "OAUTH_PKCE_ENABLED": True,
    }
}

LANGUAGE_CODE = "ja"
TIME_ZONE = "Asia/Tokyo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 自由入力のチャット（CHAT-03〜07）。APIキーがなければAIを使わず、選択式の予約だけで動く（CHAT-02）
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL") or "gpt-4.1-mini"
CHAT_PROVIDER = os.environ.get("CHAT_PROVIDER", "")  # "fake" は開発・E2E用
CHAT_DAILY_LIMIT_PER_TENANT = int(os.environ.get("CHAT_DAILY_LIMIT_PER_TENANT") or 300)
# 設定用のAIの、店舗ごとの1日あたりの回数（SETUP-10）。お客様の利用量には数えない
SETUP_DAILY_LIMIT_PER_TENANT = int(os.environ.get("SETUP_DAILY_LIMIT_PER_TENANT") or 50)

# 管理画面のURL（招待メールのリンクに使う）
ADMIN_APP_URL = os.environ.get("ADMIN_APP_URL") or f"https://app.{TENANT_BASE_DOMAIN}"

# 店舗の月額契約（Stripe）。未設定なら登録はできるが、支払いの受付は「準備中」になる
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
# 料金の表記（LP・支払いの案内）。空なら Stripe の価格から作る（例：月額1,980円（税込））
PLAN_PRICE_LABEL = os.environ.get("PLAN_PRICE_LABEL", "")
