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
