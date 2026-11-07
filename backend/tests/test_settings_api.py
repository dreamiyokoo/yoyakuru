from datetime import timedelta

from apps.stores.models import BusinessHours, DateOverride, RecurringBreak, Resource, Service, Staff, WeeklyShift
from apps.tenants.models import Tenant

from .conftest import DAY, client_for
from .test_admin_api import book

S = "/api/v1/admin/tenants/fushimi/settings"
WED = DAY.weekday()


def far(h, m=0):
    """実時間で動く設定APIのため、60日先の水曜日に置く。"""
    from datetime import datetime, time
    from zoneinfo import ZoneInfo

    from django.utils import timezone

    d = timezone.now().astimezone(ZoneInfo("Asia/Tokyo")).date() + timedelta(days=30)
    while d.weekday() != WED:
        d += timedelta(days=1)
    return datetime.combine(d, time(h, m), ZoneInfo("Asia/Tokyo"))


def test_owner_only(service, owner, member):
    assert client_for(member).get(f"{S}/store").status_code == 403
    assert client_for(owner).get(f"{S}/store").status_code == 200


def test_store_rules(service, owner):
    c = client_for(owner)
    body = {**c.get(f"{S}/store").json(), "slot_interval_minutes": 15, "booking_window_days": 30}
    r = c.put(f"{S}/store", body, format="json")
    assert r.status_code == 200 and r.json()["applied"] and r.json()["result"]["slot_interval_minutes"] == 15
    assert Tenant.objects.get(pk=service.tenant_id).booking_window_days == 30
    assert c.put(f"{S}/store", {**body, "slot_interval_minutes": 20}, format="json").status_code == 400


def test_hours_dry_run_reports_affected_and_saves_nothing(service, staff, owner):
    b = book(service, staff[0], far(18))
    c = client_for(owner)
    week = [{"weekday": d, "opens_at": "10:00", "closes_at": "17:00"} for d in range(6)]
    r = c.put(f"{S}/hours?dry_run=1", week, format="json")
    assert r.json()["applied"] is False
    assert [x["id"] for x in r.json()["affected_bookings"]] == [b.id]
    assert BusinessHours.objects.get(tenant=service.tenant, weekday=0).closes_at.hour == 20  # 保存していない
    r = c.put(f"{S}/hours", week, format="json")
    assert r.json()["applied"] and len(r.json()["result"]) == 6
    assert BusinessHours.objects.get(tenant=service.tenant, weekday=0).closes_at.hour == 17
    assert len(c.get(f"{S}/hours").json()) == 6
    dup = [{"weekday": 0, "opens_at": "10:00", "closes_at": "17:00"}] * 2
    assert c.put(f"{S}/hours", dup, format="json").status_code == 400
    bad = [{"weekday": 0, "opens_at": "17:00", "closes_at": "10:00"}]
    assert c.put(f"{S}/hours", bad, format="json").status_code == 400


def test_existing_problems_are_not_reported_again(service, staff, owner):
    b = book(service, staff[0], far(18))
    BusinessHours.objects.filter(tenant=service.tenant).update(closes_at="17:00")  # すでに外れている
    r = client_for(owner).put(f"{S}/store?dry_run=1", client_for(owner).get(f"{S}/store").json(), format="json")
    assert b.id not in [x["id"] for x in r.json()["affected_bookings"]]


def test_breaks_and_date_overrides(service, staff, owner):
    c = client_for(owner)
    r = c.post(
        f"{S}/breaks", {"staff": staff[1].id, "weekday": WED, "starts_at": "15:00", "ends_at": "16:00"}, format="json"
    )
    assert r.status_code == 201 and r.json()["result"]["staff"] == staff[1].id
    assert len(c.get(f"{S}/breaks").json()) == 2
    bad = {"staff": None, "weekday": None, "starts_at": "16:00", "ends_at": "15:00"}
    assert c.post(f"{S}/breaks", bad, format="json").status_code == 400
    assert c.delete(f"{S}/breaks/{r.json()['result']['id']}").status_code == 200
    assert RecurringBreak.objects.filter(tenant=service.tenant).count() == 1

    day = far(10).date()
    r = c.post(f"{S}/date-overrides", {"date": day, "is_closed": True, "note": "臨時休業"}, format="json")
    assert r.status_code == 201
    r = c.post(
        f"{S}/date-overrides",
        {"date": day, "is_closed": False, "opens_at": "12:00", "closes_at": "15:00"},
        format="json",
    )
    assert r.status_code == 201 and DateOverride.objects.get(tenant=service.tenant).opens_at.hour == 12  # 上書き
    assert c.post(f"{S}/date-overrides", {"date": day, "is_closed": False}, format="json").status_code == 400
    late = {"date": day, "is_closed": False, "opens_at": "15:00", "closes_at": "12:00"}
    assert c.post(f"{S}/date-overrides", late, format="json").status_code == 400
    assert len(c.get(f"{S}/date-overrides", {"from": day}).json()) == 1
    assert c.delete(f"{S}/date-overrides/{r.json()['result']['id']}").status_code == 200


def test_resources_and_services(service, staff, beds, owner):
    c = client_for(owner)
    r = c.post(f"{S}/resources", {"name": "個室", "quantity": 1}, format="json")
    room = r.json()["result"]["id"]
    assert c.patch(f"{S}/resources/{beds.id}", {"quantity": 3}, format="json").json()["result"]["quantity"] == 3
    assert c.patch(f"{S}/resources/{beds.id}", {"quantity": 0}, format="json").status_code == 400
    assert len(c.get(f"{S}/resources").json()) == 2

    body = {"name": "カウンセリング", "duration_minutes": 30, "staff": [staff[0].id], "resource": room}
    body |= {"buffer_before_minutes": None, "buffer_after_minutes": None}  # 店舗の既定値を使う
    r = c.post(f"{S}/services", body, format="json")
    assert (
        r.status_code == 201 and r.json()["result"]["staff"] == [staff[0].id] and r.json()["result"]["resource"] == room
    )
    sid = r.json()["result"]["id"]
    assert Service.objects.get(pk=sid).buffer_before_minutes is None
    r = c.patch(f"{S}/services/{sid}", {"staff": [staff[0].id, staff[1].id], "resource": None}, format="json")
    assert r.json()["result"]["staff"] == [staff[0].id, staff[1].id] and r.json()["result"]["resource"] is None
    assert len(c.get(f"{S}/services").json()) == 2

    b = book(service, staff[0], far(10))
    r = c.patch(f"{S}/services/{service.id}?dry_run=1", {"is_active": False}, format="json")
    assert [x["id"] for x in r.json()["affected_bookings"]] == [b.id]
    assert Service.objects.get(pk=service.id).is_active


def test_other_tenant_objects_are_rejected(service, staff, owner):
    other = Tenant.objects.create(subdomain="other", name="他店")
    other_staff = Staff.objects.create(tenant=other, display_name="X")
    other_room = Resource.objects.create(tenant=other, name="X")
    c = client_for(owner)
    assert (
        c.post(
            f"{S}/services", {"name": "x", "duration_minutes": 30, "staff": [other_staff.id]}, format="json"
        ).status_code
        == 404
    )
    assert (
        c.post(
            f"{S}/services", {"name": "x", "duration_minutes": 30, "resource": other_room.id}, format="json"
        ).status_code
        == 404
    )
    assert c.patch(f"{S}/staff/{other_staff.id}", {"title": "x"}, format="json").status_code == 404
    assert Service.objects.filter(tenant=service.tenant, name="x").count() == 0  # 途中で失敗したら残さない


def test_staff_order_and_deactivation(service, staff, owner):
    c = client_for(owner)
    r = c.post(f"{S}/staff", {"display_name": "Dさん"}, format="json")
    assert r.status_code == 201
    ids = [staff[2].id, staff[0].id, staff[1].id, r.json()["result"]["id"]]
    r = c.post(f"{S}/staff/order", {"ids": ids}, format="json")
    assert [s["id"] for s in sorted(r.json()["result"], key=lambda s: s["priority"])] == ids
    b = book(service, staff[0], far(10))
    r = c.patch(f"{S}/staff/{staff[0].id}?dry_run=1", {"is_active": False}, format="json")
    assert [x["id"] for x in r.json()["affected_bookings"]] == [b.id]
    assert len(c.get(f"{S}/staff").json()) == 4


def test_shifts_and_exceptions(service, staff, owner):
    c = client_for(owner)
    a = staff[0]
    b = book(service, a, far(18))
    week = [{"weekday": d, "starts_at": "10:00", "ends_at": "17:00"} for d in range(6)]
    r = c.put(f"{S}/staff/{a.id}/shifts", week, format="json")
    assert [x["id"] for x in r.json()["affected_bookings"]] == [b.id]
    assert len(r.json()["result"]["weekly"]) == 6
    assert c.put(f"{S}/staff/{a.id}/shifts", [week[0], week[0]], format="json").status_code == 400
    assert (
        c.put(
            f"{S}/staff/{a.id}/shifts", [{"weekday": 0, "starts_at": "17:00", "ends_at": "10:00"}], format="json"
        ).status_code
        == 400
    )
    day = far(10).date()
    r = c.post(f"{S}/staff/{a.id}/exceptions", {"date": day, "is_off": True}, format="json")
    assert r.status_code == 201
    r = c.post(
        f"{S}/staff/{a.id}/exceptions",
        {"date": day, "is_off": False, "starts_at": "12:00", "ends_at": "18:00"},
        format="json",
    )
    assert r.json()["result"]["starts_at"] == "12:00:00"
    assert c.post(f"{S}/staff/{a.id}/exceptions", {"date": day, "is_off": False}, format="json").status_code == 400
    late = {"date": day, "is_off": False, "starts_at": "18:00", "ends_at": "12:00"}
    assert c.post(f"{S}/staff/{a.id}/exceptions", late, format="json").status_code == 400
    assert len(c.get(f"{S}/staff/{a.id}/shifts").json()["exceptions"]) == 1
    assert c.delete(f"{S}/staff/{a.id}/exceptions/{r.json()['result']['id']}").status_code == 200
    assert c.delete(f"{S}/staff/{staff[1].id}/exceptions/{r.json()['result']['id']}").status_code == 404


def test_reducing_resources_reports_existing_groups(store, staff, beds, owner):
    """グループに参加する空き判定は設備を数えないが、設備を減らしたときは既存のグループ全体で確かめる。"""
    lesson = Service.objects.create(
        tenant=store, name="ヨガ", duration_minutes=60, capacity=4, resource=beds, resource_quantity=1
    )
    lesson.staff.set(staff)
    ids = {book(lesson, s, far(10), email=f"{s.id}-{i}@example.com").id for s in staff[:2] for i in range(2)}
    c = client_for(owner)
    r = c.patch(f"{S}/resources/{beds.id}?dry_run=1", {"quantity": 1}, format="json")
    assert {x["id"] for x in r.json()["affected_bookings"]} == ids
    r = c.patch(f"{S}/resources/{beds.id}?dry_run=1", {"quantity": 2}, format="json")
    assert r.json()["affected_bookings"] == []


def test_warnings_for_settings_that_leave_no_slots(service, staff, owner):
    c = client_for(owner)
    assert c.get(f"{S}/warnings").json() == {"warnings": []}

    BusinessHours.objects.create(tenant=service.tenant, weekday=6, opens_at="10:00", closes_at="20:00")  # 日曜も営業
    WeeklyShift.objects.filter(staff=staff[0], weekday=5).update(starts_at="20:00", ends_at="21:00")  # 営業時間の外
    WeeklyShift.objects.filter(staff__in=staff[1:], weekday=5).delete()
    Service.objects.create(tenant=service.tenant, name="足つぼ", duration_minutes=30).staff.set([staff[2]])
    Staff.objects.filter(pk=staff[2].pk).update(is_active=False)
    Service.objects.create(tenant=service.tenant, name="非公開", duration_minutes=30, is_active=False)
    warnings = c.get(f"{S}/warnings").json()["warnings"]
    assert warnings == [
        "営業日なのに勤務している担当者がいません（土・日）。「担当者」の「勤務」で週の勤務を入れてください。",
        "担当できる人がいないサービスがあります（足つぼ）。「サービス」の「担当できる人」を選んでください。",
    ]

    BusinessHours.objects.filter(tenant=service.tenant).delete()
    assert c.get(f"{S}/warnings").json()["warnings"] == [
        "営業時間が設定されていません。「営業時間」で曜日ごとの時間を入れてください。"
    ]
