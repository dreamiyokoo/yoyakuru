from datetime import time, timedelta

import pytest

from apps.bookings.availability import available_slots, choose_staff, intersect, plan_for, subtract
from apps.bookings.models import Booking, BookingStatus
from apps.stores.models import DateOverride, RecurringBreak, Service, ShiftException, TimeOff
from apps.tenants.models import Tenant

from .conftest import DAY, NOW, at


def starts(slots):
    return [s.starts_at.strftime("%H:%M") for s in slots]


def book(service, staff, start, **kw):
    p = plan_for(service, kw.pop("customer_type", "repeat"), start)
    return Booking.objects.create(
        tenant=service.tenant,
        service=service,
        staff=staff,
        starts_at=p.starts_at,
        ends_at=p.ends_at,
        occupied_from=p.occupied_from,
        occupied_until=p.occupied_until,
        customer_name="x",
        status=kw.pop("status", BookingStatus.CONFIRMED),
        resource=service.resource,
        resource_quantity=service.resource_quantity if service.resource_id else 0,
        **kw,
    )


def test_interval_helpers():
    a, b, c, d = at(10), at(11), at(12), at(13)
    assert subtract([(a, d)], [(b, c)]) == [(a, b), (c, d)]
    assert subtract([(a, b)], [(c, d)]) == [(a, b)]
    assert intersect([(a, c)], [(b, d)]) == [(b, c)]


def test_slots_skip_break_and_close(service):
    s = starts(available_slots(service.tenant, service, DAY, now=NOW))
    assert s[0] == "10:00" and s[-1] == "19:00"
    assert "12:30" not in s and "13:00" not in s and "13:30" not in s  # 休憩にかかる枠は出さない
    assert "12:00" in s and "14:00" in s


def test_first_visit_uses_longer_duration(service):
    s = starts(available_slots(service.tenant, service, DAY, customer_type="first", now=NOW))
    assert "11:30" in s and "12:00" not in s and "18:30" in s and "19:00" not in s


def test_buffer_rounds_up_to_interval(service):
    service.buffer_after_minutes = 10
    service.save()
    p = plan_for(service, "repeat", at(10))
    assert p.ends_at == at(11) and p.occupied_until == at(11, 30)


def test_cutoff_and_window(service):
    store = service.tenant
    today = NOW.date()
    same_day = starts(available_slots(store, service, today, now=NOW))
    assert same_day[0] == "11:00"  # 2時間前の締切
    assert available_slots(store, service, today - timedelta(days=1), now=NOW) == []
    assert available_slots(store, service, today + timedelta(days=61), now=NOW) == []


def test_closed_day_and_overrides(service):
    store = service.tenant
    sunday = DAY + timedelta(days=4)
    assert available_slots(store, service, sunday, now=NOW) == []
    DateOverride.objects.create(tenant=store, date=DAY, is_closed=True)
    assert available_slots(store, service, DAY, now=NOW) == []
    DateOverride.objects.filter(tenant=store).update(is_closed=False, opens_at=time(15), closes_at=time(17))
    assert starts(available_slots(store, service, DAY, now=NOW)) == ["15:00", "15:30", "16:00"]


def test_staff_exception_and_time_off(service, staff):
    a, b, c = staff
    ShiftException.objects.create(tenant=service.tenant, staff=a, date=DAY, is_off=True)
    TimeOff.objects.create(tenant=service.tenant, staff=b, starts_at=at(10), ends_at=at(12))
    slots = {s.starts_at: s.staff_ids for s in available_slots(service.tenant, service, DAY, now=NOW)}
    assert slots[at(10)] == (c.id,)
    assert slots[at(15)] == (b.id, c.id)
    TimeOff.objects.create(tenant=service.tenant, starts_at=at(15), ends_at=at(16))  # 店舗全体
    assert at(15) not in {s.starts_at for s in available_slots(service.tenant, service, DAY, now=NOW)}


def test_shift_exception_custom_hours_and_staff_break(service, staff):
    a = staff[0]
    ShiftException.objects.create(tenant=service.tenant, staff=a, date=DAY, starts_at=time(16), ends_at=time(18))
    RecurringBreak.objects.create(
        tenant=service.tenant, staff=a, weekday=DAY.weekday(), starts_at=time(16), ends_at=time(17)
    )
    slots = available_slots(service.tenant, service, DAY, staff=a, now=NOW)
    assert starts(slots) == ["17:00"]


def test_beds_limit_concurrency(service, staff):
    """3人勤務・ベッド2台なら同時は2件まで（AC-05）。"""
    book(service, staff[0], at(10))
    book(service, staff[1], at(10))
    assert at(10) not in {s.starts_at for s in available_slots(service.tenant, service, DAY, now=NOW)}


def test_expired_hold_frees_slot_and_cancelled_ignored(service, staff):
    a = staff[0]
    book(service, a, at(10), status=BookingStatus.HOLD, hold_expires_at=NOW - timedelta(minutes=1))
    book(service, a, at(11), status=BookingStatus.CANCELLED)
    slots = {s.starts_at: s.staff_ids for s in available_slots(service.tenant, service, DAY, staff=a, now=NOW)}
    assert at(10) in slots and at(11) in slots
    book(service, a, at(12), status=BookingStatus.HOLD, hold_expires_at=NOW + timedelta(minutes=5))
    assert at(12) not in {s.starts_at for s in available_slots(service.tenant, service, DAY, staff=a, now=NOW)}


def test_unavailable_cases(service, staff):
    store = service.tenant
    other = Tenant.objects.create(subdomain="other", name="other")
    assert available_slots(other, service, DAY, now=NOW) == []
    service.staff.clear()
    assert available_slots(store, service, DAY, now=NOW) == []
    service.staff.set(staff[:1])
    assert available_slots(store, service, DAY, staff=staff[2], now=NOW) == []


def test_group_capacity(store, staff):
    lesson = Service.objects.create(tenant=store, name="ヨガ", duration_minutes=60, capacity=3)
    lesson.staff.set([staff[0]])
    book(lesson, staff[0], at(10), party_size=2)
    assert at(10) in {s.starts_at for s in available_slots(store, lesson, DAY, now=NOW)}
    assert at(10) not in {s.starts_at for s in available_slots(store, lesson, DAY, now=NOW, party_size=2)}
    assert at(10, 30) not in {s.starts_at for s in available_slots(store, lesson, DAY, now=NOW)}


@pytest.mark.parametrize("priorities,expected", [((1, 2, 3), 0), ((100, 100, 100), 1)])
def test_choose_staff(service, staff, priorities, expected):
    for s, p in zip(staff, priorities, strict=True):
        s.priority = p
        s.save()
    book(service, staff[0], at(15))
    chosen = choose_staff(service.tenant, [s.id for s in staff], DAY, NOW)
    assert chosen == staff[expected].id
