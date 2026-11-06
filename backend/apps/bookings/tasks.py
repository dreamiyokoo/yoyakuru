"""お客様へのメールを、予約の処理と切り離して送る（Celery）。

送信の失敗（メールサーバーの一時的な不調など）は、間隔を空けて数回やり直す。
"""

from __future__ import annotations

import logging
import smtplib

from celery import shared_task
from django.utils import timezone

from . import emails
from .models import Booking, BookingStatus

log = logging.getLogger(__name__)

SENDERS = {
    "hold": emails.send_hold_email,
    "confirmed": emails.send_confirmed_email,
    "cancelled": emails.send_cancelled_email,
    "changed": emails.send_changed_email,
}


@shared_task(
    autoretry_for=(smtplib.SMTPException, OSError),
    retry_backoff=30,
    retry_backoff_max=600,
    max_retries=5,
)
def send_booking_email(kind: str, booking_id: int) -> None:
    booking = Booking.objects.select_related("tenant", "service", "staff").filter(pk=booking_id).first()
    if booking is None:
        log.warning("booking %s not found for %s email", booking_id, kind)
        return
    if not still_relevant(kind, booking):
        # 遅れて送る・やり直すまでの間に状態が変わった。取消の後に確定のメールが届く等を防ぐ
        log.info("skip obsolete %s email for booking %s (%s)", kind, booking_id, booking.status)
        return
    SENDERS[kind](booking)


def still_relevant(kind: str, booking: Booking) -> bool:
    """送ろうとしているメールが、予約の今の状態に合っているか。"""
    if kind == "hold":
        return booking.status == BookingStatus.HOLD and bool(
            booking.hold_expires_at and booking.hold_expires_at > timezone.now()
        )
    if kind in ("confirmed", "changed"):
        return booking.status == BookingStatus.CONFIRMED
    return booking.status == BookingStatus.CANCELLED


def queue_email(kind: str, booking: Booking) -> None:
    """メールの送信を依頼する。依頼先（Redis）に届かないときは、その場で送る（予約の処理は止めない）。"""
    if kind not in SENDERS:
        raise ValueError(kind)
    try:
        send_booking_email.delay(kind, booking.pk)
    except Exception:  # noqa: BLE001  依頼先の障害でも、お客様へのメールは落とさない
        log.exception("could not queue %s email for booking %s; sending now", kind, booking.pk)
        SENDERS[kind](booking)
