"""店舗利用者（オーナー・スタッフ）のログイン。Googleアカウントだけで行う（LOGIN-07〜09）。

ログインとカレンダーの権限の許可は、Googleでの1回の認証で済ませる。パスワードは持たない。
流れは次のとおり：

1. 画面が `POST /api/v1/auth/google/start` で、目的（ログイン・新規登録・招待の受け入れ）をセッションに預ける
2. ブラウザを `/accounts/google/login/` へ移し、django-allauth がGoogleの認証を行う
3. 戻ってきたら `/api/v1/auth/google/done` で、預けた目的を実行して画面へ戻す

セッションCookieはDjangoが発行したホスト（app.）限定で、親ドメインには出さない（TENANT-03）。
"""

from django.conf import settings
from django.contrib.auth import logout
from django.core.exceptions import ObjectDoesNotExist
from django.http import HttpRequest, HttpResponseRedirect
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.stores.models import Membership

from . import accounts, google


def _subscription(tenant):
    try:
        return tenant.subscription
    except ObjectDoesNotExist:
        return None


def _usable(tenant) -> bool:
    sub = _subscription(tenant)
    return sub is None or sub.usable


def me_payload(user) -> dict:
    memberships = (
        Membership.objects.filter(user=user, is_active=True, tenant__is_active=True)
        .select_related("tenant", "tenant__subscription")
        .order_by("tenant__name")
    )
    return {
        "email": user.email,
        "name": user.get_full_name() or user.get_username(),
        "calendar_connected": google.connected(user),
        "memberships": [
            {
                "subdomain": m.tenant.subdomain,
                "name": m.tenant.name,
                "role": m.role,
                "staff_id": m.staff_id,
                # 支払いが済むまで、お支払い以外の管理画面は使えない
                "billing_required": not _usable(m.tenant),
                # Stripe で支払い情報を管理できるか（セルフ登録の店舗）
                "billing_managed": _subscription(m.tenant) is not None,
            }
            for m in memberships
        ],
    }


class CsrfView(APIView):
    """CSRFトークンのCookieを発行する。ログイン画面を開いたときに呼ぶ。"""

    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({})


class GoogleStartSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[accounts.LOGIN, accounts.SIGNUP, accounts.INVITE])
    store_name = serializers.CharField(max_length=100, required=False)
    subdomain = serializers.CharField(max_length=32, required=False)
    token = serializers.CharField(max_length=64, required=False)


class GoogleStartView(APIView):
    """Googleの認証を始める前に、目的を確かめてセッションに預ける。画面はこの後 /accounts/google/login/ へ移る。"""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @method_decorator(csrf_protect)
    def post(self, request):
        data = GoogleStartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        intent = accounts.prepare_intent(data.validated_data)
        request.session[accounts.INTENT_KEY] = intent
        return Response({"url": settings.GOOGLE_LOGIN_PATH})


def google_done(request: HttpRequest) -> HttpResponseRedirect:
    """Googleの認証から戻った直後。預けた目的を実行して、管理画面へ戻す。"""
    return HttpResponseRedirect(accounts.complete(request))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(me_payload(request.user))
