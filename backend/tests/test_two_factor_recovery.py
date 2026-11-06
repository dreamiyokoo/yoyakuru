import time

import pyotp
from django.contrib.admin.sites import site
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.core.models import TwoFactor
from apps.stores.models import Membership, Role

from .conftest import client_for, enable_two_factor, user

SECRET = "JBSWY3DPEHPK3PXP"
S = "/api/v1/admin/tenants/fushimi/settings"


def code(offset=0):
    return pyotp.TOTP(SECRET).at(int(time.time()) + offset)


def login_with(u, second):
    c = APIClient()
    c.post("/api/v1/auth/login", {"email": u.email, "password": "pw-123456!"}, format="json")
    return c, c.post("/api/v1/auth/login/code", {"code": second}, format="json")


def test_regenerate_recovery_codes_invalidates_the_old_ones(owner):
    c = client_for(owner)
    first = c.post("/api/v1/auth/2fa/recovery-codes", {"code": code(-30)}, format="json").json()["recovery_codes"]
    assert c.post("/api/v1/auth/2fa/recovery-codes", {"code": "000000"}, format="json").status_code == 400
    second = c.post("/api/v1/auth/2fa/recovery-codes", {"code": first[0]}, format="json").json()["recovery_codes"]
    assert len(second) == 8 and not set(first) & set(second)
    assert login_with(owner, first[1])[1].status_code == 400  # 古い回復コードは使えない
    assert login_with(owner, second[0])[1].status_code == 200


def test_owner_resets_with_a_recovery_code_and_sets_up_a_new_device(owner):
    c = client_for(owner)
    codes = c.post("/api/v1/auth/2fa/recovery-codes", {"code": code(-30)}, format="json").json()["recovery_codes"]
    assert c.post("/api/v1/auth/2fa/reset", {"code": "nope"}, format="json").status_code == 400
    me = c.post("/api/v1/auth/2fa/reset", {"code": codes[0]}, format="json").json()
    assert me["two_factor_enabled"] is False and me["two_factor_required"] is True
    assert c.get("/api/v1/admin/tenants/fushimi/options").status_code == 403  # 設定し直すまで使えない
    setup = c.post("/api/v1/auth/2fa/setup").json()
    r = c.post("/api/v1/auth/2fa/confirm", {"code": pyotp.TOTP(setup["secret"]).now()}, format="json")
    assert r.status_code == 200 and c.get("/api/v1/admin/tenants/fushimi/options").status_code == 200


def test_another_owner_resets_a_member_who_lost_everything(store, staff, owner):
    other = user("owner2@example.com")
    mid = Membership.objects.create(tenant=store, user=other, role=Role.OWNER).id
    enable_two_factor(other, secret="KRSXG5CTMVRXEZLU")
    c = client_for(owner)
    members = {m["email"]: m for m in c.get(f"{S}/members").json()["members"]}
    assert members["owner2@example.com"]["two_factor_enabled"] is True
    r = c.post(f"{S}/members/{mid}/reset-2fa")
    assert r.status_code == 200 and r.json()["two_factor_enabled"] is False
    assert not TwoFactor.objects.filter(user=other).exists()
    # パスワードだけでログインでき、オーナーなので設定し直すまで管理はできない
    fresh = APIClient()
    me = fresh.post("/api/v1/auth/login", {"email": other.email, "password": "pw-123456!"}, format="json").json()
    assert me["two_factor_required"] is True and me["two_factor_enabled"] is False
    own = Membership.objects.get(user=owner).id
    assert c.post(f"{S}/members/{own}/reset-2fa").status_code == 400  # 自分自身は外せない


def test_staff_cannot_reset_others(store, staff, owner, member):
    oid = Membership.objects.get(user=owner).id
    assert client_for(member).post(f"{S}/members/{oid}/reset-2fa").status_code == 403


def test_operator_admin_hides_secrets_and_only_allows_delete(owner):
    admin = site._registry[TwoFactor]
    request = RequestFactory().get("/")
    assert admin.has_add_permission(request) is False and admin.has_change_permission(request) is False
    assert "secret" not in admin.fields and "recovery_codes" not in admin.fields
