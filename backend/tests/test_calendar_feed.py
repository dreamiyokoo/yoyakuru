from rest_framework.test import APIClient

from apps.bookings.models import BookingStatus

from .conftest import client_for
from .test_admin_api import book
from .test_settings_api import far

FEED = "/api/v1/admin/tenants/fushimi/calendar-feed"


def test_staff_issues_reissues_and_stops_their_own_feed(store, staff, service, member):
    c = client_for(member)  # member は staff[1]
    assert c.get(FEED).json() == {"path": None, "shows_customer_name": False}
    path = c.post(FEED).json()["path"]
    assert path.startswith("/api/v1/public/calendar/") and path.endswith(".ics")

    mine = book(service, staff[1], far(10), email="a@example.com")
    book(service, staff[0], far(11), email="b@example.com")  # 他の担当者の予約は載らない
    cancelled = book(service, staff[1], far(15), email="c@example.com")
    cancelled.status = BookingStatus.CANCELLED
    cancelled.save()

    r = APIClient().get(path)
    assert r.status_code == 200 and r["Content-Type"].startswith("text/calendar")
    body = r.content.decode()
    assert body.count("BEGIN:VEVENT") == 1 and f"UID:booking-{mine.pk}@yoyakuru" in body
    assert "SUMMARY:予約あり：全身調整\r\n" in body
    assert "山田" not in body and "a@example.com" not in body  # 名前・連絡先は載せない（初期値）

    new_path = c.post(FEED).json()["path"]  # 再発行
    assert new_path != path
    assert APIClient().get(path).status_code == 404  # 古いURLは使えない
    assert APIClient().get(new_path).status_code == 200
    assert c.delete(FEED).json()["path"] is None
    assert APIClient().get(new_path).status_code == 404


def test_store_setting_adds_customer_name_but_never_contact(store, staff, service, member):
    store.calendar_shows_customer_name = True
    store.save()
    book(service, staff[1], far(10), email="a@example.com")
    path = client_for(member).post(FEED).json()["path"]
    body = APIClient().get(path).content.decode()
    assert "予約あり：全身調整（山田様）" in body and "a@example.com" not in body


def test_paused_staff_feed_stops_and_owner_without_staff_has_none(store, staff, service, member, owner):
    path = client_for(member).post(FEED).json()["path"]
    staff[1].is_active = False
    staff[1].save()
    assert APIClient().get(path).status_code == 404
    owner_membership = owner.memberships.get()
    owner_membership.staff = None
    owner_membership.save()
    assert client_for(owner).get(FEED).status_code == 403
    assert APIClient().get("/api/v1/public/calendar/.ics").status_code == 404


def test_owner_can_change_the_name_setting(store, owner):
    from .test_settings_history import _store

    c = client_for(owner)
    r = c.put(
        "/api/v1/admin/tenants/fushimi/settings/store",
        {**_store(store), "calendar_shows_customer_name": True},
        format="json",
    )
    assert r.status_code == 200
    store.refresh_from_db()
    assert store.calendar_shows_customer_name is True


def test_calendar_clients_asking_for_text_calendar_are_served(store, staff, service, member):
    path = client_for(member).post(FEED).json()["path"]
    r = APIClient().get(path, HTTP_ACCEPT="text/calendar")
    assert r.status_code == 200 and r.content.decode().startswith("BEGIN:VCALENDAR")
    missing = APIClient().get("/api/v1/public/calendar/nope.ics", HTTP_ACCEPT="text/calendar")
    assert missing.status_code == 404
    b = book(service, staff[0], far(10))
    ics = APIClient().get(f"/api/v1/public/bookings/{b.token}/ics", HTTP_ACCEPT="text/calendar")
    assert ics.status_code == 200 and b"BEGIN:VEVENT" in ics.content


def test_calendar_renderer_passes_text_through():
    from apps.bookings.ics import CalendarRenderer

    assert CalendarRenderer().render("BEGIN:VCALENDAR") == b"BEGIN:VCALENDAR"
    assert CalendarRenderer().render({"detail": "見つかりません"}) == "見つかりません".encode()
