"""Webと電話から最後の1枠を同時に確定しても、重複予約にならない（AC-06）。"""

import threading

import pytest
from django.db import connection

from bookings.models import Booking, Channel
from bookings.services import BookingError, create_booking

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
                service.store,
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
