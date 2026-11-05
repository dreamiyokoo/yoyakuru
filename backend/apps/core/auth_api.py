"""店舗利用者（オーナー・スタッフ）のログイン（LOGIN-07）。

セッション認証。CookieはDjangoが発行したホスト（app.）限定で、親ドメインには出さない（TENANT-03）。
二段階認証（オーナー必須）は後続で追加する。
"""

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.stores.models import Membership


def me_payload(user) -> dict:
    memberships = (
        Membership.objects.filter(user=user, is_active=True, tenant__is_active=True)
        .select_related("tenant")
        .order_by("tenant__name")
    )
    return {
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
        login(request, user)
        return Response(me_payload(user))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(me_payload(request.user))
