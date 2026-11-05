import pytest
from django.core.exceptions import ValidationError

from bookings.ics import _fold, build_ics
from bookings.services import create_booking
from stores.models import validate_store_slug

from .conftest import NOW, at


@pytest.mark.parametrize("slug", ["fushimi", "abc", "a-b-1"])
def test_valid_slugs(slug):
    validate_store_slug(slug)


@pytest.mark.parametrize("slug", ["ab", "Abc", "-abc", "abc-", "api", "mcp", "a_b"])
def test_invalid_slugs(slug):
    with pytest.raises(ValidationError):
        validate_store_slug(slug)


def test_ics_folding_and_escape(service):
    b = create_booking(service.store, service=service, starts_at=at(10), customer_name="x", now=NOW).booking
    text = build_ics(b, cancel_url="https://example.com/c?token=" + "a" * 80)
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    assert "UID:booking-" in text and "\\n" in text
    assert _fold("あ" * 40).count("\r\n ") >= 1


def test_str_methods(service, staff, beds):
    assert (
        str(service.store) == "伏見整体院"
        and str(staff[0]) == "Aさん"
        and str(beds) == "ベッド"
        and str(service) == "全身調整"
    )
    b = create_booking(service.store, service=service, starts_at=at(10), customer_name="山田", now=NOW).booking
    assert str(b).startswith("山田 2026-11-11")


def test_emails_skip_without_address(service):
    from django.core import mail

    from bookings import emails

    b = create_booking(service.store, service=service, starts_at=at(10), customer_name="x", now=NOW).booking
    for fn in (emails.send_hold_email, emails.send_confirmed_email, emails.send_cancelled_email):
        fn(b)
    assert mail.outbox == []
