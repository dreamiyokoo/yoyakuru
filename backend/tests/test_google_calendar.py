"""Googleカレンダー連携：空き判定への反映、予約の書き込み（冪等）、接続切れ。Googleは呼ばず、置き換えて確かめる。"""

from datetime import datetime, timedelta

import pytest
import requests
from allauth.socialaccount.models import SocialAccount, SocialToken
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.utils import timezone

from apps.bookings import calendar_sync
from apps.bookings.availability import available_slots
from apps.bookings.models import Booking
from apps.bookings.services import cancel_by_store, confirm_by_token, create_booking, reschedule_booking
from apps.core import google
from apps.stores.models import Membership

from .conftest import NOW, Response, at, client_for, user

BASE = "/api/v1/admin/tenants/fushimi"
TZ = at(0).tzinfo


def confirmed(service, staff, start=None):
    return create_booking(
        service.tenant,
        service=service,
        staff=staff,
        starts_at=start or at(10),
        customer_name="山田",
        customer_email="c@example.com",
        confirm=True,
        now=NOW,
    ).booking


def events(gcal, staff):
    return gcal.events.get(gcal.owner_of(staff).pk, {})


def slot_times(service, **kw):
    return {s.starts_at for s in available_slots(service.tenant, service, at(10).date(), now=NOW, **kw)}


def event(start, end, **extra):
    return {"start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}, **extra}


class TestBusy:
    def test_only_real_busy_time_blocks(self, staff, gcal, monkeypatch):
        owner = gcal.owner_of(staff[0])
        items = [
            event(at(10), at(11)),
            event(at(11), at(12), transparency="transparent"),  # 空き時間として登録した予定
            event(at(12), at(13), attendees=[{"self": True, "responseStatus": "declined"}]),  # 辞退した予定
            event(at(14), at(15), status="cancelled"),
            event(at(15), at(16), extendedProperties={"private": {"yoyakuru": "1"}}),  # ヨヤクルが書いた予定
        ]
        monkeypatch.setattr(google, "_send", lambda *a, **k: Response(200, {"items": items}))
        assert google.busy_intervals(owner, at(9), at(20), TZ) == [(at(10), at(11))]
        cache.clear()
        all_day = {"start": {"date": "2026-11-11"}, "end": {"date": "2026-11-12"}}
        monkeypatch.setattr(google, "_send", lambda *a, **k: Response(200, {"items": [all_day]}))
        assert google.busy_intervals(owner, at(9), at(20), TZ) == [(at(0), at(0) + timedelta(days=1))]

    def test_pages_and_cache(self, staff, gcal, monkeypatch):
        owner = gcal.owner_of(staff[0])
        pages = [{"items": [event(at(10), at(11))], "nextPageToken": "p2"}, {"items": [event(at(12), at(13))]}]
        calls = []

        def send(method, url, **kw):
            calls.append(kw["params"].get("pageToken"))
            return Response(200, pages[len(calls) % 2 - 1 if len(calls) % 2 else 1])

        monkeypatch.setattr(google, "_send", send)
        assert google.busy_intervals(owner, at(9), at(20), TZ) == [(at(10), at(11)), (at(12), at(13))]
        assert calls == [None, "p2"]
        google.busy_intervals(owner, at(9), at(20), TZ)  # 短時間はキャッシュから
        assert len(calls) == 2
        google.busy_intervals(owner, at(9), at(20), TZ, fresh=True)  # 確定の直前は取り直す
        assert len(calls) == 4


class TestAvailability:
    def test_unconnected_or_unreadable_staff_get_no_slots(self, service, staff, gcal, monkeypatch):
        service.staff.set(staff[:2])
        owners = gcal.owner_of
        monkeypatch.setattr(google, "calendar_owners", lambda s: {x.id: owners(x) for x in s if x.id == staff[0].id})
        ids = {i for s in available_slots(service.tenant, service, at(10).date(), now=NOW) for i in s.staff_ids}
        assert ids == {staff[0].id}  # 未接続のBさんは出ない
        gcal.fail_with = 500
        cache.clear()
        assert slot_times(service) == set()  # 読めなければ出さない（安全側）

    def test_final_check_ignores_a_stale_cache(self, service, staff, gcal):
        service.staff.set(staff[:1])
        assert at(10) in slot_times(service)
        gcal.add_busy(gcal.owner_of(staff[0]), at(10), at(11))
        assert at(10) in slot_times(service)  # 画面の表示は最大1分古い
        assert at(10) not in slot_times(service, fresh_busy=True)  # 確定の直前の再確認は最新

    def test_settings_check_does_not_call_google(self, service, staff, gcal):
        slots = available_slots(service.tenant, service, at(10).date(), now=NOW, use_calendar=False)
        assert slots and gcal.calls == []


class TestSync:
    def test_confirm_writes_one_event_and_cancel_deletes_it(
        self, service, staff, gcal, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            b = confirmed(service, staff[0])
        ev = events(gcal, staff[0])[google.event_id(b.pk)]
        assert ev["summary"] == "全身調整 山田様" and ev["extendedProperties"]["private"]["yoyakuru"] == "1"
        assert datetime.fromisoformat(ev["start"]["dateTime"]) == at(10) and f"/bookings/{b.pk}" in ev["description"]
        for _ in range(2):  # 何度同期しても1件のまま
            calendar_sync.sync_booking(b.pk)
        assert len(events(gcal, staff[0])) == 1
        with django_capture_on_commit_callbacks(execute=True):
            cancel_by_store(b, None)
        assert events(gcal, staff[0]) == {}
        calendar_sync.sync_booking(b.pk)  # 取消の後の再実行も問題ない
        assert Booking.objects.get(pk=b.pk).gcal_user is None

    def test_own_event_does_not_block_the_same_slot(self, service, staff, gcal, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            b = confirmed(service, staff[0])
        with django_capture_on_commit_callbacks(execute=True):
            reschedule_booking(b, starts_at=at(10), staff=staff[0], actor=None, now=NOW)
        assert len(events(gcal, staff[0])) == 1

    def test_changing_staff_moves_the_event(self, service, staff, gcal, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            b = confirmed(service, staff[0])
        with django_capture_on_commit_callbacks(execute=True):
            reschedule_booking(b, starts_at=at(15), staff=staff[1], actor=None, now=NOW)
        assert events(gcal, staff[0]) == {}
        assert datetime.fromisoformat(events(gcal, staff[1])[google.event_id(b.pk)]["start"]["dateTime"]) == at(15)

    def test_hold_is_written_only_after_confirmation(self, service, staff, gcal, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            b = create_booking(
                service.tenant, service=service, staff=staff[0], starts_at=at(10), customer_name="x", now=NOW
            ).booking
        assert events(gcal, staff[0]) == {}
        with django_capture_on_commit_callbacks(execute=True):
            confirm_by_token(b.token, now=NOW)
        assert len(events(gcal, staff[0])) == 1

    def test_existing_event_is_updated(self, service, staff, gcal):
        b = confirmed(service, staff[0])
        calendar_sync.sync_booking(b.pk)
        gcal.events[gcal.owner_of(staff[0]).pk][google.event_id(b.pk)] = {"stale": True}
        calendar_sync.sync_booking(b.pk)  # 409 → 更新
        assert "summary" in events(gcal, staff[0])[google.event_id(b.pk)]

    def test_unconnected_staff_and_missing_booking_are_skipped(self, service, staff, gcal, monkeypatch):
        b = confirmed(service, staff[0])
        gcal.calls.clear()
        monkeypatch.setattr(google, "calendar_owners", lambda s: {})
        calendar_sync.sync_booking(b.pk)
        calendar_sync.sync_booking(0)
        assert gcal.calls == []

    def test_disconnected_calendar_is_not_an_error(self, service, staff, gcal, monkeypatch):
        b = confirmed(service, staff[0])

        def deny(*a, **k):
            raise google.Disconnected("x")

        monkeypatch.setattr(google, "upsert_event", deny)
        calendar_sync.sync_booking_task(b.pk)

    def test_queue_survives_a_broker_outage(self, service, staff, monkeypatch, django_capture_on_commit_callbacks):
        def boom(_):
            raise OSError("redis down")

        monkeypatch.setattr(calendar_sync.sync_booking_task, "delay", boom)
        with django_capture_on_commit_callbacks(execute=True):
            confirmed(service, staff[0])


@pytest.mark.django_db
class TestConnection:
    @pytest.fixture(autouse=True)
    def _app(self, settings):
        settings.SOCIALACCOUNT_PROVIDERS = {"google": {"APP": {"client_id": "id", "secret": "s"}}}

    def connect(self, email, secret="refresh-1", expires=None):
        u = get_user_model().objects.filter(email=email).first() or user(email)
        acc = SocialAccount.objects.create(user=u, provider="google", uid=email)
        SocialToken.objects.create(
            account=acc, token="old", token_secret=secret, expires_at=expires or timezone.now() + timedelta(hours=1)
        )
        return u

    def test_calendar_owners_need_membership_and_refresh_token(self, real_google, staff, owner, member):
        assert real_google.calendar_owners(staff) == {}
        self.connect("owner@example.com")  # オーナー（Aさん）だけ接続
        assert list(real_google.calendar_owners(staff)) == [staff[0].id]
        self.connect("staff@example.com", secret="")  # 更新用のトークンがない
        assert list(real_google.calendar_owners(staff)) == [staff[0].id]
        assert real_google.connected(owner)
        Membership.objects.filter(user=owner).update(is_active=False)
        assert real_google.calendar_owners(staff) == {}

    def test_refresh_updates_the_access_token(self, real_google, monkeypatch):
        u = self.connect("refresh@example.com", expires=timezone.now() - timedelta(minutes=1))
        sent = []

        def send(method, url, **kw):
            sent.append(url)
            return Response(200, {"access_token": "new", "expires_in": 3600})

        monkeypatch.setattr(real_google, "_send", send)
        assert real_google.access_token(u) == "new" and sent == [real_google.TOKEN_URL]
        assert real_google.access_token(u) == "new" and len(sent) == 1  # 期限内は更新しない

    def test_revoked_refresh_token_disconnects_and_notifies_once(self, real_google, staff, owner, member, monkeypatch):
        self.connect("owner@example.com")
        u = self.connect("staff@example.com", expires=timezone.now() - timedelta(minutes=1))
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: Response(400, {"error": "invalid_grant"}))
        for _ in range(2):
            with pytest.raises(real_google.Disconnected):
                real_google.access_token(u)
        assert not real_google.connected(u)
        assert len(mail.outbox) == 1  # 知らせは1度だけ
        assert sorted(mail.outbox[0].to) == ["owner@example.com", "staff@example.com"]
        assert "Bさん" not in mail.outbox[0].body and "伏見整体院" in mail.outbox[0].subject

    def test_temporary_failure_keeps_the_connection(self, real_google, monkeypatch):
        u = self.connect("flaky@example.com", expires=timezone.now() - timedelta(minutes=1))
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: Response(503, {}))
        with pytest.raises(real_google.Unavailable):
            real_google.access_token(u)
        assert real_google.connected(u)
        with pytest.raises(real_google.Disconnected):
            real_google.access_token(user("nobody@example.com"))

    def test_api_errors(self, real_google, monkeypatch):
        u = self.connect("api@example.com")
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: Response(500, {}))
        with pytest.raises(real_google.Unavailable):
            real_google.verify_calendar(u)
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: Response(403, {}))  # 権限を外された
        with pytest.raises(real_google.Disconnected):
            real_google.verify_calendar(u)
        assert not real_google.connected(u)

    def test_expired_access_token_is_refreshed_once_and_retried(self, real_google, monkeypatch):
        u = self.connect("retry@example.com")
        replies = [Response(401, {}), Response(200, {"access_token": "fresh", "expires_in": 3600}), Response(200, {})]
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: replies.pop(0))
        real_google.verify_calendar(u)
        assert not replies

    def test_deleting_a_missing_event_is_fine(self, real_google, monkeypatch):
        u = self.connect("del@example.com")
        monkeypatch.setattr(real_google, "_send", lambda *a, **k: Response(404, {}))
        real_google.delete_event(u, 1)

    def test_network_errors_are_temporary(self, real_google, monkeypatch):
        def boom(*a, **k):
            raise requests.ConnectionError("down")

        monkeypatch.setattr(requests, "request", boom)
        with pytest.raises(real_google.Unavailable):
            real_google._send("GET", "https://example.invalid")

    def test_fake_mode_returns_an_empty_calendar(self, real_google, settings):
        settings.GOOGLE_FAKE = True
        assert real_google._send("GET", "x").json()["items"] == []
        assert real_google._send("DELETE", "x").status_code == 204

    def test_notification_failure_does_not_break(self, real_google, store, staff, owner, monkeypatch):
        def boom(self):
            raise OSError("smtp down")

        monkeypatch.setattr("django.core.mail.EmailMessage.send", boom)
        real_google.notify_disconnected(owner)


class TestAdminScreens:
    def test_owner_sees_which_staff_are_hidden(self, service, staff, owner, gcal, monkeypatch):
        monkeypatch.setattr(
            google, "calendar_owners", lambda s: {x.id: gcal.owner_of(x) for x in s if x.id != staff[2].id}
        )
        r = client_for(owner).get(f"{BASE}/options").json()
        assert r["calendar_issues"] == [{"staff_id": staff[2].id, "name": "Cさん"}]
        rows = client_for(owner).get(f"{BASE}/settings/staff").json()
        assert {r["display_name"]: r["calendar_connected"] for r in rows} == {
            "Aさん": True,
            "Bさん": True,
            "Cさん": False,
        }

    def test_staff_sees_only_own_issue(self, service, staff, member, monkeypatch):
        monkeypatch.setattr(google, "calendar_owners", lambda s: {})
        r = client_for(member).get(f"{BASE}/options").json()
        assert r["calendar_issues"] == [{"staff_id": staff[1].id, "name": "Bさん"}]

    def test_me_tells_whether_my_calendar_is_connected(self, real_google, owner):
        assert client_for(owner).get("/api/v1/auth/me").json()["calendar_connected"] is False
        acc = SocialAccount.objects.create(user=owner, provider="google", uid="o")
        SocialToken.objects.create(account=acc, token="t", token_secret="r")
        assert client_for(owner).get("/api/v1/auth/me").json()["calendar_connected"] is True
