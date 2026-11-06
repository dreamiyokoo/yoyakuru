from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from apps.core import auth_api
from apps.stores import invitations


def health(request):
    return JsonResponse({"service": "yoyakuru-backend", "status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health", health),
    path("api/v1/public/", include("apps.bookings.urls")),
    path("api/v1/admin/tenants/<slug:subdomain>/", include("apps.bookings.admin_urls")),
    path("api/v1/auth/csrf", auth_api.CsrfView.as_view()),
    path("api/v1/auth/login", auth_api.LoginView.as_view()),
    path("api/v1/auth/logout", auth_api.LogoutView.as_view()),
    path("api/v1/auth/me", auth_api.MeView.as_view()),
    path("api/v1/auth/invitations/<str:token>", invitations.InvitationView.as_view()),
    path("api/v1/auth/invitations/<str:token>/accept", invitations.AcceptInvitationView.as_view()),
]
