from datetime import timedelta

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.bookings.models import Booking, BookingStatus, Channel
from apps.bookings.services import create_booking
from apps.stores.models import Membership, Role, Service, Staff
from apps.tenants.models import Tenant

from .conftest import DAY, NOW, at, client_for, user

BASE = "/api/v1/admin/tenants/fushimi"


@pytest.fixture(autouse=True)
def _clear_cache():
    from django.core.cache import cache

    cache.clear()


def book(service, staff=None, start=None, email="c@example.com"):
    return create_booking(
        service.tenant,
        service=service,
        staff=staff,
        starts_at=start or at(10),
        customer_name="山田",
        customer_email=email,
        confirm=True,
        now=NOW,
    ).booking


class TestPermissions:
    def test_requires_membership(self, service, owner):
        assert APIClient().get(f"{BASE}/options").status_code == 403
        outsider = user("out@example.com")
        assert client_for(outsider).get(f"{BASE}/options").status_code == 403
        Tenant.objects.create(subdomain="other", name="他店")
        assert client_for(owner).get("/api/v1/admin/tenants/other/options").status_code == 403

    def test_other_tenant_ids_are_hidden(self, service, owner):
        other = Tenant.objects.create(subdomain="other", name="他店")
        other_staff = Staff.objects.create(tenant=other, display_name="X")
        other_service = Service.objects.create(tenant=other, name="X", duration_minutes=60)
        other_service.staff.set([other_staff])
        c = client_for(owner)
        body = {
            "service": other_service.id,
            "staff": other_staff.id,
            "starts_at": at(10).isoformat(),
            "customer_name": "x",
        }
        assert c.post(f"{BASE}/bookings", body, format="json").status_code == 404

    def test_staff_sees_and_edits_only_own(self, service, staff, owner, member):
        mine = book(service, staff[1], at(10))
        theirs = book(service, staff[0], at(11))
        c = client_for(member)
        r = c.get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY})
        assert [b["id"] for b in r.json()] == [mine.id]
        assert c.get(f"{BASE}/bookings/{theirs.id}").status_code == 404
        assert (
            c.post(
                f"{BASE}/bookings/{mine.id}/reschedule",
                {"starts_at": at(15).isoformat(), "staff": staff[1].id},
                format="json",
            ).status_code
            == 403
        )
        body = {"service": service.id, "staff": staff[0].id, "starts_at": at(15).isoformat(), "customer_name": "x"}
        assert c.post(f"{BASE}/bookings", body, format="json").status_code == 403
        unlinked = user("nolink@example.com")
        Membership.objects.create(tenant=service.tenant, user=unlinked, role=Role.STAFF)
        assert client_for(unlinked).get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY}).json() == []


class TestBookings:
    def test_options_and_list_filters(self, service, staff, owner):
        book(service, staff[0], at(10))
        b = book(service, staff[1], at(11))
        c = client_for(owner)
        r = c.get(f"{BASE}/options").json()
        assert r["role"] == "owner" and r["services"][0]["name"] == "全身調整"
        r = c.get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY, "staff": staff[1].id})
        assert [x["id"] for x in r.json()] == [b.id]
        assert c.get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY, "status": "cancelled"}).json() == []
        assert c.get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY - timedelta(days=1)}).status_code == 400
        assert c.get(f"{BASE}/bookings", {"date_from": DAY, "date_to": DAY + timedelta(days=90)}).status_code == 400

    def test_manual_booking_is_confirmed_and_emailed(self, service, staff, member):
        c = client_for(member)
        body = {
            "service": service.id,
            "staff": staff[1].id,
            "starts_at": at(10, 30, NOW.date() + timedelta(days=1)).isoformat(),
            "customer_name": "電話のお客様",
            "customer_email": "tel@example.com",
        }
        r = c.post(f"{BASE}/bookings", body, format="json")
        assert r.status_code == 201, r.json()
        assert r.json()["status"] == "confirmed" and r.json()["channel"] == Channel.ADMIN
        assert mail.outbox[-1].to == ["tel@example.com"]
        assert c.post(f"{BASE}/bookings", body, format="json").status_code == 409  # 同じ枠は重なる

    def test_detail_cancel_and_reschedule(self, service, staff, owner):
        b = book(service, staff[0], at(10))
        c = client_for(owner)
        r = c.get(f"{BASE}/bookings/{b.id}").json()
        assert [e["action"] for e in r["events"]] == ["confirmed"]
        r = c.post(
            f"{BASE}/bookings/{b.id}/reschedule", {"starts_at": at(15).isoformat(), "staff": staff[2].id}, format="json"
        )
        assert r.status_code == 200 and r.json()["staff"] == staff[2].id
        assert "変更しました" in mail.outbox[-1].subject
        assert "SEQUENCE:1" in mail.outbox[-1].attachments[0][1]
        r = c.post(
            f"{BASE}/bookings/{b.id}/reschedule", {"starts_at": at(13).isoformat(), "staff": staff[2].id}, format="json"
        )
        assert r.status_code == 409  # 休憩
        r = c.post(f"{BASE}/bookings/{b.id}/cancel")
        assert r.json()["status"] == "cancelled" and "取消" in mail.outbox[-1].subject
        sent = len(mail.outbox)
        assert c.post(f"{BASE}/bookings/{b.id}/cancel").status_code == 200
        assert len(mail.outbox) == sent  # 2回目は送らない
        r = c.post(
            f"{BASE}/bookings/{b.id}/reschedule", {"starts_at": at(15).isoformat(), "staff": staff[2].id}, format="json"
        )
        assert r.status_code == 409
        b.refresh_from_db()
        assert [e.action for e in b.events.all()] == ["confirmed", "rescheduled", "cancelled"]

    def test_cancel_expired_is_rejected(self, service, staff, owner):
        b = book(service, staff[0], at(10))
        Booking.objects.filter(pk=b.pk).update(status=BookingStatus.EXPIRED)
        assert client_for(owner).post(f"{BASE}/bookings/{b.id}/cancel").status_code == 409

    def test_availability_ignores_cutoff_and_can_exclude(self, service, staff, owner):
        b = book(service, staff[0], at(10))
        c = client_for(owner)
        r = c.get(f"{BASE}/availability", {"service": service.id, "date": DAY, "staff": staff[0].id})
        assert at(10).isoformat() not in [s["starts_at"] for s in r.json()["slots"]]
        r = c.get(
            f"{BASE}/availability", {"service": service.id, "date": DAY, "staff": staff[0].id, "exclude_booking": b.id}
        )
        assert r.json()["slots"][0]["starts_at"] == "2026-11-11T10:00:00+09:00"


def test_cancel_sequence_is_newer_than_every_change(service, staff, owner):
    b = book(service, staff[0], at(10))
    c = client_for(owner)
    for start in (at(15), at(16)):
        c.post(
            f"{BASE}/bookings/{b.id}/reschedule", {"starts_at": start.isoformat(), "staff": staff[0].id}, format="json"
        )
    assert "SEQUENCE:2" in mail.outbox[-1].attachments[0][1]
    c.post(f"{BASE}/bookings/{b.id}/cancel")
    assert "SEQUENCE:3" in mail.outbox[-1].attachments[0][1]
