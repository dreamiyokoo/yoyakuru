from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest

from apps.stores.models import BusinessHours, RecurringBreak, Resource, Service, Staff, WeeklyShift
from apps.tenants.models import Tenant

TZ = ZoneInfo("Asia/Tokyo")
NOW = datetime(2026, 11, 9, 9, 0, tzinfo=TZ)  # 月曜 9:00
DAY = date(2026, 11, 11)  # 水曜


def at(h: int, m: int = 0, day: date = DAY) -> datetime:
    return datetime.combine(day, time(h, m), TZ)


@pytest.fixture
def store(db):
    s = Tenant.objects.create(subdomain="fushimi", name="伏見整体院", phone="075-000-0000", address="京都市伏見区")
    for wd in range(6):  # 月〜土
        BusinessHours.objects.create(tenant=s, weekday=wd, opens_at=time(10), closes_at=time(20))
    RecurringBreak.objects.create(tenant=s, starts_at=time(13), ends_at=time(14))
    return s


@pytest.fixture
def staff(store):
    members = [
        Staff.objects.create(tenant=store, display_name=n, priority=p)
        for n, p in (("Aさん", 1), ("Bさん", 2), ("Cさん", 3))
    ]
    for m in members:
        for wd in range(6):
            WeeklyShift.objects.create(tenant=store, staff=m, weekday=wd, starts_at=time(10), ends_at=time(20))
    return members


@pytest.fixture
def beds(store):
    return Resource.objects.create(tenant=store, name="ベッド", quantity=2)


@pytest.fixture
def service(store, staff, beds):
    s = Service.objects.create(
        tenant=store, name="全身調整", price=5000, duration_minutes=60, first_visit_duration_minutes=90, resource=beds
    )
    s.staff.set(staff)
    return s


def user(email):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username=email, email=email)


def client_for(u):
    from rest_framework.test import APIClient

    c = APIClient()
    c.force_login(u)
    return c


@pytest.fixture
def owner(store, staff):
    from apps.stores.models import Membership, Role

    u = user("owner@example.com")
    Membership.objects.create(tenant=store, user=u, role=Role.OWNER, staff=staff[0])
    return u


@pytest.fixture
def member(store, staff):
    from apps.stores.models import Membership, Role

    u = user("staff@example.com")
    Membership.objects.create(tenant=store, user=u, role=Role.STAFF, staff=staff[1])
    return u


@pytest.fixture(autouse=True)
def _fresh_cache():
    """回数制限（ログイン等）をテストごとに数え直す。"""
    from django.core.cache import cache

    cache.clear()
    yield


class FakeGoogle:
    """Googleカレンダー。担当者ごとの予定（busy）と、書き込まれた予定を持つ。"""

    def __init__(self):
        self.busy: dict[int, list[tuple[datetime, datetime]]] = {}  # ユーザーID -> 他アプリの予定
        self.events: dict[int, dict[str, dict]] = {}  # ユーザーID -> 予定ID -> 内容
        self.calls: list[tuple[str, str]] = []
        self.fail_with: int | None = None  # 次の呼び出しに返すHTTPステータス

    def add_busy(self, user, start, end):
        self.busy.setdefault(user.pk, []).append((start, end))

    def send(self, method, url, headers=None, params=None, json=None, data=None):
        import re

        uid = int((headers or {})["Authorization"].removeprefix("Bearer tok"))
        path = url.split("/calendars/primary", 1)[1]
        self.calls.append((method, path))
        if self.fail_with:
            return Response(self.fail_with, {})
        mine = self.events.setdefault(uid, {})
        if method == "GET":
            items = [
                {"start": {"dateTime": s.isoformat()}, "end": {"dateTime": e.isoformat()}}
                for s, e in self.busy.get(uid, [])
            ]
            # ヨヤクルが書いた予定は、予定の目印つきで返ってくる
            items += [{**ev, "status": "confirmed"} for ev in mine.values()]
            return Response(200, {"items": items})
        if method == "POST":
            if json["id"] in mine:
                return Response(409, {})
            mine[json["id"]] = json
            return Response(200, json)
        eid = re.search(r"/events/([^/]+)$", path).group(1)
        if method == "PUT":
            mine[eid] = json
            return Response(200, json)
        if method == "DELETE":
            return Response(204 if mine.pop(eid, None) else 404, {})
        raise AssertionError(method)


class Response:
    def __init__(self, status_code, body):
        self.status_code, self._body = status_code, body

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def gcal(monkeypatch):
    """Googleを呼ばないテスト用の差し替え。全員のカレンダーが接続済みで、予定は空。"""
    from django.contrib.auth import get_user_model

    from apps.core import google as g

    fake = FakeGoogle()
    fake.real = {"calendar_owners": g.calendar_owners, "access_token": g.access_token, "_send": g._send}
    users = {}

    def owners(staff):
        out = {}
        for s in staff:
            if s.id not in users:
                users[s.id] = get_user_model().objects.create(username=f"gcal-{s.id}", email=f"gcal-{s.id}@example.com")
            out[s.id] = users[s.id]
        return out

    monkeypatch.setattr(g, "calendar_owners", owners)
    monkeypatch.setattr(g, "access_token", lambda user: f"tok{user.pk}")
    monkeypatch.setattr(g, "_send", fake.send)
    fake.owner_of = lambda staff: owners([staff])[staff.id]
    return fake


@pytest.fixture
def real_google(gcal, monkeypatch):
    """Googleの差し替えを元に戻す（接続の判定・トークンの更新そのものを確かめるテスト用）。"""
    from apps.core import google as g

    for name, fn in gcal.real.items():
        monkeypatch.setattr(g, name, fn)
    return g
