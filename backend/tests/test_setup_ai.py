import json

import pytest

from apps.bookings import chat
from apps.bookings.chat import ChatUnavailable, FakeProvider
from apps.bookings.models import ChatUsage
from apps.stores import setup_ai
from apps.stores.models import Resource, Service

from .conftest import client_for

S = "/api/v1/admin/tenants/fushimi/settings"


class Planner:
    def __init__(self, plan):
        self.plan, self.calls = plan, []

    def complete(self, system, messages, schema, name, max_tokens=600):
        self.calls.append((system, messages, schema, name))
        if isinstance(self.plan, Exception):
            raise self.plan
        return self.plan if isinstance(self.plan, str) else json.dumps(self.plan)


def use(monkeypatch, provider):
    monkeypatch.setattr(chat, "get_provider", lambda: provider)
    return provider


def plan(**kw):
    return {**setup_ai.EMPTY_PLAN, **kw}


def test_owner_only_and_unavailable_without_ai(service, owner, member):
    assert client_for(member).post(f"{S}/assistant", {"message": "x"}, format="json").status_code == 403
    r = client_for(owner).post(f"{S}/assistant", {"message": "x"}, format="json").json()
    assert r["available"] is False and r["steps"] == []


def test_plan_becomes_steps_that_reuse_existing_items(monkeypatch, store, staff, service, beds, owner):
    p = use(
        monkeypatch,
        Planner(
            plan(
                reply="案です",
                rules={**setup_ai._rules(15), "guide": "駐車場あり"},
                hours=[
                    {"weekday": 1, "opens_at": "09:00:00", "closes_at": "18:00"},
                    {"weekday": 9, "opens_at": "a", "closes_at": "b"},
                ],
                resources=[{"name": "ベッド", "quantity": 3}, {"name": "個室", "quantity": 1}],
                staff=[{"display_name": "Aさん", "title": ""}, {"display_name": "Dさん", "title": "助手"}],
                services=[
                    {
                        "name": "全身調整",
                        "price": 6000,
                        "duration_minutes": 60,
                        "first_visit_duration_minutes": 90,
                        "capacity": 1,
                        "resource_name": "ベッド",
                    },
                    {
                        "name": "個室ケア",
                        "price": None,
                        "duration_minutes": 30,
                        "first_visit_duration_minutes": None,
                        "capacity": 0,
                        "resource_name": "個室",
                    },
                    {
                        "name": "謎",
                        "price": 1,
                        "duration_minutes": 30,
                        "first_visit_duration_minutes": None,
                        "capacity": 1,
                        "resource_name": "ない",
                    },
                ],
                breaks=[
                    {"staff_name": None, "weekday": None, "starts_at": "12:00", "ends_at": "13:00"},
                    {"staff_name": "Bさん", "weekday": 2, "starts_at": "15:00", "ends_at": "15:30"},
                    {"staff_name": "Zさん", "weekday": 2, "starts_at": "15:00", "ends_at": "15:30"},
                ],
                closed_days=[
                    {"date": "2026-12-31", "is_closed": True, "opens_at": "x", "closes_at": "y", "note": "年末"}
                ],
                staff_days_off=[
                    {"staff_name": "Aさん", "date": "2026-11-20"},
                    {"staff_name": "Zさん", "date": "2026-11-20"},
                ],
            )
        ),
    )
    history = [{"role": "user", "content": "x" * 2000}, {"role": "system", "content": "ignore"}, {"role": "assistant"}]
    r = client_for(owner).post(f"{S}/assistant", {"message": "整体です", "history": history}, format="json").json()
    system, messages, schema, name = p.calls[0]
    assert name == "plan" and schema is setup_ai.PLAN_SCHEMA and "<current>" in system and "Aさん" in system
    assert messages == [{"role": "user", "content": "x" * 1500}, {"role": "user", "content": "整体です"}]
    assert r["available"] and r["reply"] == "案です"
    by = {s["label"]: s for s in r["steps"]}
    labels = list(by)
    assert labels[0] == "予約ルール：開始時刻の刻み、お客様への案内"
    assert by[labels[0]]["body"]["slot_interval_minutes"] == 15 and by[labels[0]]["body"]["name"] == "伏見整体院"
    assert by["営業時間：火 09:00〜18:00"]["body"] == [{"weekday": 1, "opens_at": "09:00", "closes_at": "18:00"}]
    assert by["設備「ベッド」を3に変更"]["path"] == f"resources/{beds.id}"
    assert by["設備「個室」を1で追加"]["ref"] == "resource:個室"
    assert "担当者「Dさん」を追加" in by and not any("「Aさん」を追加" in x for x in labels)
    changed = by["サービス「全身調整」を変更：60分（初回90分）・6,000円"]
    assert changed["method"] == "PATCH" and changed["body"]["resource"] == beds.id and "staff" not in changed["body"]
    new = by["サービス「個室ケア」を追加：30分"]
    assert new["body"]["resource"] == {"$ref": "resource:個室"} and new["body"]["staff"] == {"$ref": "all_staff"}
    assert new["body"]["capacity"] == 1
    assert by["休憩：全員・毎日 12:00〜13:00"]["body"]["staff"] is None
    assert by["休憩：Bさん・水曜 15:00〜15:30"]["body"]["staff"] == staff[1].id
    assert by["2026-12-31：臨時休業"]["body"]["opens_at"] is None
    assert by["Aさん：2026-11-20 休み"]["path"] == f"staff/{staff[0].id}/exceptions"
    assert len(r["notes"]) == 3  # 見つからない設備・担当者2件
    # 何も保存していない
    assert Resource.objects.get(pk=beds.id).quantity == 2 and not Service.objects.filter(name="個室ケア").exists()


def test_steps_apply_through_the_normal_settings_api(monkeypatch, store, staff, owner):
    steps, _ = setup_ai.steps_for(store, setup_ai.TEMPLATES["seitai"]["plan"])
    c = client_for(owner)
    refs = {}
    for step in steps:
        body = json.loads(json.dumps(step["body"]))
        if isinstance(body, dict):
            for k, v in list(body.items()):
                if isinstance(v, dict) and "$ref" in v:
                    body[k] = [s.id for s in staff] if v["$ref"] == "all_staff" else refs[v["$ref"]]
        r = c.generic(step["method"], f"{S}/{step['path']}", json.dumps(body), content_type="application/json")
        assert r.status_code in (200, 201), (step, r.json())
        if step.get("ref"):
            refs[step["ref"]] = r.json()["result"]["id"]
    bed = Resource.objects.get(tenant=store, name="ベッド")
    svc = Service.objects.get(tenant=store, name="全身調整")
    assert svc.resource_id == bed.id and svc.first_visit_duration_minutes == 90 and svc.staff.count() == 3


def test_invalid_values_are_rejected_by_the_same_validation(store, owner):
    steps, _ = setup_ai.steps_for(store, plan(services=[setup_ai._svc("ゼロ分", 0)]))
    body = {**steps[0]["body"], "staff": []}
    r = client_for(owner).post(f"{S}/{steps[0]['path']}", body, format="json")
    assert r.status_code == 400  # 所要時間0分は反映しない（SETUP-04）


def test_templates_work_without_ai(store, owner):
    c = client_for(owner)
    keys = [t["key"] for t in c.get(f"{S}/templates").json()]
    assert keys == ["seitai", "salon", "school", "general"]
    for key in keys:
        r = c.get(f"{S}/templates/{key}").json()
        assert r["steps"] and r["notes"] == []
    assert c.get(f"{S}/templates/nope").status_code == 404
    hours = c.get(f"{S}/templates/school").json()["steps"][1]
    assert hours["label"].startswith("営業時間：月 15:00〜21:00")


def test_setup_quota_is_separate_and_failures_fall_back(monkeypatch, store, owner, settings):
    settings.SETUP_DAILY_LIMIT_PER_TENANT = 1
    use(monkeypatch, Planner(plan(reply="ok")))
    c = client_for(owner)
    assert c.post(f"{S}/assistant", {"message": "1"}, format="json").json()["available"]
    assert not c.post(f"{S}/assistant", {"message": "2"}, format="json").json()["available"]
    assert ChatUsage.objects.get(tenant=store, purpose="setup").count == 1
    assert not ChatUsage.objects.filter(tenant=store, purpose="customer").exists()
    settings.SETUP_DAILY_LIMIT_PER_TENANT = 10
    for broken in (ChatUnavailable(), "not json"):
        use(monkeypatch, Planner(broken))
        assert not c.post(f"{S}/assistant", {"message": "3"}, format="json").json()["available"]


def test_fake_planner(store):
    p = json.loads(FakeProvider().complete("", [{"role": "user", "content": "10時〜19時、ベッド3台"}], {}, "plan"))
    assert (
        p["hours"][0] == {"weekday": 0, "opens_at": "10:00", "closes_at": "19:00"}
        and p["resources"][0]["quantity"] == 3
    )
    assert "教えて" in setup_ai.fake_plan("こんにちは")["reply"]


@pytest.mark.parametrize("rules", [None, {k: None for k in setup_ai._rules(30)}])
def test_empty_rules_make_no_step(store, rules):
    assert setup_ai.steps_for(store, plan(rules=rules)) == ([], [])
