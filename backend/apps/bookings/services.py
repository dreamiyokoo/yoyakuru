"""予約の仮押さえ・確定・取消（BOOK-05〜07、CUST-02〜06、TIME-06）。

同時の確定で二重予約にならないよう、店舗の行をロックしてから空きを再確認する（AC-06）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

from apps.stores.models import Service, Staff
from apps.tenants.models import Tenant

from .availability import available_slots, choose_staff, store_tz
from .models import Booking, BookingEvent, BookingStatus, Channel

HOLD_MINUTES = 15


@dataclass
class BookingError(Exception):
    code: str
    message: str
    status: int = 400


@dataclass
class HoldResult:
    booking: Booking
    replayed: bool = False


def _event(booking: Booking, action: str, channel: str, actor=None, **detail) -> None:
    BookingEvent.objects.create(
        tenant=booking.tenant, booking=booking, action=action, channel=channel, actor=actor, detail=detail
    )


def create_booking(
    store: Tenant,
    *,
    service: Service,
    starts_at: datetime,
    customer_name: str,
    customer_email: str = "",
    customer_phone: str = "",
    note: str = "",
    customer_type: str = "repeat",
    staff: Staff | None = None,
    channel: str = Channel.WEB,
    idempotency_key: str | None = None,
    ai_assisted: bool = False,
    party_size: int = 1,
    confirm: bool = False,
    actor=None,
    now: datetime | None = None,
) -> HoldResult:
    """空きを再確認して予約を作る。confirm=False なら15分の仮押さえ。"""
    now = now or timezone.now()
    with transaction.atomic():
        Tenant.objects.select_for_update().get(pk=store.pk)
        if idempotency_key:
            existing = Booking.objects.filter(tenant=store, idempotency_key=idempotency_key).first()
            if existing:
                return HoldResult(existing, replayed=True)
        day = starts_at.astimezone(store_tz(store)).date()
        slots = available_slots(
            store, service, day, customer_type, staff, now, party_size, enforce_cutoff=channel != Channel.ADMIN
        )
        slot = next((s for s in slots if s.starts_at == starts_at), None)
        if slot is None:
            raise BookingError("slot_unavailable", "選んだ枠は、ほかの予約で埋まったか、受付できない時間です", 409)
        auto = staff is None
        staff_id = choose_staff(store, slot.staff_ids, day, now) if auto else staff.id
        uses_resource = service.resource_id is not None
        booking = Booking.objects.create(
            tenant=store,
            service=service,
            staff_id=staff_id,
            resource=service.resource if uses_resource else None,
            resource_quantity=service.resource_quantity if uses_resource else 0,
            party_size=party_size,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            occupied_from=slot.occupied_from,
            occupied_until=slot.occupied_until,
            status=BookingStatus.CONFIRMED if confirm else BookingStatus.HOLD,
            hold_expires_at=None if confirm else now + timedelta(minutes=HOLD_MINUTES),
            confirmed_at=now if confirm else None,
            channel=channel,
            ai_assisted=ai_assisted,
            auto_assigned=auto,
            customer_type=customer_type,
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
            note=note,
            idempotency_key=idempotency_key or None,
        )
        _event(booking, "confirmed" if confirm else "held", channel, actor)
    return HoldResult(booking)


def confirm_by_token(token: str, now: datetime | None = None) -> Booking:
    """確認メールのリンクで予約を確定する（CUST-02）。何度開いても同じ結果になる。"""
    now = now or timezone.now()
    with transaction.atomic():
        booking = Booking.objects.select_for_update().filter(token=token).first()
        if booking is None:
            raise BookingError("not_found", "予約が見つかりません", 404)
        if booking.status == BookingStatus.CONFIRMED:
            return booking
        if booking.status == BookingStatus.HOLD and booking.hold_expires_at and booking.hold_expires_at > now:
            booking.status = BookingStatus.CONFIRMED
            booking.confirmed_at = now
            booking.save(update_fields=["status", "confirmed_at"])
            _event(booking, "confirmed", booking.channel)
            return booking
        if booking.status == BookingStatus.HOLD:
            booking.status = BookingStatus.EXPIRED
            booking.save(update_fields=["status"])
            _event(booking, "expired", booking.channel)
    # 期限切れの記録を残すため、エラーはトランザクションの外で出す
    if booking.status == BookingStatus.EXPIRED:
        raise BookingError("hold_expired", "確認の期限（15分）を過ぎたため、枠は解放されました", 410)
    raise BookingError("cancelled", "この予約は取消されています", 409)


def cancel_deadline(booking: Booking) -> datetime:
    """セルフ取消の締切（CUST-05）。cancel_deadline_days=1 なら前日の終わりまで。"""
    days = booking.tenant.cancel_deadline_days
    if days == 0:
        return booking.starts_at
    local_day = booking.starts_at.astimezone(store_tz(booking.tenant)).date()
    return datetime.combine(local_day - timedelta(days=days - 1), time.min, store_tz(booking.tenant))


def cancel_by_token(token: str, now: datetime | None = None) -> Booking:
    """お客様による取消（CUST-04〜06）。取消で枠はすぐに解放される。"""
    now = now or timezone.now()
    with transaction.atomic():
        booking = Booking.objects.select_for_update().select_related("tenant").filter(token=token).first()
        if booking is None:
            raise BookingError("not_found", "予約が見つかりません", 404)
        if booking.status == BookingStatus.CANCELLED:
            return booking
        if booking.status not in (BookingStatus.CONFIRMED, BookingStatus.HOLD):
            raise BookingError("not_cancellable", "この予約は取消できません", 409)
        if now >= cancel_deadline(booking):
            raise BookingError("cancel_deadline_passed", "取消の締切を過ぎています。店舗にお電話ください", 403)
        booking.status = BookingStatus.CANCELLED
        booking.cancelled_at = now
        booking.save(update_fields=["status", "cancelled_at"])
        _event(booking, "cancelled", Channel.WEB)
    return booking


def cancel_by_store(booking: Booking, actor, now: datetime | None = None) -> Booking:
    """店舗による取消。締切はなく、取消で枠はすぐに解放される。"""
    now = now or timezone.now()
    with transaction.atomic():
        locked = Booking.objects.select_for_update().get(pk=booking.pk)
        if locked.status == BookingStatus.CANCELLED:
            return locked
        if locked.status not in (BookingStatus.CONFIRMED, BookingStatus.HOLD):
            raise BookingError("not_cancellable", "この予約は取消できません", 409)
        locked.status = BookingStatus.CANCELLED
        locked.cancelled_at = now
        locked.save(update_fields=["status", "cancelled_at"])
        _event(locked, "cancelled", Channel.ADMIN, actor)
    return locked


def reschedule_booking(
    booking: Booking, *, starts_at: datetime, staff: Staff, actor, now: datetime | None = None
) -> Booking:
    """日時・担当の変更（ASSIGN-04）。通常の予約と同じ空き判定で再確認する。受付の締切は適用しない。"""
    now = now or timezone.now()
    with transaction.atomic():
        Tenant.objects.select_for_update().get(pk=booking.tenant_id)
        locked = Booking.objects.select_for_update().select_related("service", "tenant").get(pk=booking.pk)
        if locked.status != BookingStatus.CONFIRMED:
            raise BookingError("not_changeable", "確定した予約だけ変更できます", 409)
        day = starts_at.astimezone(store_tz(locked.tenant)).date()
        slots = available_slots(
            locked.tenant,
            locked.service,
            day,
            locked.customer_type,
            staff,
            now,
            locked.party_size,
            exclude_booking_id=locked.pk,
            enforce_cutoff=False,
        )
        slot = next((s for s in slots if s.starts_at == starts_at), None)
        if slot is None:
            raise BookingError("slot_unavailable", "その日時・担当では空きがありません", 409)
        before = {"starts_at": locked.starts_at.isoformat(), "staff_id": locked.staff_id}
        locked.staff = staff
        locked.starts_at, locked.ends_at = slot.starts_at, slot.ends_at
        locked.occupied_from, locked.occupied_until = slot.occupied_from, slot.occupied_until
        locked.auto_assigned = False
        locked.save(update_fields=["staff", "starts_at", "ends_at", "occupied_from", "occupied_until", "auto_assigned"])
        _event(locked, "rescheduled", Channel.ADMIN, actor, before=before)
    return locked


def expire_holds(now: datetime | None = None) -> int:
    """期限を過ぎた仮押さえを期限切れにする。空き判定は期限で除外するため、これは記録の整理。"""
    now = now or timezone.now()
    return Booking.objects.filter(status=BookingStatus.HOLD, hold_expires_at__lte=now).update(
        status=BookingStatus.EXPIRED
    )
