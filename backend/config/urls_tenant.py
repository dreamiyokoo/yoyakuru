"""
テナントスキーマ用 URL 設定（{subdomain}.dreami.blog で動作）

TenantMainMiddleware がサブドメインからテナントを解決したとき使われる。
"""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path


def health(request):
    return JsonResponse(
        {
            "service": "yoyakuru-backend",
            "schema": request.tenant.schema_name,
            "tenant": request.tenant.name,
            "status": "ok",
        }
    )


urlpatterns = [
    path("admin/", admin.site.urls),
    path("", health),
]
