"""E2Eテスト専用：Googleの認証の代わりに、Cookie `e2e_google_email` のメールアドレスでログインする。

GOOGLE_FAKE=True の設定（config.settings.e2e）でだけURLに載る。本番の設定では存在しない。
本物と同じく、目的（ログイン・登録・招待）がなければ、初めてのメールアドレスは断る。
"""

from datetime import timedelta

from allauth.socialaccount.models import SocialAccount, SocialToken
from django.contrib.auth import get_user_model, login
from django.http import HttpRequest, HttpResponseRedirect
from django.utils import timezone

from . import accounts


def fake_google_login(request: HttpRequest) -> HttpResponseRedirect:
    email = request.COOKIES.get("e2e_google_email", "")
    users = get_user_model().objects
    user = users.filter(email__iexact=email).first()
    if user is None:
        if (request.session.get(accounts.INTENT_KEY) or {}).get("kind") not in (accounts.SIGNUP, accounts.INVITE):
            return HttpResponseRedirect(accounts.login_error("not_registered"))
        user = users.create_user(username=email, email=email, first_name="E2E")
    account, _ = SocialAccount.objects.get_or_create(user=user, provider="google", uid=email)
    SocialToken.objects.update_or_create(
        account=account,
        defaults={"token": "e2e", "token_secret": "e2e", "expires_at": timezone.now() + timedelta(days=365)},
    )
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponseRedirect("/api/v1/auth/google/done")
