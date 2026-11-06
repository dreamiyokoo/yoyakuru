"""店舗利用者の招待と、メンバーの停止（ADMIN-03）。

オーナーがメールアドレスと権限（オーナー・スタッフ）、担当者を指定して招待する。招待されたひとは、
メールのリンクからパスワードを決めて（すでにアカウントがあればそのパスワードで）参加する。
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.auth_api import me_payload

from .models import Invitation, Membership, Role, Staff

VALID_DAYS = 7


def invite_url(invitation: Invitation) -> str:
    return f"{settings.ADMIN_APP_URL}/invite?token={invitation.token}"


def send_invitation(invitation: Invitation) -> None:
    role = "オーナー" if invitation.role == Role.OWNER else "スタッフ"
    body = (
        f"{invitation.tenant.name}の管理画面（ヨヤクル）に、{role}として招待されました。\n\n"
        f"次のリンクを開いて、参加の手続きをしてください（{VALID_DAYS}日以内）。\n{invite_url(invitation)}\n\n"
        "心当たりがない場合は、このメールを破棄してください。\n"
    )
    EmailMessage(f"【{invitation.tenant.name}】ヨヤクルへの招待", body, to=[invitation.email]).send()


def is_open(invitation: Invitation) -> bool:
    return invitation.accepted_at is None and invitation.revoked_at is None and invitation.expires_at > timezone.now()


def invitation_payload(i: Invitation) -> dict:
    state = "accepted" if i.accepted_at else "revoked" if i.revoked_at else "open" if is_open(i) else "expired"
    return {
        "id": i.id,
        "email": i.email,
        "role": i.role,
        "staff": i.staff_id,
        "staff_name": i.staff.display_name if i.staff else "",
        "state": state,
        "expires_at": i.expires_at,
    }


def member_payload(m: Membership) -> dict:
    return {
        "id": m.id,
        "email": m.user.email,
        "name": m.user.get_full_name(),
        "role": m.role,
        "staff": m.staff_id,
        "staff_name": m.staff.display_name if m.staff else "",
        "is_active": m.is_active,
    }


# ---- オーナー向け（settings/ 配下。SettingsView でオーナーのみ）


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Role.choices, default=Role.STAFF)
    staff = serializers.IntegerField(required=False, allow_null=True)
    new_staff_name = serializers.CharField(max_length=50, required=False, allow_blank=True)


def create_invitation(view, request) -> Response:
    data = InviteSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    v = data.validated_data
    tenant = view.tenant
    email = v["email"].lower()
    if Membership.objects.filter(tenant=tenant, user__email__iexact=email, is_active=True).exists():
        raise serializers.ValidationError("このメールアドレスは、すでにこの店舗のメンバーです")
    with transaction.atomic():
        staff = None
        if v.get("staff"):
            staff = get_object_or_404(Staff.objects.for_tenant(tenant), pk=v["staff"])
            if Membership.objects.filter(staff=staff, is_active=True).exists():
                raise serializers.ValidationError("この担当者には、すでにログインする人がいます")
        elif v.get("new_staff_name", "").strip():
            count = Staff.objects.for_tenant(tenant).count()
            staff = Staff.objects.create(tenant=tenant, display_name=v["new_staff_name"].strip(), priority=count + 1)
        elif v["role"] == Role.STAFF:
            raise serializers.ValidationError("スタッフは、担当者を選ぶか新しく追加してください")
        # 同じ相手への未使用の招待は取り消し、新しい招待だけを有効にする
        Invitation.objects.for_tenant(tenant).filter(email__iexact=email, accepted_at=None, revoked_at=None).update(
            revoked_at=timezone.now()
        )
        invitation = Invitation.objects.create(
            tenant=tenant,
            email=email,
            role=v["role"],
            staff=staff,
            token=secrets.token_urlsafe(32),
            invited_by=request.user,
            expires_at=timezone.now() + timedelta(days=VALID_DAYS),
        )
    send_invitation(invitation)
    return Response(invitation_payload(invitation), status=status.HTTP_201_CREATED)


# ---- 招待されたひと向け（ログイン不要。トークンで確認する）


def _open_invitation(token: str) -> Invitation:
    invitation = Invitation.objects.filter(token=token).select_related("tenant", "staff").first()
    if invitation is None or not is_open(invitation) or not invitation.tenant.is_active:
        raise NotFound("この招待は無効か、期限が切れています")
    return invitation


class InvitationView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def get(self, request, token):
        i = _open_invitation(token)
        has_account = get_user_model().objects.filter(email__iexact=i.email, is_active=True).exists()
        return Response(
            {
                "tenant": i.tenant.name,
                "email": i.email,
                "role": i.role,
                "staff_name": i.staff.display_name if i.staff else "",
                "has_account": has_account,
            }
        )


class AcceptSerializer(serializers.Serializer):
    password = serializers.CharField(max_length=200)
    name = serializers.CharField(max_length=100, required=False, allow_blank=True)


class AcceptInvitationView(APIView):
    """招待を受け入れて参加し、そのままログインする。アカウントがなければ作る。"""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, token):
        data = AcceptSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        password = data.validated_data["password"]
        with transaction.atomic():
            i = _open_invitation(token)
            Invitation.objects.select_for_update().get(pk=i.pk)
            users = get_user_model().objects
            account = users.filter(email__iexact=i.email, is_active=True).first()
            if account:
                user = authenticate(request, username=account.get_username(), password=password)
                if user is None:
                    return Response({"code": "invalid_login", "message": "パスワードが違います"}, status=400)
            else:
                try:
                    validate_password(password)
                except DjangoValidationError as e:
                    return Response({"code": "weak_password", "message": " ".join(e.messages)}, status=400)
                user = users.create_user(username=i.email, email=i.email, password=password)
                if name := data.validated_data.get("name", "").strip():
                    user.first_name = name[:150]
                    user.save(update_fields=["first_name"])
            Membership.objects.update_or_create(
                tenant=i.tenant, user=user, defaults={"role": i.role, "staff": i.staff, "is_active": True}
            )
            i.accepted_at = timezone.now()
            i.save(update_fields=["accepted_at"])
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(me_payload(user))
