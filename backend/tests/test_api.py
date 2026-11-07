from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.bookings.models import Booking, BookingStatus

from .conftest import DAY, NOW, at

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    from django.core.cache import cache

    cache.clear()


@pytest.fixture
def client():
    return APIClient()


def payload(service, **kw):
    body = {
        "service": service.id,
        "starts_at": at(10).isoformat(),
        "customer_name": "山田 花子",
        "customer_email": "yamada@example.com",
        "note": "",
    }
    body.update(kw)
    return body


def test_store_and_availability(client, service, staff):
    r = client.get("/api/v1/public/tenants/fushimi/")
    assert r.status_code == 200
    assert r.json()["services"][0]["name"] == "全身調整"
    assert r.json()["staff"][0]["service_ids"] == [service.id]
    r = client.get("/api/v1/public/tenants/fushimi/availability", {"service": service.id, "date": DAY.isoformat()})
    assert r.status_code == 200 and r.json()["slots"][0]["starts_at"].startswith("2026-11-11T10:00:00+09:00")
    r = client.get(
        "/api/v1/public/tenants/fushimi/availability",
        {"service": service.id, "date": DAY.isoformat(), "staff": staff[1].id},
    )
    assert r.json()["slots"][0]["staff_ids"] == [staff[1].id]
    assert client.get("/api/v1/public/tenants/fushimi/availability", {"service": service.id}).status_code == 400
    assert client.get("/api/v1/public/tenants/nope/").status_code == 404


def test_full_flow_with_emails(client, service):
    r = client.post("/api/v1/public/tenants/fushimi/bookings", payload(service), format="json")
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["status"] == "hold" and "token" not in body and "customer_email" not in body
    booking = Booking.objects.get()
    assert len(mail.outbox) == 1 and f"/confirm?token={booking.token}" in mail.outbox[0].body

    r = client.post("/api/v1/public/bookings/confirm", {"token": booking.token}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert len(mail.outbox) == 2
    ics = mail.outbox[1].attachments[0]
    assert ics[0] == "yoyaku.ics" and "BEGIN:VALARM" in ics[1] and "TRIGGER:-P1D" in ics[1]
    client.post("/api/v1/public/bookings/confirm", {"token": booking.token}, format="json")
    assert len(mail.outbox) == 2  # 2回目はメールを送らない

    r = client.get(f"/api/v1/public/bookings/{booking.token}")
    assert r.status_code == 200 and r.json()["cancel_deadline"].startswith("2026-11-11T00:00:00+09:00")
    r = client.post(f"/api/v1/public/bookings/{booking.token}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert "METHOD:CANCEL" in mail.outbox[2].attachments[0][1]


def test_errors(client, service):
    assert (
        client.post(
            "/api/v1/public/tenants/fushimi/bookings", payload(service, starts_at=at(13).isoformat()), format="json"
        ).status_code
        == 409
    )
    r = client.post("/api/v1/public/tenants/fushimi/bookings", payload(service, customer_email=""), format="json")
    assert r.status_code == 400
    r = client.post("/api/v1/public/tenants/fushimi/bookings", payload(service, idempotency_key="a"), format="json")
    assert r.status_code == 201
    r = client.post("/api/v1/public/tenants/fushimi/bookings", payload(service, idempotency_key="a"), format="json")
    assert r.status_code == 200
    b = Booking.objects.get()
    b.hold_expires_at = timezone.now() - timedelta(seconds=1)
    b.save()
    r = client.post("/api/v1/public/bookings/confirm", {"token": b.token}, format="json")
    assert r.status_code == 410 and r.json()["code"] == "hold_expired"
    assert Booking.objects.get().status == BookingStatus.EXPIRED
    assert client.post("/api/v1/public/bookings/confirm", {"token": "x"}, format="json").status_code == 404
    assert client.get("/api/v1/public/bookings/x").status_code == 404


def test_cannot_book_other_store_service(client, service):
    from apps.tenants.models import Tenant

    Tenant.objects.create(subdomain="other", name="他店")
    r = client.post("/api/v1/public/tenants/other/bookings", payload(service), format="json")
    assert r.status_code == 404


def test_hold_throttle(client, service, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    from apps.bookings.views import HoldView

    class OnePerHour(ScopedRateThrottle):
        def get_rate(self):
            return "1/hour"

    monkeypatch.setattr(HoldView, "throttle_classes", [OnePerHour])
    assert client.post("/api/v1/public/tenants/fushimi/bookings", payload(service), format="json").status_code == 201
    r = client.post(
        "/api/v1/public/tenants/fushimi/bookings", payload(service, starts_at=at(11).isoformat()), format="json"
    )
    assert r.status_code == 429


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_ics_download(client, service):
    from apps.bookings.services import confirm_by_token

    client.post("/api/v1/public/tenants/fushimi/bookings", payload(service), format="json")
    b = Booking.objects.get()
    assert client.get(f"/api/v1/public/bookings/{b.token}/ics").status_code == 404  # 確定前
    confirm_by_token(b.token)
    r = client.get(f"/api/v1/public/bookings/{b.token}/ics")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/calendar")
    assert b"BEGIN:VEVENT" in r.content


def test_seed_demo(db):
    from django.contrib.auth import get_user_model
    from django.core.management import call_command

    from apps.bookings.services import create_booking
    from apps.core import google
    from apps.stores.models import Service
    from apps.tenants.models import Tenant

    call_command("seed_demo")
    call_command("seed_demo")
    store = Tenant.objects.get(subdomain="fushimi")
    service = Service.objects.for_tenant(store).first()
    create_booking(store, service=service, starts_at=at(10), customer_name="x", now=NOW)
    call_command("seed_demo", "--reset", "--with-users")
    call_command("seed_demo", "--reset", "--with-users")  # 2回目もユーザーを作り直せる
    assert Service.objects.for_tenant(Tenant.objects.get(subdomain="fushimi")).count() == 3
    owner = get_user_model().objects.get(username="owner@fushimi.example")
    assert not owner.has_usable_password() and owner.memberships.get().role == "owner"
    assert google.connected(owner)  # Googleカレンダーは接続済みの体にする（E2E用）


def test_seed_dev(db, monkeypatch):
    from django.contrib.auth import get_user_model
    from django.core.management import call_command

    call_command("seed_dev")  # パスワード未設定ならスーパーユーザーは作らない
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "pw-for-test")
    call_command("seed_dev")
    call_command("seed_dev")
    assert get_user_model().objects.filter(username="admin", is_superuser=True).exists()


def test_ics_error_is_rendered_for_calendar_apps(db):
    r = APIClient().get("/api/v1/public/bookings/nope/ics", HTTP_ACCEPT="text/calendar")
    assert r.status_code == 404
