"""予約のGoogleカレンダーへの書き込み（確定・変更・取消）。

予約のマスターはヨヤクルのDB。Googleの予定は、DBの予約の今の状態に合わせて作り直す片方向の写し。
何度実行しても同じ結果になる（予定のIDが予約ごとに固定）。接続が切れていれば何もしない。
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db import transaction

from apps.core import google

from .models import Booking, BookingStatus

log = logging.getLogger(__name__)


def event_body(booking: Booking) -> dict:
    store = booking.tenant
    lines = [
        f"お客様：{booking.customer_name}様（{booking.get_customer_type_display()}）",
        f"連絡先：{booking.customer_phone or booking.customer_email or '—'}",
    ]
    if booking.note:
        lines.append(f"ご要望：{booking.note}")
    lines.append(f"経路：{booking.get_channel_display()}")
    lines.append(f"予約の詳細：{settings.ADMIN_APP_URL}/bookings/{booking.pk}")
    return {
        "summary": f"{booking.service.name} {booking.customer_name}様",
        "description": "\n".join(lines),
        "location": store.address,
        "start": {"dateTime": booking.starts_at.isoformat(), "timeZone": store.timezone},
        "end": {"dateTime": booking.ends_at.isoformat(), "timeZone": store.timezone},
        "reminders": {"useDefault": True},
        "extendedProperties": {"private": {google.MARK: "1", "booking": str(booking.pk)}},
    }


def sync_booking(booking_id: int) -> None:
    """予約の今の状態を、担当スタッフのカレンダーに合わせる。"""
    with transaction.atomic():
        booking = (
            Booking.objects.select_for_update(of=("self",))
            .select_related("tenant", "service", "staff", "gcal_user")
            .filter(pk=booking_id)
            .first()
        )
        if booking is None:
            return
        confirmed = booking.status == BookingStatus.CONFIRMED
        want = google.calendar_owners([booking.staff]).get(booking.staff_id) if confirmed else None
        holder = booking.gcal_user
        if holder and (want is None or want.pk != holder.pk):
            # 取消、または担当が替わった。予定のあるカレンダーから消す（接続が切れていれば消せないので手放す）
            try:
                google.delete_event(holder, booking.pk)
            except google.Disconnected:
                pass
            booking.gcal_user = holder = None
            booking.save(update_fields=["gcal_user"])
        if want is not None:
            google.upsert_event(want, booking.pk, event_body(booking))
            if holder is None:
                booking.gcal_user = want
                booking.save(update_fields=["gcal_user"])
        elif confirmed:
            log.warning("booking %s: staff %s has no connected Google calendar", booking.pk, booking.staff_id)


@shared_task(autoretry_for=(google.Unavailable,), retry_backoff=30, retry_backoff_max=600, max_retries=5)
def sync_booking_task(booking_id: int) -> None:
    try:
        sync_booking(booking_id)
    except google.Disconnected:
        log.warning("booking %s: Google calendar disconnected; event not synced", booking_id)


def queue_sync(booking_id: int) -> None:
    """トランザクションが確定してから、書き込みを依頼する。依頼先に届かなくても予約の処理は止めない。"""

    def run() -> None:
        try:
            sync_booking_task.delay(booking_id)
        except Exception:  # noqa: BLE001
            log.exception("could not queue calendar sync for booking %s", booking_id)

    transaction.on_commit(run)
