from allauth.socialaccount.providers.google.provider import GoogleProvider
from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns
from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from apps.billing import views as billing
from apps.core import auth_api
from apps.stores import invitations


def health(request):
    return JsonResponse({"service": "yoyakuru-backend", "status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health", health),
    # Googleの認証（django-allauth）のログインと戻り先だけ。パスワードのログイン画面などは公開しない
    path("accounts/", include(default_urlpatterns(GoogleProvider))),
    path("api/v1/public/", include("apps.bookings.urls")),
    path("api/v1/admin/tenants/<slug:subdomain>/billing", billing.BillingView.as_view()),
    path("api/v1/admin/tenants/<slug:subdomain>/billing/checkout", billing.CheckoutView.as_view()),
    path("api/v1/admin/tenants/<slug:subdomain>/billing/portal", billing.PortalView.as_view()),
    path("api/v1/admin/tenants/<slug:subdomain>/", include("apps.bookings.admin_urls")),
    path("api/v1/billing/stripe-webhook", billing.WebhookView.as_view()),
    path("api/v1/public/plan", billing.PlanView.as_view()),
    path("api/v1/auth/csrf", auth_api.CsrfView.as_view()),
    path("api/v1/auth/google/start", auth_api.GoogleStartView.as_view()),
    path("api/v1/auth/google/done", auth_api.google_done),
    path("api/v1/auth/logout", auth_api.LogoutView.as_view()),
    path("api/v1/auth/me", auth_api.MeView.as_view()),
    path("api/v1/auth/invitations/<str:token>", invitations.InvitationView.as_view()),
]

if settings.GOOGLE_FAKE:  # E2E専用。Googleの代わりに、決めたメールアドレスでログインする
    from apps.core import e2e

    urlpatterns.append(path("api/v1/auth/e2e/google", e2e.fake_google_login))
