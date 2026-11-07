"""店舗のセルフ登録と、月額契約の支払い（BILL-01、BILL-04）。

登録 → 二段階認証の設定 → Stripe で支払い → 利用開始、の順に進む。
支払いが済むまでは、管理画面（お支払い以外）と公開予約ページを使えない。
"""

from __future__ import annotations

import logging

import stripe
from django.contrib.auth import get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.bookings.admin_api import TenantAdminView
from apps.core.auth_api import me_payload
from apps.stores.models import Membership, Role
from apps.tenants.models import Tenant, validate_subdomain

from . import stripe_api
from .models import Subscription

log = logging.getLogger(__name__)


class SignupSerializer(serializers.Serializer):
    store_name = serializers.CharField(max_length=100)
    subdomain = serializers.CharField(max_length=32)
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(max_length=200)

    def validate_subdomain(self, value: str) -> str:
        value = value.strip().lower()
        try:
            validate_subdomain(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.messages[0]) from e
        if Tenant.objects.filter(subdomain=value).exists():
            raise serializers.ValidationError("このURLは既に使われています")
        return value

    def validate_email(self, value: str) -> str:
        if get_user_model().objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("このメールアドレスは登録済みです。ログインしてください")
        return value

    def validate(self, attrs):
        try:
            validate_password(attrs["password"], get_user_model()(username=attrs["email"], email=attrs["email"]))
        except DjangoValidationError as e:
            raise serializers.ValidationError({"password": e.messages}) from e
        return attrs


class SignupView(APIView):
    """店舗とオーナーのアカウントを作り、ログインした状態にする。支払いはこの後。"""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "signup"

    @method_decorator(csrf_protect)
    def post(self, request):
        data = SignupSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        try:
            with transaction.atomic():
                tenant = Tenant.objects.create(name=v["store_name"].strip(), subdomain=v["subdomain"])
                Subscription.objects.create(tenant=tenant)
                user = get_user_model().objects.create_user(
                    username=v["email"], email=v["email"], password=v["password"], first_name=v["name"].strip()
                )
                Membership.objects.create(tenant=tenant, user=user, role=Role.OWNER)
        except IntegrityError:
            # 同時に同じURL・メールアドレスで登録された
            return Response({"code": "conflict", "message": "このURLかメールアドレスは既に使われています"}, status=409)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(me_payload(user), status=201)


def billing_payload(sub: Subscription | None) -> dict:
    return {
        "status": sub.status if sub else "none",
        "usable": sub is None or sub.usable,
        "current_period_end": sub.current_period_end if sub else None,
        "cancel_at_period_end": bool(sub and sub.cancel_at_period_end),
        "manageable": bool(sub and sub.stripe_customer_id),
        "configured": stripe_api.configured(),
        "price_label": stripe_api.plan_label(),
    }


class PlanView(APIView):
    """LP に出す料金の表記（ログイン不要）。"""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_read"

    def get(self, request):
        return Response({"price_label": stripe_api.plan_label()})


class OwnerBillingView(TenantAdminView):
    # 支払いが済んでいなくても使える（ここで支払う）
    allow_unpaid = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not self.is_owner:
            raise PermissionDenied("お支払いはオーナーだけが扱えます")
        self.sub = Subscription.objects.filter(tenant=self.tenant).first()

    def stripe_error(self):
        return Response(
            {"code": "stripe_error", "message": "決済サービスに接続できませんでした。時間をおいてお試しください"},
            status=502,
        )


class BillingView(OwnerBillingView):
    """契約の状態。支払い画面から戻ったとき（checkout_session）は、その場で Stripe と合わせる。"""

    def get(self, request, subdomain):
        session_id = request.query_params.get("checkout_session")
        if session_id and self.sub and stripe_api.configured():
            try:
                self.sub = stripe_api.sync_checkout_session(session_id, self.tenant) or self.sub
            except stripe.StripeError:
                log.warning("checkout session sync failed", exc_info=True)
            self.sub.refresh_from_db()
        return Response(billing_payload(self.sub))


class CheckoutView(OwnerBillingView):
    def post(self, request, subdomain):
        if self.sub is None or self.sub.usable:
            return Response({"code": "already_paid", "message": "お支払いは登録済みです"}, status=409)
        if not stripe_api.configured():
            return Response(
                {"code": "not_configured", "message": "お支払いの受付を準備中です。しばらくお待ちください"}, status=503
            )
        try:
            # 同時に押されても支払い画面を1つにする（二重の契約を防ぐ）
            with transaction.atomic():
                sub = Subscription.objects.select_for_update().get(pk=self.sub.pk)
                url = stripe_api.open_checkout_url(sub)
                sub.refresh_from_db()
                if sub.usable:
                    return Response({"code": "already_paid", "message": "お支払いは登録済みです"}, status=409)
                return Response({"url": url or stripe_api.create_checkout(sub, request.user.email)})
        except stripe.StripeError:
            log.warning("checkout create failed", exc_info=True)
            return self.stripe_error()


class PortalView(OwnerBillingView):
    def post(self, request, subdomain):
        if not (self.sub and self.sub.stripe_customer_id) or not stripe_api.configured():
            return Response({"code": "not_available", "message": "お支払いの情報がありません"}, status=409)
        try:
            return Response({"url": stripe_api.create_portal(self.sub)})
        except stripe.StripeError:
            log.warning("portal create failed", exc_info=True)
            return self.stripe_error()


@method_decorator(csrf_exempt, name="dispatch")
class WebhookView(APIView):
    """Stripe からの知らせ。署名を確かめてから、契約の状態を Stripe に合わせる。"""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        if not stripe_api.configured():
            return Response(status=503)
        try:
            event = stripe_api.construct_event(request.body, request.headers.get("Stripe-Signature", ""))
        except (ValueError, stripe.SignatureVerificationError):
            return Response(status=400)
        try:
            stripe_api.handle_event(event.to_dict())
        except stripe.StripeError:
            # Stripe が後でやり直す
            log.warning("webhook sync failed", exc_info=True)
            return Response(status=502)
        return Response({"received": True})
