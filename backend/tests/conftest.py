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


def user(email, password="pw-123456!"):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username=email, email=email, password=password)


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
