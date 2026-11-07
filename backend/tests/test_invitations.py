import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.stores.invitations import InvitationError, accept_invitation
from apps.stores.models import Invitation, Membership, Role, Staff

from .conftest import client_for, user

S = "/api/v1/admin/tenants/fushimi/settings"


def token_from_mail():
    return re.search(r"/invite\?token=([\w-]+)", mail.outbox[-1].body)[1]


def join_with_google(email, token):
    """招待のリンクを開き、Googleで認証した体で、参加の仕上げ（done）まで進める。"""
    c = APIClient(enforce_csrf_checks=True)
    c.get("/api/v1/auth/csrf")
    csrf = {"HTTP_X_CSRFTOKEN": c.cookies["csrftoken"].value}
    start = c.post("/api/v1/auth/google/start", {"kind": "invite", "token": token}, format="json", **csrf)
    assert start.status_code == 200 and start.json() == {"url": "/accounts/google/login/?process=login"}
    c.force_login(user(email))
    return c, c.get("/api/v1/auth/google/done")


def test_owner_invites_new_staff_who_joins_with_google(store, staff, owner):
    c = client_for(owner)
    r = c.post(
        f"{S}/invitations", {"email": "New@Example.com", "role": "staff", "new_staff_name": "Dさん"}, format="json"
    )
    assert r.status_code == 201 and r.json()["state"] == "open" and r.json()["staff_name"] == "Dさん"
    assert "https://app.yoyakuru.test/invite?token=" in mail.outbox[-1].body
    token = token_from_mail()

    info = APIClient().get(f"/api/v1/auth/invitations/{token}").json()
    assert info == {"tenant": "伏見整体院", "email": "new@example.com", "role": "staff", "staff_name": "Dさん"}

    anon, r = join_with_google("new@example.com", token)
    assert r.status_code == 302 and r["Location"] == "/"
    assert anon.get("/api/v1/admin/tenants/fushimi/options").status_code == 200  # そのままログインしている
    m = Membership.objects.get(user__email="new@example.com")
    assert m.role == Role.STAFF and m.staff.display_name == "Dさん"
    assert APIClient().get(f"/api/v1/auth/invitations/{token}").status_code == 404  # 使った招待は無効
    listing = c.get(f"{S}/members").json()
    assert [i["state"] for i in listing["invitations"]] == ["accepted"]
    assert {x["email"] for x in listing["members"]} == {"owner@example.com", "new@example.com"}


def test_invitation_to_owner_role(store, staff, owner):
    client_for(owner).post(f"{S}/invitations", {"email": "other@example.com", "role": "owner"}, format="json")
    _, r = join_with_google("other@example.com", token_from_mail())
    assert r["Location"] == "/" and Membership.objects.get(user__email="other@example.com").role == Role.OWNER


def test_only_the_invited_google_account_can_join(store, staff, owner):
    client_for(owner).post(f"{S}/invitations", {"email": "a@example.com", "staff": staff[2].id}, format="json")
    c, r = join_with_google("someone-else@example.com", token_from_mail())
    assert r["Location"] == "/login?error=invitation_email"
    assert not Membership.objects.filter(user__email="someone-else@example.com").exists()
    assert c.get("/api/v1/auth/me").status_code == 403  # ログインも取り消される


def test_start_rejects_an_invalid_token(db):
    r = APIClient().post("/api/v1/auth/google/start", {"kind": "invite", "token": "nope"}, format="json")
    assert r.status_code == 400


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
    assert client_for(second).patch(f"{S}/members/{oid}", {"is_active": False}, format="json").status_code == 200
    assert client_for(owner).get(f"{S}/members").status_code == 403  # 停止されたオーナーは使えない
    assert Staff.objects.filter(tenant=store).count() == 3


def test_staff_linked_to_a_paused_member_or_claimed_first_cannot_be_reused(store, staff, owner, member):
    c = client_for(owner)
    Membership.objects.filter(user=member).update(is_active=False)  # Bさん（staff[1]）のメンバーを停止
    r = c.post(f"{S}/invitations", {"email": "x@example.com", "staff": staff[1].id}, format="json")
    assert r.status_code == 400  # 停止中でも担当者との結びつきは残る

    c.post(f"{S}/invitations", {"email": "p@example.com", "staff": staff[2].id}, format="json")
    first = token_from_mail()
    c.post(f"{S}/invitations", {"email": "q@example.com", "staff": staff[2].id}, format="json")
    second = token_from_mail()
    accept_invitation(user("p@example.com"), first)
    with pytest.raises(InvitationError) as e:
        accept_invitation(user("q@example.com"), second)
    assert e.value.code == "staff_taken"
    assert not Membership.objects.filter(user__email="q@example.com").exists()
