import time

import pyotp
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import two_factor
from apps.core.models import TwoFactor
from apps.stores.models import Membership, Role

from .conftest import client_for, user

BODY = {"email": "owner@example.com", "password": "pw-123456!"}
SECRET = "JBSWY3DPEHPK3PXP"


def code(secret=SECRET, offset=0):
    return pyotp.TOTP(secret).at(int(time.time()) + offset)


def test_owner_needs_a_code_after_the_password(owner):
    c = APIClient()
    r = c.post("/api/v1/auth/login", BODY, format="json").json()
    assert r == {"two_factor_required": True}
    assert c.get("/api/v1/auth/me").status_code == 403  # まだログインしていない
    r = c.post("/api/v1/auth/login/code", {"code": "000000"}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "invalid_code"
    r = c.post("/api/v1/auth/login/code", {"code": code()}, format="json")
    assert r.status_code == 200 and r.json()["two_factor_enabled"] is True
    assert c.get("/api/v1/admin/tenants/fushimi/options").status_code == 200


def test_a_code_cannot_be_reused(owner):
    c = APIClient()
    used = code()
    c.post("/api/v1/auth/login", BODY, format="json")
    assert c.post("/api/v1/auth/login/code", {"code": used}, format="json").status_code == 200
    c2 = APIClient()
    c2.post("/api/v1/auth/login", BODY, format="json")
    assert c2.post("/api/v1/auth/login/code", {"code": used}, format="json").status_code == 400


def test_pending_login_expires_and_is_required(owner, monkeypatch):
    c = APIClient()
    assert c.post("/api/v1/auth/login/code", {"code": code()}, format="json").json()["code"] == "expired"
    c.post("/api/v1/auth/login", BODY, format="json")
    later = time.time() + 301
    monkeypatch.setattr("apps.core.auth_api.time.time", lambda: later)
    assert c.post("/api/v1/auth/login/code", {"code": code()}, format="json").json()["code"] == "expired"


def test_owner_without_two_factor_must_set_it_up_before_managing(store, staff):
    u = user("new-owner@example.com")
    Membership.objects.create(tenant=store, user=u, role=Role.OWNER, staff=staff[0])
    c = client_for(u)
    me = c.get("/api/v1/auth/me").json()
    assert me["two_factor_required"] is True and me["two_factor_enabled"] is False
    r = c.get("/api/v1/admin/tenants/fushimi/options")
    assert r.status_code == 403 and "二段階認証" in r.json()["detail"]

    setup = c.post("/api/v1/auth/2fa/setup").json()
    assert setup["uri"].startswith("otpauth://totp/") and "<svg" in setup["qr_svg"]
    again = c.post("/api/v1/auth/2fa/setup").json()
    assert again["secret"] != setup["secret"]  # やり直すと新しい鍵になる
    assert c.post("/api/v1/auth/2fa/confirm", {"code": code(setup["secret"])}, format="json").status_code == 400
    r = c.post("/api/v1/auth/2fa/confirm", {"code": code(again["secret"])}, format="json")
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 8 and r.json()["two_factor_enabled"]
    assert c.get("/api/v1/admin/tenants/fushimi/options").status_code == 200
    assert c.post("/api/v1/auth/2fa/setup").json()["code"] == "already_enabled"

    # 回復コードは1回ずつ使える
    recovery = r.json()["recovery_codes"][0]
    for expected in (200, 400):
        fresh = APIClient()
        fresh.post("/api/v1/auth/login", {"email": u.email, "password": "pw-123456!"}, format="json")
        assert fresh.post("/api/v1/auth/login/code", {"code": recovery.upper()}, format="json").status_code == expected


def test_staff_can_enable_it_optionally_and_codes_are_validated(member):
    assert two_factor.required_for(member) is False
    tf = TwoFactor.objects.create(user=member, secret=SECRET, confirmed_at=timezone.now())
    assert two_factor.verify(member, "abc") is False
    assert two_factor.verify(member, code(offset=-30)) is True  # 30秒前のコードも受け付ける
    tf.refresh_from_db()
    assert tf.last_used_step > 0 and str(tf).endswith("の二段階認証")
    assert two_factor.confirm(member, code()) is None  # 設定済みは確認し直さない
    assert two_factor.verify(user("nobody@example.com"), code()) is False
