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


@pytest.mark.django_db(transaction=True)
def test_an_invitation_can_be_accepted_only_once(store, staff, owner):
    """同じ招待を同時に受け入れても、参加できるのは1回だけ。"""
    from datetime import timedelta

    from django.utils import timezone

    from apps.stores.invitations import InvitationError, accept_invitation
    from apps.stores.models import Invitation, Membership

    from .conftest import user

    Invitation.objects.create(
        tenant=store,
        email="race@example.com",
        staff=staff[2],
        token="race-token",
        expires_at=timezone.now() + timedelta(days=1),
    )
    invited = user("race@example.com")
    results: list[str] = []
    barrier = threading.Barrier(4)

    def worker() -> None:
        try:
            barrier.wait()
            accept_invitation(invited, "race-token")
            results.append("ok")
        except InvitationError as e:
            results.append(e.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1 and results.count("invalid_invitation") == 3
    assert Membership.objects.filter(user=invited).count() == 1


@pytest.mark.django_db(transaction=True)
def test_google_event_appears_while_booking_is_being_confirmed_blocks_the_slot(service, staff, gcal):
    """確定の直前に、Googleカレンダーへ予定が入ったら（キャッシュが古くても）二重予約にしない。"""
    from apps.bookings.availability import available_slots

    from .conftest import NOW

    service.staff.set(staff[:1])
    owner = gcal.owner_of(staff[0])
    assert any(s.starts_at == at(10) for s in available_slots(service.tenant, service, at(10).date(), now=NOW))
    gcal.add_busy(owner, at(10), at(11))  # 画面に空きを出した後で、本人がGoogleに予定を入れた
    with pytest.raises(BookingError) as e:
        create_booking(service.tenant, service=service, starts_at=at(10), customer_name="x", now=NOW)
    assert e.value.code == "slot_unavailable"
