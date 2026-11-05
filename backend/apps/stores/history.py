"""設定の変更履歴と、直前の状態に戻す処理（SETUP-07）。

変更の前に、店舗の設定をまるごとJSONで残す。戻すときはその内容で置き換える。
設備・担当者・サービスは予約が参照しているため消さない：あとから作られた担当者・サービスは停止し、
あとから作られた設備は、予約が使っていなければ削除する。
"""

from __future__ import annotations

from django.db.models import ProtectedError

from apps.tenants.models import Tenant

from .models import (
    BusinessHours,
    DateOverride,
    RecurringBreak,
    Resource,
    Service,
    SettingChange,
    ShiftException,
    Staff,
    WeeklyShift,
)

STORE_FIELDS = [
    "name",
    "phone",
    "address",
    "guide",
    "calendar_shows_customer_name",
    "slot_interval_minutes",
    "booking_window_days",
    "same_day_cutoff_minutes",
    "cancel_deadline_days",
    "default_buffer_minutes",
]
SERVICE_FIELDS = [
    "name",
    "category",
    "description",
    "price",
    "duration_minutes",
    "first_visit_duration_minutes",
    "buffer_before_minutes",
    "buffer_after_minutes",
    "resource_id",
    "resource_quantity",
    "capacity",
    "is_active",
    "sort_order",
]
STAFF_FIELDS = ["display_name", "title", "priority", "is_active"]
KEEP = 100  # 店舗ごとに残す履歴の件数


def _t(value) -> str | None:
    return value.isoformat() if value is not None else None


def _rows(qs, fields: list[str]) -> list[dict]:
    return [{f: _t(v) if hasattr(v, "isoformat") else v for f, v in row.items()} for row in qs.values(*fields)]


def snapshot(tenant: Tenant) -> dict:
    services = Service.objects.for_tenant(tenant).prefetch_related("staff")
    return {
        "store": {f: getattr(tenant, f) for f in STORE_FIELDS},
        "hours": _rows(BusinessHours.objects.for_tenant(tenant), ["weekday", "opens_at", "closes_at"]),
        "breaks": _rows(RecurringBreak.objects.for_tenant(tenant), ["staff_id", "weekday", "starts_at", "ends_at"]),
        "overrides": _rows(
            DateOverride.objects.for_tenant(tenant), ["date", "is_closed", "opens_at", "closes_at", "note"]
        ),
        "resources": {str(r.id): {"name": r.name, "quantity": r.quantity} for r in Resource.objects.for_tenant(tenant)},
        "staff": {str(s.id): {f: getattr(s, f) for f in STAFF_FIELDS} for s in Staff.objects.for_tenant(tenant)},
        "services": {
            str(s.id): {**{f: getattr(s, f) for f in SERVICE_FIELDS}, "staff_ids": sorted(m.id for m in s.staff.all())}
            for s in services
        },
        "shifts": _rows(WeeklyShift.objects.for_tenant(tenant), ["staff_id", "weekday", "starts_at", "ends_at"]),
        "exceptions": _rows(
            ShiftException.objects.for_tenant(tenant), ["staff_id", "date", "is_off", "starts_at", "ends_at"]
        ),
    }


def _replace(model, tenant: Tenant, rows: list[dict], staff_ids: set[int] | None = None) -> None:
    model.objects.for_tenant(tenant).delete()
    model.objects.bulk_create(
        model(tenant=tenant, **row)
        for row in rows
        if staff_ids is None or row.get("staff_id") is None or row["staff_id"] in staff_ids
    )


def restore(tenant: Tenant, snap: dict) -> None:
    for f, v in snap["store"].items():
        setattr(tenant, f, v)
    tenant.save(update_fields=list(snap["store"]))

    resources = {r.id: r for r in Resource.objects.for_tenant(tenant)}
    for rid, data in snap["resources"].items():
        if r := resources.pop(int(rid), None):
            Resource.objects.filter(pk=r.pk).update(**data)
    for r in resources.values():  # あとから作られた設備
        try:
            r.delete()
        except ProtectedError:
            pass  # 予約が使っている設備は残す

    staff = {s.id: s for s in Staff.objects.for_tenant(tenant)}
    for sid, data in snap["staff"].items():
        if s := staff.pop(int(sid), None):
            Staff.objects.filter(pk=s.pk).update(**data)
    Staff.objects.filter(pk__in=list(staff)).update(is_active=False)  # あとから作られた担当者は停止
    staff_ids = set(Staff.objects.for_tenant(tenant).values_list("id", flat=True))
    resource_ids = set(Resource.objects.for_tenant(tenant).values_list("id", flat=True))

    services = {s.id: s for s in Service.objects.for_tenant(tenant)}
    for sid, data in snap["services"].items():
        s = services.pop(int(sid), None)
        if s is None:
            continue
        data = dict(data)
        members = [m for m in data.pop("staff_ids") if m in staff_ids]
        if data["resource_id"] not in resource_ids:
            data["resource_id"] = None
        Service.objects.filter(pk=s.pk).update(**data)
        s.staff.set(members)
    Service.objects.filter(pk__in=list(services)).update(is_active=False)  # あとから作られたサービスは非公開

    _replace(BusinessHours, tenant, snap["hours"])
    _replace(RecurringBreak, tenant, snap["breaks"], staff_ids)
    _replace(DateOverride, tenant, snap["overrides"])
    _replace(WeeklyShift, tenant, snap["shifts"], staff_ids)
    _replace(ShiftException, tenant, snap["exceptions"], staff_ids)


def record(tenant: Tenant, actor, source: str, method: str, path: str, snap: dict) -> SettingChange:
    change = SettingChange.objects.create(
        tenant=tenant, actor=actor, source=source, method=method, path=path, snapshot=snap
    )
    old = SettingChange.objects.for_tenant(tenant).values_list("id", flat=True)[KEEP:]
    SettingChange.objects.filter(id__in=list(old)).delete()
    return change


_TARGETS = [
    ("store", "予約ルール・店舗の情報"),
    ("hours", "営業時間"),
    ("breaks", "休憩"),
    ("date-overrides", "臨時休業・特別営業"),
    ("resources", "設備"),
    ("services", "サービス"),
    ("staff/order", "担当者の順番"),
    ("history/undo", "直前の変更"),
]
_ACTIONS = {"POST": "追加", "PUT": "変更", "PATCH": "変更", "DELETE": "削除"}


def describe(method: str, path: str) -> str:
    if path == "history/undo":
        return "直前の変更を取り消し"
    if path.startswith("staff/") and "/shifts" in path:
        return "勤務の変更"
    if path.startswith("staff/") and "/exceptions" in path:
        return f"勤務の例外の{_ACTIONS.get(method, '変更')}"
    if path == "staff/order":
        return "担当者の順番の変更"
    for prefix, label in _TARGETS:
        if path == prefix or path.startswith(prefix + "/"):
            return f"{label}の{_ACTIONS.get(method, '変更')}"
    if path == "staff" or path.startswith("staff/"):
        return f"担当者の{_ACTIONS.get(method, '変更')}"
    return f"{path}の変更"
