from django.core import mail
from rest_framework.test import APIClient

from apps.core.models import Lead

URL = "/api/v1/public/leads"
BODY = {
    "store_name": "伏見整体院",
    "name": "伏見 太郎",
    "email": "f@example.com",
    "phone": "075",
    "industry": "整体・治療院",
}


def test_lead_is_saved_and_the_operator_is_notified(db, settings):
    settings.LEAD_NOTIFY_EMAIL = "ops@example.com"
    r = APIClient().post(URL, BODY, format="json")
    assert r.status_code == 201
    lead = Lead.objects.get()
    assert (lead.store_name, lead.industry, str(lead)) == ("伏見整体院", "整体・治療院", "伏見整体院（伏見 太郎）")
    assert mail.outbox[-1].to == ["ops@example.com"] and "伏見整体院" in mail.outbox[-1].subject


def test_validation_honeypot_and_no_notification_address(db, settings, monkeypatch):
    c = APIClient()
    assert c.post(URL, {**BODY, "email": "x"}, format="json").status_code == 400
    assert c.post(URL, {**BODY, "industry": "宇宙"}, format="json").status_code == 400
    assert c.post(URL, {**BODY, "website": "http://spam"}, format="json").status_code == 201
    assert not Lead.objects.exists()  # ボットは保存しない
    settings.LEAD_NOTIFY_EMAIL = ""
    mail.outbox.clear()
    assert c.post(URL, BODY, format="json").status_code == 201
    assert mail.outbox == [] and Lead.objects.count() == 1


def test_notification_failure_keeps_the_lead(db, settings, monkeypatch):
    settings.LEAD_NOTIFY_EMAIL = "ops@example.com"

    def boom(self, *a, **k):
        raise OSError("smtp down")

    monkeypatch.setattr("apps.core.leads.EmailMessage.send", boom)
    assert APIClient().post(URL, BODY, format="json").status_code == 201
    assert Lead.objects.count() == 1
