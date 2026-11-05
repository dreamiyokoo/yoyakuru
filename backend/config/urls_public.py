"""
public スキーマ用 URL 設定（admin.dreami.blog で動作）

TenantMainMiddleware が HOST ヘッダーから public テナントを判定したとき使われる。
"""

from apps.tenants.admin_site import public_admin_site
from django.http import JsonResponse
from django.urls import path


def health(request):
    return JsonResponse({"service": "yoyakuru-backend", "schema": "public", "status": "ok"})


urlpatterns = [
    path("admin/", public_admin_site.urls),
    path("", health),
]
