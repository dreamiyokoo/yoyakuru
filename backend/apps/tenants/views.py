from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Tenant


@api_view(["GET"])
@permission_classes([AllowAny])
def public_tenant(request, subdomain: str):
    """公開予約ページ用の店舗情報。停止中・存在しない店舗は404（TENANT-02）。"""
    tenant = get_object_or_404(Tenant, subdomain=subdomain, is_active=True)
    return Response({"name": tenant.name, "subdomain": tenant.subdomain})
