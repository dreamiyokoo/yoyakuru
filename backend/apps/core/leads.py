"""LPの先行導入の申し込みを受け付ける（ログイン不要）。"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMessage
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Lead

log = logging.getLogger(__name__)

INDUSTRIES = ["整体・治療院", "美容院・サロン", "教室・スクール", "その他"]


class LeadSerializer(serializers.ModelSerializer):
    industry = serializers.ChoiceField(choices=INDUSTRIES, required=False, allow_blank=True)
    # ボット対策：画面には出さない欄。値が入っていたら保存しない
    website = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = Lead
        fields = ["store_name", "name", "email", "phone", "industry", "website"]


class LeadView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_hold"

    def post(self, request):
        data = LeadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        if v.pop("website", ""):
            return Response({}, status=status.HTTP_201_CREATED)  # ボットには成功に見せる
        lead = Lead.objects.create(**v)
        notify(lead)
        return Response({}, status=status.HTTP_201_CREATED)


def notify(lead: Lead) -> None:
    """運営に知らせる（LEAD_NOTIFY_EMAIL があるとき）。失敗しても申し込みは保存済み。"""
    to = settings.LEAD_NOTIFY_EMAIL
    if not to:
        return
    body = (
        f"お店：{lead.store_name}\nお名前：{lead.name}\nメール：{lead.email}\n"
        f"電話：{lead.phone or '—'}\n業種：{lead.industry or '—'}\n"
    )
    try:
        EmailMessage(f"【ヨヤクル】先行導入の申し込み：{lead.store_name}", body, to=[to]).send()
    except Exception:  # noqa: BLE001  通知の失敗で申し込みを失敗にしない
        log.exception("could not send lead notification for %s", lead.pk)
