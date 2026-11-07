"""Googleログイン：ログイン・登録・招待の前後の処理。Googleの認証そのもの（allauth）は呼ばない。"""

from types import SimpleNamespace

import pytest
from allauth.core.exceptions import ImmediateHttpResponse
from rest_framework.test import APIClient

from apps.core import accounts, google
from apps.stores.models import Membership

from .conftest import user


def start(client, **body):
    return client.post("/api/v1/auth/google/start", body or {"kind": "login"}, format="json")


def test_start_hands_over_to_the_google_login(db):
    r = start(APIClient())
    assert r.status_code == 200 and r.json() == {"url": "/accounts/google/login/?process=login"}
    assert APIClient().post("/api/v1/auth/google/start", {"kind": "other"}, format="json").status_code == 400


def test_member_logs_in(owner):
    c = APIClient()
    start(c)
    c.force_login(owner)
    r = c.get("/api/v1/auth/google/done")
    assert r.status_code == 302 and r["Location"] == "/"
    me = c.get("/api/v1/auth/me").json()
    assert me["email"] == "owner@example.com" and "two_factor_enabled" not in me
    assert c.post("/api/v1/auth/logout").status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 403


def test_google_account_without_membership_is_refused(db):
    c = APIClient()
    start(c)
    c.force_login(user("stranger@example.com"))
    assert c.get("/api/v1/auth/google/done")["Location"] == "/login?error=not_registered"
    assert c.get("/api/v1/auth/me").status_code == 403


def test_done_without_authentication_goes_back_to_login(db):
    assert APIClient().get("/api/v1/auth/google/done")["Location"] == "/login?error=failed"


@pytest.mark.parametrize(("failure", "error"), [(google.Disconnected, "calendar"), (google.Unavailable, "failed")])
def test_login_requires_calendar_permission(owner, monkeypatch, failure, error):
    def deny(_):
        raise failure("x")

    monkeypatch.setattr(google, "verify_calendar", deny)
    c = APIClient()
    start(c)
    c.force_login(owner)
    assert c.get("/api/v1/auth/google/done")["Location"] == f"/login?error={error}"
    assert c.get("/api/v1/auth/me").status_code == 403


def test_intent_is_used_once(owner):
    c = APIClient()
    start(c, kind="signup", store_name="新店", subdomain="shinten")
    c.force_login(owner)
    assert c.get("/api/v1/auth/google/done")["Location"] == "/"
    assert c.get("/api/v1/auth/google/done")["Location"] == "/"  # 2回目は通常のログイン
    assert Membership.objects.filter(user=owner).count() == 2


class TestAdapter:
    def request(self, session=None):
        return SimpleNamespace(session=session or {})

    def test_unknown_google_account_without_intent_is_refused(self):
        with pytest.raises(ImmediateHttpResponse) as e:
            accounts.SocialAccountAdapter().pre_social_login(self.request(), SimpleNamespace(is_existing=False))
        assert e.value.response["Location"] == "/login?error=not_registered"

    @pytest.mark.parametrize("kind", ["signup", "invite"])
    def test_intent_allows_a_new_account(self, kind):
        req = self.request({accounts.INTENT_KEY: {"kind": kind}})
        accounts.SocialAccountAdapter().pre_social_login(req, SimpleNamespace(is_existing=False))

    def test_existing_account_passes(self):
        accounts.SocialAccountAdapter().pre_social_login(self.request(), SimpleNamespace(is_existing=True))

    @pytest.mark.parametrize(("error", "code"), [("cancelled", "cancelled"), ("unknown", "failed")])
    def test_authentication_error_goes_back_to_login(self, error, code):
        req = self.request({accounts.INTENT_KEY: {"kind": "signup"}})
        with pytest.raises(ImmediateHttpResponse) as e:
            accounts.SocialAccountAdapter().on_authentication_error(req, "google", error=error)
        assert e.value.response["Location"] == f"/login?error={code}"
        assert accounts.INTENT_KEY not in req.session


def test_google_login_redirect_asks_for_login_and_calendar_in_one_consent(db, settings):
    """allauth がGoogleへ送るURL：ログインとカレンダーの権限を1回で、更新用トークンつきで求める。"""
    from urllib.parse import parse_qs, urlparse

    settings.SOCIALACCOUNT_PROVIDERS["google"]["APP"]["client_id"] = "cid"
    c = APIClient()
    start(c)
    r = c.get("/accounts/google/login/?process=login")
    assert r.status_code == 302
    url = urlparse(r["Location"])
    q = parse_qs(url.query)
    assert url.netloc == "accounts.google.com" and q["client_id"] == ["cid"]
    assert set(q["scope"][0].split()) == {
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events",
    }
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
    assert q["redirect_uri"] == ["http://testserver/accounts/google/login/callback/"]


@pytest.fixture
def google_callback(db, settings, monkeypatch):
    """Googleの認証の往復を、Googleとの通信だけ置き換えて進める（allauth の本物の処理を通す）。"""
    from urllib.parse import parse_qs, urlparse

    from allauth.socialaccount.providers.google.provider import GoogleProvider
    from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
    from allauth.socialaccount.providers.oauth2.client import OAuth2Client

    settings.SOCIALACCOUNT_PROVIDERS["google"]["APP"]["client_id"] = "cid"
    monkeypatch.setattr(
        OAuth2Client,
        "get_access_token",
        lambda self, code, pkce_code_verifier=None: {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600},
    )

    def run(client, email):
        def complete_login(self, request, app, token, response=None, **kw):
            info = {
                "sub": f"sub-{email}",
                "email": email,
                "email_verified": True,
                "given_name": "花子",
                "family_name": "山田",
            }
            return GoogleProvider(request, app=app).sociallogin_from_response(request, info)

        monkeypatch.setattr(GoogleOAuth2Adapter, "complete_login", complete_login)
        state = parse_qs(urlparse(client.get("/accounts/google/login/?process=login")["Location"]).query)["state"][0]
        return client.get("/accounts/google/login/callback/", {"code": "c", "state": state})

    return run


def test_new_owner_signs_up_through_the_real_google_flow(google_callback):
    from allauth.socialaccount.models import SocialToken

    c = APIClient()
    start(c, kind="signup", store_name="新店", subdomain="shinten")
    r = google_callback(c, "new@example.com")
    assert r.status_code == 302 and r["Location"] == "/api/v1/auth/google/done"
    assert c.get(r["Location"])["Location"] == "/"
    m = Membership.objects.get(user__email="new@example.com")
    assert m.role == "owner" and m.tenant.subdomain == "shinten" and m.user.first_name == "花子"
    assert not m.user.has_usable_password()
    token = SocialToken.objects.get(account__user=m.user)
    assert token.token == "acc" and token.token_secret == "ref"  # 更新用のトークンを保存する
    assert google.connected(m.user)
    assert c.get("/api/v1/auth/me").json()["memberships"][0]["subdomain"] == "shinten"


def test_unknown_google_account_without_a_purpose_creates_no_user(google_callback):
    from django.contrib.auth import get_user_model

    c = APIClient()
    r = google_callback(c, "stranger@example.com")
    assert r["Location"] == "/login?error=not_registered"
    assert not get_user_model().objects.filter(email="stranger@example.com").exists()


def test_existing_member_logs_in_through_the_real_google_flow(google_callback, owner):
    from allauth.socialaccount.models import SocialAccount

    SocialAccount.objects.create(user=owner, provider="google", uid=f"sub-{owner.email}")
    c = APIClient()
    start(c)
    r = google_callback(c, owner.email)
    assert r["Location"] == "/api/v1/auth/google/done"
    assert c.get(r["Location"])["Location"] == "/"
    assert c.get("/api/v1/auth/me").json()["email"] == owner.email
