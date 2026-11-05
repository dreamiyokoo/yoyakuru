"""空き判定（BOOK-01〜03、TIME-01〜06、MENU-03〜07、BREAK-03〜04、SYNC-08、EXT-01）。

Web・チャット・電話・管理画面は、すべてこの判定を使う。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from stores.models import (
    BusinessHours,
    DateOverride,
    RecurringBreak,
    Service,
    ShiftException,
    Staff,
    Store,
    TimeOff,
    WeeklyShift,
)

from .models import Booking

Interval = tuple[datetime, datetime]


def subtract(intervals: Iterable[Interval], cuts: Iterable[Interval]) -> list[Interval]:
    """intervals から cuts を差し引く。"""
    result = list(intervals)
    for c_start, c_end in cuts:
        next_result: list[Interval] = []
        for start, end in result:
            if c_end <= start or c_start >= end:
                next_result.append((start, end))
                continue
            if start < c_start:
                next_result.append((start, c_start))
            if c_end < end:
                next_result.append((c_end, end))
        result = next_result
    return result


def intersect(a: Iterable[Interval], b: Sequence[Interval]) -> list[Interval]:
    out: list[Interval] = []
    for a_start, a_end in a:
        for b_start, b_end in b:
            start, end = max(a_start, b_start), min(a_end, b_end)
            if start < end:
                out.append((start, end))
    return out


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


@dataclass(frozen=True)
class Plan:
    """1件の予約が占める時間。"""

    starts_at: datetime
    ends_at: datetime
    occupied_from: datetime
    occupied_until: datetime


@dataclass(frozen=True)
class Slot:
    starts_at: datetime
    ends_at: datetime
    occupied_from: datetime
    occupied_until: datetime
    staff_ids: tuple[int, ...]


def store_tz(store: Store) -> ZoneInfo:
    return ZoneInfo(store.timezone)


def _at(day: date, t: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, t, tz)


def store_open_intervals(store: Store, day: date) -> list[Interval]:
    tz = store_tz(store)
    override = DateOverride.objects.filter(store=store, date=day).first()
    if override:
        if override.is_closed or not (override.opens_at and override.closes_at):
            return []
        return [(_at(day, override.opens_at, tz), _at(day, override.closes_at, tz))]
    hours = BusinessHours.objects.filter(store=store, weekday=day.weekday()).first()
    if not hours:
        return []
    return [(_at(day, hours.opens_at, tz), _at(day, hours.closes_at, tz))]


def staff_working_intervals(staff: Staff, day: date, open_intervals: Sequence[Interval]) -> list[Interval]:
    tz = store_tz(staff.store)
    exception = ShiftException.objects.filter(staff=staff, date=day).first()
    if exception:
        if exception.is_off or not (exception.starts_at and exception.ends_at):
            return []
        working = [(_at(day, exception.starts_at, tz), _at(day, exception.ends_at, tz))]
    else:
        shift = WeeklyShift.objects.filter(staff=staff, weekday=day.weekday()).first()
        if not shift:
            return []
        working = [(_at(day, shift.starts_at, tz), _at(day, shift.ends_at, tz))]
    return intersect(working, open_intervals)


def break_intervals(store: Store, staff: Staff, day: date) -> list[Interval]:
    tz = store_tz(store)
    breaks = RecurringBreak.objects.filter(store=store).filter(staff__isnull=True) | RecurringBreak.objects.filter(
        store=store, staff=staff
    )
    return [
        (_at(day, b.starts_at, tz), _at(day, b.ends_at, tz))
        for b in breaks
        if b.weekday is None or b.weekday == day.weekday()
    ]


def time_off_intervals(store: Store, staff: Staff, day_start: datetime, day_end: datetime) -> list[Interval]:
    qs = TimeOff.objects.filter(store=store, starts_at__lt=day_end, ends_at__gt=day_start)
    return [(t.starts_at, t.ends_at) for t in qs if t.staff_id in (None, staff.id)]


def staff_free_intervals(store: Store, staff: Staff, day: date, open_intervals: Sequence[Interval]) -> list[Interval]:
    """勤務時間から休憩・休みを除いた時間。既存の予約は別に判定する。"""
    tz = store_tz(store)
    day_start = _at(day, time.min, tz)
    working = staff_working_intervals(staff, day, open_intervals)
    working = subtract(working, break_intervals(store, staff, day))
    return subtract(working, time_off_intervals(store, staff, day_start, day_start + timedelta(days=1)))


def plan_for(service: Service, customer_type: str, starts_at: datetime) -> Plan:
    """準備時間を含めた占有時間を、刻みの倍数に切り上げる（MENU-07）。"""
    interval = service.store.slot_interval_minutes
    before, after = service.buffers()
    duration = service.duration_for(customer_type)
    total = before + duration + after
    rounded = -(-total // interval) * interval
    occupied_from = starts_at - timedelta(minutes=before)
    return Plan(
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=duration),
        occupied_from=occupied_from,
        occupied_until=occupied_from + timedelta(minutes=rounded),
    )


def _joinable_group(service: Service, plan: Plan, overlapping: list[Booking], party_size: int) -> bool:
    """定員制の枠（EXT-01）に参加できるか。"""
    if service.capacity <= 1 or not overlapping:
        return False
    if any(b.service_id != service.id or b.starts_at != plan.starts_at for b in overlapping):
        return False
    return sum(b.party_size for b in overlapping) + party_size <= service.capacity


def staff_can_take(
    staff: Staff, service: Service, plan: Plan, free: Sequence[Interval], bookings: Sequence[Booking], party_size: int
) -> bool:
    if not any(start <= plan.occupied_from and plan.occupied_until <= end for start, end in free):
        return False
    overlapping = [
        b
        for b in bookings
        if b.staff_id == staff.id
        and overlaps(b.occupied_from, b.occupied_until, plan.occupied_from, plan.occupied_until)
    ]
    if overlapping and not _joinable_group(service, plan, overlapping, party_size):
        return False
    if service.resource_id is None or overlapping:
        return True
    used = sum(
        b.resource_quantity
        for b in bookings
        if b.resource_id == service.resource_id
        and overlaps(b.occupied_from, b.occupied_until, plan.occupied_from, plan.occupied_until)
    )
    return used + service.resource_quantity <= service.resource.quantity


def _blocking_bookings(store: Store, day: date, now: datetime, exclude_booking_id: int | None) -> list[Booking]:
    tz = store_tz(store)
    day_start = _at(day, time.min, tz) - timedelta(hours=6)
    day_end = day_start + timedelta(days=1, hours=12)
    qs = Booking.objects.blocking(now).filter(store=store, occupied_from__lt=day_end, occupied_until__gt=day_start)
    if exclude_booking_id:
        qs = qs.exclude(pk=exclude_booking_id)
    return list(qs)


def available_slots(
    store: Store,
    service: Service,
    day: date,
    customer_type: str = "repeat",
    staff: Staff | None = None,
    now: datetime | None = None,
    party_size: int = 1,
    exclude_booking_id: int | None = None,
    enforce_cutoff: bool = True,
) -> list[Slot]:
    now = now or timezone.now()
    tz = store_tz(store)
    today = now.astimezone(tz).date()
    if not store.is_active or not service.is_active or service.store_id != store.id:
        return []
    if enforce_cutoff and (day < today or day > today + timedelta(days=store.booking_window_days)):
        return []
    open_intervals = store_open_intervals(store, day)
    if not open_intervals:
        return []
    candidates = list(service.staff.filter(is_active=True).order_by("priority", "id"))
    if staff is not None:
        candidates = [s for s in candidates if s.id == staff.id]
    if not candidates:
        return []
    bookings = _blocking_bookings(store, day, now, exclude_booking_id)
    free = {s.id: staff_free_intervals(store, s, day, open_intervals) for s in candidates}
    step = timedelta(minutes=store.slot_interval_minutes)
    cutoff = now + timedelta(minutes=store.same_day_cutoff_minutes) if enforce_cutoff else None
    first_open = min(start for start, _ in open_intervals)
    last_close = max(end for _, end in open_intervals)

    slots: list[Slot] = []
    t = first_open
    while t < last_close:
        plan = plan_for(service, customer_type, t)
        if cutoff is None or plan.starts_at >= cutoff:
            ids = tuple(s.id for s in candidates if staff_can_take(s, service, plan, free[s.id], bookings, party_size))
            if ids:
                slots.append(Slot(plan.starts_at, plan.ends_at, plan.occupied_from, plan.occupied_until, ids))
        t += step
    return slots


def choose_staff(store: Store, staff_ids: Sequence[int], day: date, now: datetime) -> int:
    """指名なしの割当（ASSIGN-01〜02）。優先順位、同日の確定予約数、登録順の順で選ぶ。"""
    staff = {s.id: s for s in Staff.objects.filter(id__in=staff_ids)}
    counts = {sid: 0 for sid in staff_ids}
    for b in _blocking_bookings(store, day, now, None):
        if b.staff_id in counts:
            counts[b.staff_id] += 1
    return min(staff_ids, key=lambda sid: (staff[sid].priority, counts[sid], sid))
