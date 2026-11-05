from datetime import timedelta

import pytest
from django.core.management import call_command

from apps.bookings.models import Booking, BookingStatus, Channel
from apps.bookings.services import (
    BookingError,
    cancel_by_token,
    cancel_deadline,
    confirm_by_token,
    create_booking,
    expire_holds,
)

from .conftest import NOW, at


def hold(service, start=None, **kw):
    kw.setdefault("customer_name", "山田 花子")
    kw.setdefault("customer_email", "yamada@example.com")
    return create_booking(service.tenant, service=service, starts_at=start or at(10), now=NOW, **kw)


def test_hold_assigns_priority_staff_and_records_event(service, staff):
    b = hold(service).booking
    assert b.status == BookingStatus.HOLD and b.staff == staff[0] and b.auto_assigned
    assert b.hold_expires_at == NOW + timedelta(minutes=15)
    assert b.resource_quantity == 1
    assert list(b.events.values_list("action", flat=True)) == ["held"]


def test_unavailable_slot_rejected(service):
    with pytest.raises(BookingError) as e:
        hold(service, at(13))
    assert e.value.status == 409


def test_idempotency_replays(service):
    first = hold(service, idempotency_key="k1")
    second = hold(service, idempotency_key="k1")
    assert second.replayed and second.booking.pk == first.booking.pk
    assert Booking.objects.count() == 1


def test_confirm_flow(service):
    b = hold(service).booking
    assert confirm_by_token(b.token, now=NOW).status == BookingStatus.CONFIRMED
    assert confirm_by_token(b.token, now=NOW).status == BookingStatus.CONFIRMED  # 2回目も同じ


def test_confirm_after_expiry_releases(service):
    b = hold(service).booking
    with pytest.raises(BookingError) as e:
        confirm_by_token(b.token, now=NOW + timedelta(minutes=16))
    assert e.value.status == 410
    b.refresh_from_db()
    assert b.status == BookingStatus.EXPIRED
    with pytest.raises(BookingError):
        confirm_by_token(b.token, now=NOW)


def test_confirm_unknown_and_cancelled(service):
    with pytest.raises(BookingError) as e:
        confirm_by_token("nope")
    assert e.value.status == 404
    b = hold(service).booking
    cancel_by_token(b.token, now=NOW)
    with pytest.raises(BookingError) as e:
        confirm_by_token(b.token, now=NOW)
    assert e.value.status == 409


def test_cancel_deadline_and_release(service):
    b = hold(service).booking
    confirm_by_token(b.token, now=NOW)
    assert cancel_deadline(b) == at(0)  # 予約日の0時＝前日の終わり
    with pytest.raises(BookingError) as e:
        cancel_by_token(b.token, now=at(0))
    assert e.value.status == 403
    assert cancel_by_token(b.token, now=NOW).status == BookingStatus.CANCELLED
    assert cancel_by_token(b.token, now=NOW).status == BookingStatus.CANCELLED  # 2回目も同じ
    assert hold(service, customer_email="b@example.com").booking.staff == b.staff  # 枠が戻る


def test_cancel_deadline_zero_days_and_errors(service):
    service.tenant.cancel_deadline_days = 0
    service.tenant.save()
    b = hold(service).booking
    assert cancel_deadline(b) == b.starts_at
    with pytest.raises(BookingError) as e:
        cancel_by_token("nope")
    assert e.value.status == 404
    b.status = BookingStatus.EXPIRED
    b.save()
    with pytest.raises(BookingError) as e:
        cancel_by_token(b.token, now=NOW)
    assert e.value.status == 409


def test_admin_booking_confirmed_without_cutoff(service, staff):
    b = create_booking(
        service.tenant,
        service=service,
        staff=staff[2],
        starts_at=at(10, 30, NOW.date()),
        customer_name="店頭",
        channel=Channel.ADMIN,
        confirm=True,
        now=NOW,
    ).booking
    assert b.status == BookingStatus.CONFIRMED and not b.auto_assigned and b.confirmed_at == NOW


def test_expire_holds(service):
    hold(service)
    assert expire_holds(NOW + timedelta(minutes=20)) == 1
    call_command("expire_holds")
