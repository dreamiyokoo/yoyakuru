"""店舗利用者（オーナー・スタッフ）のログイン（LOGIN-07）。

セッション認証。CookieはDjangoが発行したホスト（app.）限定で、親ドメインには出さない（TENANT-03）。
二段階認証を有効にした利用者は、パスワードの後に認証アプリのコード（または回復コード）を求める。
オーナーは二段階認証が必須で、設定が済むまで店舗の管理APIを使えない。
"""

import time

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.stores.models import Membership

from . import two_factor

PENDING_KEY = "two_factor_pending"
PENDING_SECONDS = 300


def me_payload(user) -> dict:
    memberships = (
        Membership.objects.filter(user=user, is_active=True, tenant__is_active=True)
        .select_related("tenant")
        .order_by("tenant__name")
    )
    return {
        "two_factor_enabled": two_factor.enabled_for(user),
        "two_factor_required": two_factor.required_for(user),
        "email": user.email,
        "name": user.get_full_name() or user.get_username(),
        "memberships": [
            {"subdomain": m.tenant.subdomain, "name": m.tenant.name, "role": m.role, "staff_id": m.staff_id}
            for m in memberships
        ],
    }


class CsrfView(APIView):
    """CSRFトークンのCookieを発行する。ログイン画面を開いたときに呼ぶ。"""

    permission_classes = [AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({})


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(max_length=200)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @method_decorator(csrf_protect)
    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        email, password = data.validated_data["email"], data.validated_data["password"]
        account = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
        user = authenticate(request, username=account.get_username(), password=password) if account else None
        if user is None:
            return Response({"code": "invalid_login", "message": "メールアドレスかパスワードが違います"}, status=400)
        if two_factor.enabled_for(user):
            # パスワードは合っている。まだログインさせず、認証アプリのコードを待つ
            request.session[PENDING_KEY] = {"user": user.pk, "at": int(time.time())}
            return Response({"two_factor_required": True})
        login(request, user)
        return Response(me_payload(user))


class CodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=20)


class LoginCodeView(APIView):
    """ログインの2段目。認証アプリの6桁のコードか、回復コードを受け付ける。"""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @method_decorator(csrf_protect)
    def post(self, request):
        data = CodeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        pending = request.session.get(PENDING_KEY) or {}
        expired = int(time.time()) - pending.get("at", 0) > PENDING_SECONDS
        user = get_user_model().objects.filter(pk=pending.get("user"), is_active=True).first()
        if user is None or expired:
            request.session.pop(PENDING_KEY, None)
            return Response({"code": "expired", "message": "最初からログインしてください"}, status=400)
        if not two_factor.verify(user, data.validated_data["code"]):
            return Response({"code": "invalid_code", "message": "コードが違います"}, status=400)
        request.session.pop(PENDING_KEY, None)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(me_payload(user))


class TwoFactorSetupView(APIView):
    """認証アプリに登録するためのQRコードと鍵を作る。確認（confirm）が済むまで有効にならない。"""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if two_factor.enabled_for(request.user):
            return Response({"code": "already_enabled", "message": "二段階認証は設定済みです"}, status=400)
        tf, uri, svg = two_factor.start_setup(request.user)
        return Response({"secret": tf.secret, "uri": uri, "qr_svg": svg})


class TwoFactorConfirmView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = CodeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        codes = two_factor.confirm(request.user, data.validated_data["code"])
        if codes is None:
            return Response(
                {"code": "invalid_code", "message": "コードが違います。認証アプリの最新のコードを入力してください"},
                status=400,
            )
        return Response({"recovery_codes": codes, **me_payload(request.user)})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(me_payload(request.user))


class RecoveryCodesView(APIView):
    """回復コードの再発行。今のコードで本人を確かめる。新しいコードは1回だけ返す。"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = CodeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        codes = two_factor.regenerate_recovery_codes(request.user, data.validated_data["code"])
        if codes is None:
            return Response({"code": "invalid_code", "message": "コードが違います"}, status=400)
        return Response({"recovery_codes": codes})


class TwoFactorResetView(APIView):
    """本人による二段階認証のやり直し（新しい端末に登録し直す）。今のコードか回復コードで確かめる。"""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = CodeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not two_factor.reset_with_code(request.user, data.validated_data["code"]):
            return Response({"code": "invalid_code", "message": "コードが違います"}, status=400)
        return Response(me_payload(request.user))
