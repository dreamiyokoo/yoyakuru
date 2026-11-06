import smtplib

import pytest
from django.core import mail

from apps.bookings import tasks

from .conftest import at
from .test_admin_api import book


def test_queue_sends_through_the_task(service, staff):
    mail.outbox.clear()
    b = book(service, staff[0], at(10))
    mail.outbox.clear()
    tasks.queue_email("confirmed", b)  # テストではその場で実行される（CELERY_TASK_ALWAYS_EAGER）
    assert len(mail.outbox) == 1 and "確定" in mail.outbox[0].subject


def test_falls_back_to_sending_now_when_the_queue_is_down(monkeypatch, service, staff):
    b = book(service, staff[0], at(10))
    mail.outbox.clear()

    def broken(*args, **kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(tasks.send_booking_email, "delay", broken)
    tasks.queue_email("cancelled", b)
    assert len(mail.outbox) == 1 and "取消" in mail.outbox[0].subject


def test_unknown_kind_and_missing_booking(service):
    with pytest.raises(ValueError):
        tasks.queue_email("unknown", object())
    mail.outbox.clear()
    tasks.send_booking_email("hold", 999999)  # 消えた予約は何もしない
    assert mail.outbox == []


def test_send_failures_are_retried_with_backoff():
    task = tasks.send_booking_email
    assert smtplib.SMTPException in task.autoretry_for and OSError in task.autoretry_for
    assert task.max_retries == 5 and task.retry_backoff == 30


def test_obsolete_emails_are_not_sent(service, staff):
    from datetime import timedelta

    from django.utils import timezone

    from apps.bookings.models import BookingStatus

    b = book(service, staff[0], at(10))  # 確定済み
    b.status = BookingStatus.CANCELLED
    b.save()
    mail.outbox.clear()
    tasks.send_booking_email("confirmed", b.pk)  # 取消の後に、遅れた確定のメールは送らない
    tasks.send_booking_email("changed", b.pk)
    assert mail.outbox == []
    tasks.send_booking_email("cancelled", b.pk)
    assert len(mail.outbox) == 1

    b.status, b.hold_expires_at = BookingStatus.HOLD, timezone.now() - timedelta(minutes=1)
    b.save()
    mail.outbox.clear()
    tasks.send_booking_email("hold", b.pk)  # 期限切れの仮押さえに「15分以内に」は送らない
    assert mail.outbox == []
    b.hold_expires_at = timezone.now() + timedelta(minutes=10)
    b.save()
    tasks.send_booking_email("hold", b.pk)
    tasks.send_booking_email("cancelled", b.pk)  # 取消していない予約に取消のメールは送らない
    assert len(mail.outbox) == 1
