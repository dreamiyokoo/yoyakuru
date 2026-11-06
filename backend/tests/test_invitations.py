import re
from datetime import timedelta

from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.stores.models import Invitation, Membership, Role, Staff

from .conftest import client_for, enable_two_factor, user

S = "/api/v1/admin/tenants/fushimi/settings"


def token_from_mail():
    return re.search(r"/invite\?token=([\w-]+)", mail.outbox[-1].body)[1]


def test_owner_invites_new_staff_who_creates_an_account(store, staff, owner):
    c = client_for(owner)
    r = c.post(
        f"{S}/invitations", {"email": "New@Example.com", "role": "staff", "new_staff_name": "Dさん"}, format="json"
    )
    assert r.status_code == 201 and r.json()["state"] == "open" and r.json()["staff_name"] == "Dさん"
    assert "https://app.yoyakuru.test/invite?token=" in mail.outbox[-1].body
    token = token_from_mail()

    anon = APIClient()
    info = anon.get(f"/api/v1/auth/invitations/{token}").json()
    assert info == {
        "tenant": "伏見整体院",
        "email": "new@example.com",
        "role": "staff",
        "staff_name": "Dさん",
        "has_account": False,
    }
    weak = anon.post(f"/api/v1/auth/invitations/{token}/accept", {"password": "123"}, format="json")
    assert weak.status_code == 400 and weak.json()["code"] == "weak_password"
    r = anon.post(
        f"/api/v1/auth/invitations/{token}/accept", {"password": "a-good-pass-2026", "name": "田中"}, format="json"
    )
    assert r.status_code == 200 and r.json()["memberships"][0]["role"] == "staff"
    assert anon.get("/api/v1/admin/tenants/fushimi/options").status_code == 200  # そのままログインしている
    m = Membership.objects.get(user__email="new@example.com")
    assert m.staff.display_name == "Dさん" and m.user.first_name == "田中"
    assert anon.get(f"/api/v1/auth/invitations/{token}").status_code == 404  # 使った招待は無効
    listing = c.get(f"{S}/members").json()
    assert [i["state"] for i in listing["invitations"]] == ["accepted"]
    assert {x["email"] for x in listing["members"]} == {"owner@example.com", "new@example.com"}


def test_existing_account_joins_with_its_password_and_owner_role_requires_2fa(store, staff, owner):
    other = user("other@example.com")
    c = client_for(owner)
    c.post(f"{S}/invitations", {"email": "other@example.com", "role": "owner"}, format="json")
    token = token_from_mail()
    anon = APIClient()
    assert anon.get(f"/api/v1/auth/invitations/{token}").json()["has_account"] is True
    bad = anon.post(f"/api/v1/auth/invitations/{token}/accept", {"password": "wrong"}, format="json")
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_login"
    r = anon.post(f"/api/v1/auth/invitations/{token}/accept", {"password": "pw-123456!"}, format="json")
    assert r.status_code == 200 and r.json()["memberships"][0]["role"] == "owner"
    assert r.json()["two_factor_required"] is True and r.json()["two_factor_enabled"] is False
    assert Membership.objects.get(user=other).role == Role.OWNER
    assert anon.get("/api/v1/admin/tenants/fushimi/options").status_code == 403  # オーナーは二段階認証の設定が先


def test_invitation_rules(store, staff, owner, member):
    c = client_for(owner)
    assert (
        c.post(f"{S}/invitations", {"email": "staff@example.com", "staff": staff[2].id}, format="json").status_code
        == 400
    )
    assert c.post(f"{S}/invitations", {"email": "x@example.com", "role": "staff"}, format="json").status_code == 400
    taken = c.post(f"{S}/invitations", {"email": "x@example.com", "staff": staff[1].id}, format="json")
    assert taken.status_code == 400  # その担当者には member がログインしている
    first = c.post(f"{S}/invitations", {"email": "x@example.com", "staff": staff[2].id}, format="json").json()
    second = c.post(f"{S}/invitations", {"email": "x@example.com", "staff": staff[2].id}, format="json").json()
    assert Invitation.objects.get(pk=first["id"]).revoked_at is not None  # 古い招待は取り消し
    assert c.delete(f"{S}/invitations/{second['id']}").json()["state"] == "revoked"
    assert APIClient().get(f"/api/v1/auth/invitations/{token_from_mail()}").status_code == 404
    third = c.post(f"{S}/invitations", {"email": "y@example.com", "staff": staff[2].id}, format="json").json()
    Invitation.objects.filter(pk=third["id"]).update(expires_at=timezone.now() - timedelta(minutes=1))
    assert c.get(f"{S}/members").json()["invitations"][0]["state"] == "expired"
    assert client_for(member).post(f"{S}/invitations", {"email": "z@example.com"}, format="json").status_code == 403
    assert str(Invitation.objects.get(pk=third["id"])) == "y@example.com（スタッフ）"


def test_owner_pauses_and_resumes_members(store, staff, owner, member):
    c = client_for(owner)
    mid = Membership.objects.get(user=member).id
    oid = Membership.objects.get(user=owner).id
    assert c.patch(f"{S}/members/{mid}", {"is_active": False}, format="json").json()["is_active"] is False
    assert client_for(member).get("/api/v1/admin/tenants/fushimi/options").status_code == 403
    assert c.patch(f"{S}/members/{mid}", {"is_active": True}, format="json").json()["is_active"] is True
    assert c.patch(f"{S}/members/{oid}", {"is_active": False}, format="json").status_code == 400  # 自分自身
    second = user("owner2@example.com")
    Membership.objects.create(tenant=store, user=second, role=Role.OWNER)
    enable_two_factor(second)
    assert client_for(second).patch(f"{S}/members/{oid}", {"is_active": False}, format="json").status_code == 200
    assert client_for(owner).get(f"{S}/members").status_code == 403  # 停止されたオーナーは使えない
    assert Staff.objects.filter(tenant=store).count() == 3


def test_accept_requires_csrf(store, staff, owner):
    client_for(owner).post(f"{S}/invitations", {"email": "c@example.com", "staff": staff[2].id}, format="json")
    token = token_from_mail()
    c = APIClient(enforce_csrf_checks=True)
    assert (
        c.post(f"/api/v1/auth/invitations/{token}/accept", {"password": "a-good-pass-2026"}, format="json").status_code
        == 403
    )
    c.get("/api/v1/auth/csrf")
    r = c.post(
        f"/api/v1/auth/invitations/{token}/accept",
        {"password": "a-good-pass-2026"},
        format="json",
        HTTP_X_CSRFTOKEN=c.cookies["csrftoken"].value,
    )
    assert r.status_code == 200


def test_staff_linked_to_a_paused_member_or_claimed_first_cannot_be_reused(store, staff, owner, member):
    from django.contrib.auth import get_user_model

    c = client_for(owner)
    Membership.objects.filter(user=member).update(is_active=False)  # Bさん（staff[1]）のメンバーを停止
    r = c.post(f"{S}/invitations", {"email": "x@example.com", "staff": staff[1].id}, format="json")
    assert r.status_code == 400  # 停止中でも担当者との結びつきは残る

    c.post(f"{S}/invitations", {"email": "p@example.com", "staff": staff[2].id}, format="json")
    first = token_from_mail()
    c.post(f"{S}/invitations", {"email": "q@example.com", "staff": staff[2].id}, format="json")
    second = token_from_mail()
    body = {"password": "a-good-pass-2026"}
    assert APIClient().post(f"/api/v1/auth/invitations/{first}/accept", body, format="json").status_code == 200
    r = APIClient().post(f"/api/v1/auth/invitations/{second}/accept", body, format="json")
    assert r.status_code == 400 and r.json()["code"] == "staff_taken"
    assert not get_user_model().objects.filter(email="q@example.com").exists()  # アカウントは作らない


def test_existing_account_with_two_factor_must_enter_its_code(store, staff, owner):
    import pyotp

    from .conftest import enable_two_factor

    other = user("tf@example.com")
    enable_two_factor(other, secret="KRSXG5CTMVRXEZLU")
    client_for(owner).post(f"{S}/invitations", {"email": "tf@example.com", "staff": staff[2].id}, format="json")
    url = f"/api/v1/auth/invitations/{token_from_mail()}/accept"
    anon = APIClient()
    r = anon.post(url, {"password": "pw-123456!"}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "two_factor_required"
    assert anon.get("/api/v1/auth/me").status_code == 403  # まだログインしていない
    r = anon.post(url, {"password": "pw-123456!", "code": "000000"}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "invalid_code"
    assert not Membership.objects.filter(user=other).exists()
    code = pyotp.TOTP("KRSXG5CTMVRXEZLU").now()
    assert anon.post(url, {"password": "pw-123456!", "code": code}, format="json").status_code == 200
    assert Membership.objects.filter(user=other).exists()
