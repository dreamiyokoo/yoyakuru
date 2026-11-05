import io
import json
import urllib.error

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.bookings import chat, views
from apps.bookings.chat import AiAnswer, ChatUnavailable, FakeProvider, OpenAIProvider
from apps.bookings.models import Booking, Channel, ChatUsage
from apps.stores.models import Service

from .conftest import DAY, NOW, at

URL = "/api/v1/public/tenants/fushimi/chat"


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    cache.clear()
    monkeypatch.setattr(views.timezone, "now", lambda: NOW)


class Scripted:
    """決まった答えを返し、受け取ったプロンプトを記録する。"""

    def __init__(self, answer: AiAnswer):
        self.answer_value, self.calls = answer, []

    def answer(self, system, messages):
        self.calls.append((system, messages))
        return self.answer_value


def use(monkeypatch, provider):
    monkeypatch.setattr(chat, "get_provider", lambda: provider)
    return provider


def post(body):
    return APIClient().post(URL, body, format="json")


def test_without_ai_the_chat_points_to_the_choices_and_phone(service):
    r = post({"message": "駐車場はありますか"})
    assert r.status_code == 200
    assert r.json()["handoff"] and r.json()["phone"] == "075-000-0000" and r.json()["suggestion"] is None
    assert "選択肢" in r.json()["reply"]


def test_answers_from_store_facts_and_keeps_only_recent_history(monkeypatch, service, staff):
    store = service.tenant
    store.guide = "駐車場は2台あります"
    store.save()
    p = use(monkeypatch, Scripted(AiAnswer(reply="駐車場は2台あります。")))
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(10)]
    r = post({"message": "駐車場は？", "history": history})
    assert r.json()["reply"] == "駐車場は2台あります。" and r.json()["suggestion"] is None
    system, messages = p.calls[0]
    facts = json.loads(system.rsplit("<facts>", 1)[1].split("</facts>")[0])
    assert facts["guide"] == "駐車場は2台あります" and facts["today"] == "2026-11-09"
    assert facts["hours"]["日"] == "定休日" and facts["hours"]["月"] == "10:00〜20:00"
    assert [s["name"] for s in facts["services"]] == ["全身調整"]
    assert "指示" in system  # お客様の文章の指示に従わない旨
    assert len(messages) == 7 and messages[-1] == {"role": "user", "content": "駐車場は？"}
    assert r.json()["chat_token"]


def test_suggestion_is_validated_against_store_rules(monkeypatch, service, staff):
    use(
        monkeypatch,
        Scripted(
            AiAnswer(
                reply="お探しします",
                service_id=service.id,
                staff_id=staff[1].id,
                date=DAY.isoformat(),
                time="15:00",
                customer_type="first",
            )
        ),
    )
    s = post({"message": "水曜の15時ごろ、Bさんで初めて"}).json()["suggestion"]
    assert (
        s["service"] == service.id
        and s["staff"] == staff[1].id
        and s["customer_type"] == "first"
        and s["date"] == "2026-11-11"
    )
    assert [x["starts_at"][11:16] for x in s["slots"]] == ["15:00", "14:30", "15:30"]


@pytest.mark.parametrize(
    "answer",
    [
        AiAnswer(reply="x", service_id=99999),  # 存在しないメニュー
        AiAnswer(reply="x", date="2026-11-01"),  # 過去
        AiAnswer(reply="x", date="2027-12-01"),  # 受付期間の外
        AiAnswer(reply="x", date="あした"),  # 形式が違う
        AiAnswer(reply="x", customer_type="vip"),
    ],
)
def test_invalid_suggestions_are_dropped(monkeypatch, service, answer):
    use(monkeypatch, Scripted(answer))
    assert post({"message": "?"}).json()["suggestion"] is None


def test_other_tenants_and_inactive_items_are_not_suggested(monkeypatch, service, staff):
    hidden = Service.objects.create(tenant=service.tenant, name="休止中", duration_minutes=30, is_active=False)
    staff[2].is_active = False
    staff[2].save()
    use(monkeypatch, Scripted(AiAnswer(reply="x", service_id=hidden.id, staff_id=staff[2].id, date=DAY.isoformat())))
    s = post({"message": "?", "context": {"service": service.id}}).json()["suggestion"]
    assert s["service"] is None and s["staff"] is None and s["date"] == "2026-11-11"
    assert s["slots"]  # 入力済みのメニュー（context）で空きを探す（CHAT-03）


def test_bad_time_keeps_order(monkeypatch, service):
    use(monkeypatch, Scripted(AiAnswer(reply="x", service_id=service.id, date=DAY.isoformat(), time="25:00")))
    s = post({"message": "?"}).json()["suggestion"]
    assert s["slots"][0]["starts_at"][11:16] == "10:00"


def test_daily_limit_and_provider_failure(monkeypatch, service, settings):
    settings.CHAT_DAILY_LIMIT_PER_TENANT = 1
    use(monkeypatch, Scripted(AiAnswer(reply="ok")))
    assert post({"message": "1"}).json()["reply"] == "ok"
    assert post({"message": "2"}).json()["handoff"] is True
    assert ChatUsage.objects.get(tenant=service.tenant).count == 1

    class Broken:
        def answer(self, system, messages):
            raise ChatUnavailable

    settings.CHAT_DAILY_LIMIT_PER_TENANT = 10
    use(monkeypatch, Broken())
    assert post({"message": "3"}).json()["handoff"] is True


def test_rejects_long_messages_and_unknown_store(service):
    assert post({"message": "あ" * 301}).status_code == 400
    assert APIClient().post("/api/v1/public/tenants/nope/chat", {"message": "a"}, format="json").status_code == 404


def test_booking_after_chat_counts_as_ai_assisted(monkeypatch, service, staff):
    use(monkeypatch, Scripted(AiAnswer(reply="ok")))
    token = post({"message": "?"}).json()["chat_token"]
    monkeypatch.setattr("apps.bookings.services.timezone.now", lambda: NOW)
    body = {
        "service": service.id,
        "starts_at": at(10).isoformat(),
        "customer_name": "山田",
        "customer_email": "y@example.com",
    }
    c = APIClient()
    assert (
        c.post("/api/v1/public/tenants/fushimi/bookings", {**body, "chat_token": token}, format="json").status_code
        == 201
    )
    forged = {**body, "starts_at": at(11).isoformat(), "chat_token": "forged"}
    assert c.post("/api/v1/public/tenants/fushimi/bookings", forged, format="json").status_code == 201
    b1, b2 = Booking.objects.order_by("starts_at")
    assert (b1.channel, b1.ai_assisted) == (Channel.CHAT, True)
    assert (b2.channel, b2.ai_assisted) == (Channel.WEB, False)


def test_fake_provider_and_provider_selection(service, settings):
    facts = chat.store_facts(service.tenant, DAY)
    system = chat.system_prompt(facts)
    fake = FakeProvider()
    assert fake.answer(system, [{"role": "user", "content": "駐車場は？"}]).handoff
    a = fake.answer(system, [{"role": "user", "content": "明日の全身調整"}])
    assert a.service_id == service.id and a.date == "2026-11-12"
    assert fake.answer(system, [{"role": "user", "content": "腰痛に効く？"}]).handoff
    settings.CHAT_PROVIDER, settings.OPENAI_API_KEY = "fake", ""
    assert isinstance(chat.get_provider(), FakeProvider)
    settings.CHAT_PROVIDER, settings.OPENAI_API_KEY = "", "sk-test"
    assert isinstance(chat.get_provider(), OpenAIProvider)
    settings.OPENAI_API_KEY = ""
    assert chat.get_provider() is None


def test_openai_provider_sends_schema_and_parses(monkeypatch):
    sent = {}
    content = json.dumps(
        {
            "reply": "はい",
            "service_id": 1,
            "staff_id": None,
            "date": None,
            "time": None,
            "customer_type": None,
            "handoff": False,
        }
    )

    def fake_urlopen(req, timeout):
        sent["body"] = json.loads(req.data)
        sent["auth"] = req.headers["Authorization"]
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": content}}]}).encode())

    monkeypatch.setattr(chat.urllib.request, "urlopen", fake_urlopen)
    a = OpenAIProvider("sk-x", "m").answer("sys", [{"role": "user", "content": "q"}])
    assert a == AiAnswer(reply="はい", service_id=1)
    assert sent["auth"] == "Bearer sk-x" and sent["body"]["model"] == "m"
    assert sent["body"]["messages"][0] == {"role": "system", "content": "sys"}
    assert sent["body"]["response_format"]["json_schema"]["strict"] is True

    def failing(req, timeout):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(chat.urllib.request, "urlopen", failing)
    with pytest.raises(ChatUnavailable):
        OpenAIProvider("sk-x", "m").answer("sys", [])
