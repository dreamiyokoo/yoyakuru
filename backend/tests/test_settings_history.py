from datetime import time

from apps.stores import history
from apps.stores.models import (
    BusinessHours,
    DateOverride,
    RecurringBreak,
    Resource,
    Service,
    SettingChange,
    ShiftException,
    Staff,
)

from .conftest import client_for
from .test_admin_api import book
from .test_settings_api import far

S = "/api/v1/admin/tenants/fushimi/settings"


def test_changes_are_recorded_with_source_and_dry_runs_are_not(store, service, owner):
    c = client_for(owner)
    c.put(f"{S}/hours?dry_run=1", [{"weekday": 0, "opens_at": "09:00", "closes_at": "18:00"}], format="json")
    assert not SettingChange.objects.exists()
    c.put(f"{S}/hours", [{"weekday": 0, "opens_at": "09:00", "closes_at": "18:00"}], format="json")
    c.post(f"{S}/resources", {"name": "個室", "quantity": 1}, format="json", HTTP_X_SETTING_SOURCE="ai")
    body = c.get(f"{S}/history").json()
    rows = body["items"]
    assert body["undoable"] is True
    assert [(r["label"], r["source"], r["reverted"]) for r in rows] == [
        ("設備の追加", "ai", False),
        ("営業時間の変更", "manual", False),
    ]
    assert rows[0]["actor_name"] == "owner@example.com"


def test_undo_restores_the_previous_state_step_by_step(store, staff, service, beds, owner):
    c = client_for(owner)
    c.patch(f"{S}/services/{service.id}", {"duration_minutes": 45, "staff": [staff[0].id]}, format="json")
    c.put(f"{S}/hours", [{"weekday": 0, "opens_at": "09:00", "closes_at": "12:00"}], format="json")
    new = c.post(f"{S}/services", {"name": "新メニュー", "duration_minutes": 30}, format="json").json()["result"]
    room = c.post(f"{S}/resources", {"name": "個室", "quantity": 1}, format="json").json()["result"]
    member = c.post(f"{S}/staff", {"display_name": "Dさん"}, format="json").json()["result"]
    c.post(f"{S}/date-overrides", {"date": "2026-12-31", "is_closed": True}, format="json")
    c.post(f"{S}/staff/{staff[0].id}/exceptions", {"date": "2026-12-01", "is_off": True}, format="json")
    c.put(f"{S}/store", {**_store(store), "slot_interval_minutes": 15}, format="json")

    # 1回ずつ、新しい変更から戻す
    for _ in range(8):
        r = c.post(f"{S}/history/undo", {}, format="json")
        assert r.status_code == 200, r.json()
    store.refresh_from_db()
    service.refresh_from_db()
    assert store.slot_interval_minutes == 30
    assert service.duration_minutes == 60 and service.staff.count() == 3
    assert BusinessHours.objects.filter(tenant=store).count() == 6
    assert not Service.objects.get(pk=new["id"]).is_active  # あとから作ったサービスは非公開
    assert not Resource.objects.filter(pk=room["id"]).exists()  # 使われていない設備は削除
    assert not Staff.objects.get(pk=member["id"]).is_active  # あとから作った担当者は停止
    assert not DateOverride.objects.filter(tenant=store).exists()
    assert not ShiftException.objects.filter(tenant=store).exists()
    assert c.post(f"{S}/history/undo", {}, format="json").status_code == 400  # もう戻せない
    body = c.get(f"{S}/history").json()
    assert body["undoable"] is False
    labels = [(r["label"], r["reverted"]) for r in body["items"]]
    assert labels[0] == ("直前の変更を取り消し", False) and ("サービスの変更", True) in labels


def test_undo_dry_run_shows_affected_bookings(store, staff, service, owner):
    c = client_for(owner)
    c.put(f"{S}/hours", [], format="json")  # 全部定休日
    c.put(f"{S}/hours", [{"weekday": d, "opens_at": "10:00", "closes_at": "20:00"} for d in range(6)], format="json")
    b = book(service, staff[0], far(10))
    # 直前の変更（営業時間を戻した変更）を取り消すと、全部定休日に戻り予約が成り立たない
    r = c.post(f"{S}/history/undo?dry_run=1", {}, format="json").json()
    assert r["applied"] is False and [x["id"] for x in r["affected_bookings"]] == [b.id]
    assert BusinessHours.objects.filter(tenant=store).count() == 6
    assert not SettingChange.objects.filter(reverted_at__isnull=False).exists()


def test_undo_keeps_resources_in_use_and_drops_rows_for_missing_staff(store, staff, service, beds, owner):
    snap = history.snapshot(store)
    snap["breaks"].append({"staff_id": 99999, "weekday": None, "starts_at": "12:00:00", "ends_at": "12:30:00"})
    snap["services"][str(service.id)]["resource_id"] = 99999
    used = Resource.objects.create(tenant=store, name="使用中", quantity=1)
    service.resource = used
    service.save()
    b = book(service, staff[0], far(10))
    assert b.resource_id == used.id
    history.restore(store, snap)
    assert Resource.objects.filter(pk=used.pk).exists()  # 予約が使っている設備は残す
    service.refresh_from_db()
    assert service.resource_id is None
    assert not RecurringBreak.objects.filter(tenant=store, staff_id=99999).exists()


def test_history_keeps_a_limited_number(monkeypatch, store, owner):
    monkeypatch.setattr(history, "KEEP", 3)
    for i in range(5):
        history.record(store, None, "manual", "PUT", "store", {"i": i})
    assert SettingChange.objects.filter(tenant=store).count() == 3


def test_descriptions():
    d = history.describe
    assert d("PUT", "staff/3/shifts") == "勤務の変更"
    assert d("DELETE", "staff/3/exceptions/9") == "勤務の例外の削除"
    assert d("POST", "staff/order") == "担当者の順番の変更"
    assert d("PATCH", "staff/3") == "担当者の変更"
    assert d("DELETE", "breaks/2") == "休憩の削除"
    assert d("POST", "unknown") == "unknownの変更"


def test_staff_cannot_see_or_undo(member):
    c = client_for(member)
    assert c.get(f"{S}/history").status_code == 403
    assert c.post(f"{S}/history/undo", {}, format="json").status_code == 403


def _store(store):
    return {f: getattr(store, f) for f in history.STORE_FIELDS}


def test_times_round_trip(store):
    snap = history.snapshot(store)
    assert snap["hours"][0]["opens_at"] == "10:00:00"
    BusinessHours.objects.filter(tenant=store).update(opens_at=time(11))
    history.restore(store, snap)
    assert BusinessHours.objects.filter(tenant=store, opens_at=time(10)).count() == 6


def test_undo_is_still_offered_beyond_the_displayed_page(store, owner):
    for _ in range(16):
        history.record(store, None, "manual", "PUT", "store", history.snapshot(store))
    c = client_for(owner)
    for _ in range(15):
        assert c.post(f"{S}/history/undo", {}, format="json").status_code == 200
    body = c.get(f"{S}/history").json()
    assert len(body["items"]) == 30 and all(r["source"] == "undo" or r["reverted"] for r in body["items"])
    assert body["undoable"] is True  # 表示の外に、まだ戻せる変更が1件ある


def test_undo_picks_the_latest_change_after_taking_the_lock(monkeypatch, store, owner):
    """ロックの前に別の変更が保存されても、ロック後の最新の変更を取り消す。"""
    from apps.stores import settings_api

    old = history.record(store, None, "manual", "PUT", "store", history.snapshot(store))
    real_apply = settings_api.SettingsView.apply

    def apply_after_another_change(self, request, change, *args, **kwargs):
        newer = history.record(store, None, "manual", "PUT", "hours", history.snapshot(store))
        response = real_apply(self, request, change, *args, **kwargs)
        newer.refresh_from_db()
        assert newer.reverted_at is not None
        return response

    monkeypatch.setattr(settings_api.SettingsView, "apply", apply_after_another_change)
    assert client_for(owner).post(f"{S}/history/undo", {}, format="json").status_code == 200
    old.refresh_from_db()
    assert old.reverted_at is None
