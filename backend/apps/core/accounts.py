"""Googleログインの前後の処理（django-allauth のアダプタと、戻ってきた後の仕上げ）。

ログイン、店舗の新規登録（オーナー）、招待の受け入れ（スタッフ）の3つを、同じGoogleログインで行う。
Googleの認証の前に「目的」をセッションに預け、戻ってきたら実行する。目的がないまま初めてログイン
するGoogleアカウントは、利用者を作らずに断る。
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode

from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import logout
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.http import HttpRequest, HttpResponseRedirect
from rest_framework import serializers

from apps.billing.models import Subscription
from apps.stores.invitations import InvitationError, accept_invitation, open_invitation
from apps.stores.models import Membership, Role, Staff
from apps.tenants.models import Tenant, validate_subdomain

from . import google

log = logging.getLogger(__name__)

INTENT_KEY = "auth_intent"
LOGIN, SIGNUP, INVITE = "login", "signup", "invite"


def login_error(code: str) -> str:
    return f"/login?{urlencode({'error': code})}"


def prepare_intent(v: dict) -> dict:
    """画面から受け取った目的を確かめる。問題があれば、Googleに行く前に画面へ知らせる。"""
    kind = v["kind"]
    if kind == SIGNUP:
        if not (v.get("store_name", "").strip() and v.get("subdomain")):
            raise serializers.ValidationError("店舗名とURLを入力してください")
        subdomain = v["subdomain"].strip().lower()
        try:
            validate_subdomain(subdomain)
        except DjangoValidationError as e:
            raise serializers.ValidationError({"subdomain": e.messages[0]}) from e
        if Tenant.objects.filter(subdomain=subdomain).exists():
            raise serializers.ValidationError({"subdomain": "このURLは既に使われています"})
        return {"kind": SIGNUP, "store_name": v["store_name"].strip(), "subdomain": subdomain}
    if kind == INVITE:
        try:
            open_invitation(v.get("token", ""))
        except InvitationError as e:
            raise serializers.ValidationError(e.message) from e
        return {"kind": INVITE, "token": v["token"]}
    return {"kind": LOGIN}


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def pre_social_login(self, request, sociallogin):
        """目的なしに初めてログインするGoogleアカウントからは、利用者を作らない。"""
        if sociallogin.is_existing:
            return
        if (request.session.get(INTENT_KEY) or {}).get("kind") not in (SIGNUP, INVITE):
            raise ImmediateHttpResponse(HttpResponseRedirect(login_error("not_registered")))

    def on_authentication_error(self, request, provider, error=None, exception=None, extra_context=None):
        log.warning("google login failed: %s %s", error, exception)
        request.session.pop(INTENT_KEY, None)
        code = "cancelled" if str(error) == "cancelled" else "failed"
        raise ImmediateHttpResponse(HttpResponseRedirect(login_error(code)))


def create_store(user, store_name: str, subdomain: str) -> Tenant:
    """店舗とオーナーを作る。オーナー本人も担当者として登録する（支払いはこの後）。"""
    with transaction.atomic():
        tenant = Tenant.objects.create(name=store_name, subdomain=subdomain)
        Subscription.objects.create(tenant=tenant)
        staff = Staff.objects.create(tenant=tenant, display_name=user.get_full_name() or user.email.split("@")[0])
        Membership.objects.create(tenant=tenant, user=user, role=Role.OWNER, staff=staff)
    return tenant


def complete(request: HttpRequest) -> str:
    """Googleの認証が済んだ後の仕上げ。管理画面の中で戻る先のパスを返す。"""
    intent = request.session.pop(INTENT_KEY, None) or {"kind": LOGIN}
    user = request.user
    if not user.is_authenticated:
        return login_error("failed")

    def refuse(code: str) -> str:
        logout(request)
        return login_error(code)

    try:
        google.verify_calendar(user)  # カレンダーの権限を外してログインされていないか
    except google.Disconnected:
        return refuse("calendar")
    except google.Unavailable:
        return refuse("failed")

    if intent["kind"] == SIGNUP:
        try:
            create_store(user, intent["store_name"], intent["subdomain"])
        except IntegrityError:  # 認証している間に、同じURLが使われた
            return refuse("taken")
        return "/"
    if intent["kind"] == INVITE:
        try:
            accept_invitation(user, intent["token"])
        except InvitationError as e:
            return refuse(e.code)
        return "/"
    if not Membership.objects.filter(user=user, is_active=True, tenant__is_active=True).exists():
        return refuse("not_registered")
    return "/"
