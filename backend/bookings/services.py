"""予約の仮押さえ・確定・取消（BOOK-05〜07、CUST-02〜06、TIME-06）。

同時の確定で二重予約にならないよう、店舗の行をロックしてから空きを再確認する（AC-06）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

from stores.models import Service, Staff, Store

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
    BookingEvent.objects.create(booking=booking, action=action, channel=channel, actor=actor, detail=detail)


def create_booking(
    store: Store,
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
        Store.objects.select_for_update().get(pk=store.pk)
        if idempotency_key:
            existing = Booking.objects.filter(store=store, idempotency_key=idempotency_key).first()
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
        uses_resource = service.resource_id is not None and not _joins_existing_group(
            store, service, staff_id, slot, now
        )
        booking = Booking.objects.create(
            store=store,
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


def _joins_existing_group(store: Store, service: Service, staff_id: int, slot, now: datetime) -> bool:
    if service.capacity <= 1:
        return False
    return (
        Booking.objects.blocking(now)
        .filter(store=store, service=service, staff_id=staff_id, starts_at=slot.starts_at)
        .exists()
    )


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
    days = booking.store.cancel_deadline_days
    if days == 0:
        return booking.starts_at
    local_day = booking.starts_at.astimezone(store_tz(booking.store)).date()
    return datetime.combine(local_day - timedelta(days=days - 1), time.min, store_tz(booking.store))


def cancel_by_token(token: str, now: datetime | None = None) -> Booking:
    """お客様による取消（CUST-04〜06）。取消で枠はすぐに解放される。"""
    now = now or timezone.now()
    with transaction.atomic():
        booking = Booking.objects.select_for_update().select_related("store").filter(token=token).first()
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


def expire_holds(now: datetime | None = None) -> int:
    """期限を過ぎた仮押さえを期限切れにする。空き判定は期限で除外するため、これは記録の整理。"""
    now = now or timezone.now()
    return Booking.objects.filter(status=BookingStatus.HOLD, hold_expires_at__lte=now).update(
        status=BookingStatus.EXPIRED
    )
