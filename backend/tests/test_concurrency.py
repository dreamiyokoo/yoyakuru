"""Webと電話から最後の1枠を同時に確定しても、重複予約にならない（AC-06）。"""

import threading

import pytest
from django.db import connection

from apps.bookings.models import Booking, Channel
from apps.bookings.services import BookingError, create_booking

from .conftest import at


@pytest.mark.django_db(transaction=True)
def test_last_slot_race(service, staff):
    service.staff.set(staff[:1])
    results: list[str] = []
    barrier = threading.Barrier(5)

    def worker(i: int) -> None:
        try:
            barrier.wait()
            create_booking(
                service.tenant,
                service=service,
                starts_at=at(10),
                customer_name=f"c{i}",
                customer_email=f"c{i}@example.com",
                channel=Channel.PHONE if i % 2 else Channel.WEB,
            )
            results.append("ok")
        except BookingError as e:
            results.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1
    assert results.count("slot_unavailable") == 4
    assert Booking.objects.filter(starts_at=at(10)).count() == 1


def _verify_at_once(user, code: str, n: int = 5) -> list[bool]:
    from apps.core import two_factor

    results: list[bool] = []
    barrier = threading.Barrier(n)

    def worker() -> None:
        try:
            barrier.wait()
            results.append(two_factor.verify(user, code))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


@pytest.mark.django_db(transaction=True)
def test_same_second_factor_code_is_accepted_only_once(owner):
    """同じ6桁・同じ回復コードを同時に送っても、通るのは1回だけ。"""
    import pyotp
    from django.contrib.auth.hashers import make_password

    from apps.core.models import TwoFactor

    TwoFactor.objects.filter(user=owner).update(recovery_codes=[make_password("abcde12345")])
    assert _verify_at_once(owner, pyotp.TOTP("JBSWY3DPEHPK3PXP").now()).count(True) == 1
    assert _verify_at_once(owner, "abcde-12345").count(True) == 1


@pytest.mark.django_db(transaction=True)
def test_an_invitation_can_be_accepted_only_once(store, staff, owner):
    """同じ招待を同時に受け入れても、参加できるのは1回だけ。"""
    from datetime import timedelta

    from django.utils import timezone
    from rest_framework.test import APIClient

    from apps.stores.models import Invitation, Membership

    Invitation.objects.create(
        tenant=store,
        email="race@example.com",
        staff=staff[2],
        token="race-token",
        expires_at=timezone.now() + timedelta(days=1),
    )
    results: list[int] = []
    barrier = threading.Barrier(4)

    def worker() -> None:
        try:
            barrier.wait()
            r = APIClient().post(
                "/api/v1/auth/invitations/race-token/accept", {"password": "a-good-pass-2026"}, format="json"
            )
            results.append(r.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(200) == 1 and Membership.objects.filter(user__email="race@example.com").count() == 1
