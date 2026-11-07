"""店舗のセルフ登録と、Stripe の月額契約（BILL-01、BILL-04）。Stripe は呼ばず、置き換えて確かめる。"""

from types import SimpleNamespace
from unittest import mock

import pytest
import stripe
from rest_framework.test import APIClient

from apps.billing import stripe_api
from apps.billing.models import Subscription
from apps.stores.models import Membership, Role
from apps.tenants.models import Tenant

from .conftest import client_for, enable_two_factor, user

SIGNUP = {
    "store_name": "こもれび整体院",
    "subdomain": "Komorebi",
    "name": "木漏 日子",
    "email": "komorebi@example.com",
    "password": "long-enough-pass-1",
}


@pytest.fixture
def stripe_on(settings):
    settings.STRIPE_SECRET_KEY = "sk_test_x"
    settings.STRIPE_WEBHOOK_SECRET = "whsec_x"
    settings.STRIPE_PRICE_ID = "price_x"
    return settings


def obj(d):
    """Stripe の取得結果の代わり（to_dict で中身を返す）。"""
    return SimpleNamespace(to_dict=lambda: d, **{k: v for k, v in d.items() if k.isidentifier()})


def stripe_sub(status="active", tenant_id="1", sub_id="sub_1", period_end=1_800_000_000, cancel=False):
    return obj(
        {
            "id": sub_id,
            "status": status,
            "customer": "cus_1",
            "metadata": {"tenant_id": str(tenant_id)},
            "items": {"data": [{"current_period_end": period_end}]},
            "cancel_at_period_end": cancel,
        }
    )


def signed_up(db):
    c = APIClient(enforce_csrf_checks=True)
    c.get("/api/v1/auth/csrf")
    r = c.post("/api/v1/auth/signup", SIGNUP, format="json", HTTP_X_CSRFTOKEN=c.cookies["csrftoken"].value)
    return c, r


class TestSignup:
    def test_creates_store_owner_and_pending_subscription_then_logs_in(self, db):
        c, r = signed_up(db)
        assert r.status_code == 201
        me = r.json()
        assert me["email"] == "komorebi@example.com" and me["name"] == "木漏 日子"
        assert me["two_factor_required"] is True and me["two_factor_enabled"] is False
        assert me["memberships"] == [
            {
                "subdomain": "komorebi",
                "name": "こもれび整体院",
                "role": "owner",
                "staff_id": None,
                "billing_required": True,
                "billing_managed": True,
            }
        ]
        tenant = Tenant.objects.get(subdomain="komorebi")
        assert tenant.subscription.status == "pending"
        assert Membership.objects.get(tenant=tenant).role == Role.OWNER
        assert c.get("/api/v1/auth/me").status_code == 200  # ログイン済み

    def test_requires_csrf(self, db):
        c = APIClient(enforce_csrf_checks=True)
        assert c.post("/api/v1/auth/signup", SIGNUP, format="json").status_code == 403
        assert not Tenant.objects.exists()

    @pytest.mark.parametrize(
        ("change", "field"),
        [
            ({"subdomain": "app"}, "subdomain"),
            ({"subdomain": "ab"}, "subdomain"),
            ({"subdomain": "fushimi"}, "subdomain"),
            ({"email": "OWNER@example.com"}, "email"),
            ({"password": "password"}, "password"),
            ({"password": "komorebi@example.com"}, "password"),
        ],
    )
    def test_rejects_bad_or_taken_values(self, owner, change, field):
        r = APIClient().post("/api/v1/auth/signup", {**SIGNUP, **change}, format="json")
        assert r.status_code == 400 and field in r.json()
        assert not Tenant.objects.filter(subdomain="komorebi").exists()

    def test_conflict_from_concurrent_signup_is_409(self, db):
        with mock.patch(
            "apps.billing.views.Membership.objects.create", side_effect=__import__("django").db.IntegrityError
        ):
            r = APIClient().post("/api/v1/auth/signup", SIGNUP, format="json")
        assert r.status_code == 409
        assert not Tenant.objects.exists()  # まとめて取り消される


@pytest.fixture
def new_owner(db):
    """セルフ登録して二段階認証まで済ませた、支払い前のオーナー。"""
    _, r = signed_up(db)
    assert r.status_code == 201
    u = Membership.objects.get(tenant__subdomain="komorebi").user
    enable_two_factor(u)
    return u


class TestGate:
    def test_unpaid_store_blocks_admin_api_and_public_page(self, new_owner):
        c = client_for(new_owner)
        r = c.get("/api/v1/admin/tenants/komorebi/options")
        assert r.status_code == 403 and "お支払い" in r.json()["detail"]
        assert c.get("/api/v1/admin/tenants/komorebi/billing").json()["usable"] is False
        assert APIClient().get("/api/v1/public/tenants/komorebi/").status_code == 404

    def test_paid_store_works(self, new_owner):
        Subscription.objects.filter(tenant__subdomain="komorebi").update(status="active")
        assert client_for(new_owner).get("/api/v1/admin/tenants/komorebi/options").status_code == 200
        assert APIClient().get("/api/v1/public/tenants/komorebi/").status_code == 200

    def test_past_due_keeps_working_but_canceled_stops(self, new_owner):
        sub = Subscription.objects.get(tenant__subdomain="komorebi")
        sub.status = "past_due"
        sub.save()
        assert client_for(new_owner).get("/api/v1/admin/tenants/komorebi/options").status_code == 200
        sub.status = "canceled"
        sub.save()
        assert client_for(new_owner).get("/api/v1/admin/tenants/komorebi/options").status_code == 403
        me = client_for(new_owner).get("/api/v1/auth/me").json()
        assert me["memberships"][0]["billing_required"] is True

    def test_store_without_subscription_is_not_charged(self, owner):
        # 運営が管理サイトで作った店舗は、契約の記録がなく、支払いなしで使える
        assert client_for(owner).get("/api/v1/admin/tenants/fushimi/options").status_code == 200
        b = client_for(owner).get("/api/v1/admin/tenants/fushimi/billing").json()
        assert b["usable"] is True and b["status"] == "none" and b["manageable"] is False

    def test_staff_cannot_use_billing(self, new_owner):
        tenant = Tenant.objects.get(subdomain="komorebi")
        staff = user("s@example.com")
        Membership.objects.create(tenant=tenant, user=staff, role=Role.STAFF)
        assert client_for(staff).post("/api/v1/admin/tenants/komorebi/billing/checkout").status_code == 403


class TestCheckout:
    def test_not_configured(self, new_owner):
        r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert r.status_code == 503 and r.json()["code"] == "not_configured"

    def test_creates_session_for_this_store(self, new_owner, stripe_on):
        tenant = Tenant.objects.get(subdomain="komorebi")
        with mock.patch.object(
            stripe.checkout.Session, "create", return_value={"url": "https://checkout.example/x", "id": "cs_new"}
        ) as create:
            r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert r.status_code == 200 and r.json()["url"] == "https://checkout.example/x"
        kw = create.call_args.kwargs
        assert kw["mode"] == "subscription" and kw["line_items"] == [{"price": "price_x", "quantity": 1}]
        assert kw["client_reference_id"] == str(tenant.pk)
        assert kw["subscription_data"]["metadata"]["tenant_id"] == str(tenant.pk)
        assert kw["customer_email"] == "komorebi@example.com" and "customer" not in kw
        assert kw["success_url"].startswith("https://app.yoyakuru.test/bookings?checkout_session=")

    def test_reuses_customer_and_refuses_when_already_paid(self, new_owner, stripe_on):
        sub = Subscription.objects.get(tenant__subdomain="komorebi")
        sub.stripe_customer_id, sub.status = "cus_1", "canceled"
        sub.save()
        with mock.patch.object(stripe.checkout.Session, "create", return_value={"url": "u", "id": "cs_2"}) as create:
            client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert create.call_args.kwargs["customer"] == "cus_1"
        sub.status = "active"
        sub.save()
        r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert r.status_code == 409

    def test_reuses_open_session_instead_of_creating_a_second_one(self, new_owner, stripe_on):
        # 別のタブ・やり直しで押しても、開いたままの支払い画面を使う（二重の契約を防ぐ）
        url = "/api/v1/admin/tenants/komorebi/billing/checkout"
        with mock.patch.object(
            stripe.checkout.Session, "create", return_value={"url": "https://c/1", "id": "cs_1"}
        ) as create:
            assert client_for(new_owner).post(url).json()["url"] == "https://c/1"
        assert Subscription.objects.get(tenant__subdomain="komorebi").checkout_session_id == "cs_1"
        with (
            mock.patch.object(
                stripe.checkout.Session, "retrieve", return_value=obj({"status": "open", "url": "https://c/1"})
            ),
            mock.patch.object(stripe.checkout.Session, "create") as create,
        ):
            assert client_for(new_owner).post(url).json()["url"] == "https://c/1"
        assert not create.called
        # 期限が切れていれば、新しく作る
        with (
            mock.patch.object(stripe.checkout.Session, "retrieve", return_value=obj({"status": "expired"})),
            mock.patch.object(stripe.checkout.Session, "create", return_value={"url": "https://c/2", "id": "cs_2"}),
        ):
            assert client_for(new_owner).post(url).json()["url"] == "https://c/2"
        assert Subscription.objects.get(tenant__subdomain="komorebi").checkout_session_id == "cs_2"

    def test_completed_session_is_synced_instead_of_paying_twice(self, new_owner, stripe_on):
        sub = Subscription.objects.get(tenant__subdomain="komorebi")
        sub.checkout_session_id = "cs_1"
        sub.save()
        with (
            mock.patch.object(
                stripe.checkout.Session, "retrieve", return_value=obj({"status": "complete", "subscription": "sub_1"})
            ),
            mock.patch.object(stripe.Subscription, "retrieve", return_value=stripe_sub(tenant_id=sub.tenant_id)),
            mock.patch.object(stripe.checkout.Session, "create") as create,
        ):
            r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert r.status_code == 409 and not create.called
        assert Subscription.objects.get(pk=sub.pk).status == "active"

    def test_stripe_error_is_502(self, new_owner, stripe_on):
        with mock.patch.object(stripe.checkout.Session, "create", side_effect=stripe.APIConnectionError("down")):
            r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/checkout")
        assert r.status_code == 502

    def test_return_from_checkout_activates_without_waiting_for_webhook(self, new_owner, stripe_on):
        tid = Tenant.objects.get(subdomain="komorebi").pk
        session = obj({"client_reference_id": str(tid), "subscription": "sub_1"})
        with (
            mock.patch.object(stripe.checkout.Session, "retrieve", return_value=session),
            mock.patch.object(stripe.Subscription, "retrieve", return_value=stripe_sub(tenant_id=tid)),
        ):
            b = client_for(new_owner).get("/api/v1/admin/tenants/komorebi/billing?checkout_session=cs_1").json()
        assert b["usable"] is True and b["status"] == "active" and b["manageable"] is True
        sub = Subscription.objects.get(tenant_id=tid)
        assert sub.stripe_subscription_id == "sub_1" and sub.current_period_end is not None

    def test_return_with_other_stores_session_is_ignored(self, new_owner, stripe_on):
        session = obj({"client_reference_id": "999999", "subscription": "sub_other"})
        with (
            mock.patch.object(stripe.checkout.Session, "retrieve", return_value=session),
            mock.patch.object(stripe.Subscription, "retrieve") as retrieve,
        ):
            b = client_for(new_owner).get("/api/v1/admin/tenants/komorebi/billing?checkout_session=cs_x").json()
        assert b["usable"] is False and not retrieve.called

    def test_return_sync_failure_still_answers(self, new_owner, stripe_on):
        with mock.patch.object(stripe.checkout.Session, "retrieve", side_effect=stripe.APIConnectionError("down")):
            r = client_for(new_owner).get("/api/v1/admin/tenants/komorebi/billing?checkout_session=cs_1")
        assert r.status_code == 200 and r.json()["usable"] is False


class TestPortal:
    def test_portal_needs_customer(self, new_owner, stripe_on):
        assert client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/portal").status_code == 409
        Subscription.objects.filter(tenant__subdomain="komorebi").update(stripe_customer_id="cus_1", status="active")
        with mock.patch.object(
            stripe.billing_portal.Session, "create", return_value={"url": "https://portal/x"}
        ) as create:
            r = client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/portal")
        assert r.json()["url"] == "https://portal/x" and create.call_args.kwargs["customer"] == "cus_1"
        with mock.patch.object(stripe.billing_portal.Session, "create", side_effect=stripe.APIConnectionError("x")):
            assert client_for(new_owner).post("/api/v1/admin/tenants/komorebi/billing/portal").status_code == 502


def post_webhook(event_type, data_object):
    event = obj({"type": event_type, "data": {"object": data_object}})
    with mock.patch.object(stripe_api, "construct_event", return_value=event) as construct:
        r = APIClient().post(
            "/api/v1/billing/stripe-webhook", {"x": 1}, format="json", HTTP_STRIPE_SIGNATURE="t=1,v1=abc"
        )
    return r, construct


class TestWebhook:
    def test_not_configured_and_bad_signature(self, db, settings):
        settings.STRIPE_SECRET_KEY = ""
        assert APIClient().post("/api/v1/billing/stripe-webhook", {}, format="json").status_code == 503
        settings.STRIPE_SECRET_KEY, settings.STRIPE_PRICE_ID, settings.STRIPE_WEBHOOK_SECRET = "sk", "price", "whsec"
        r = APIClient().post("/api/v1/billing/stripe-webhook", {}, format="json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")
        assert r.status_code == 400

    def test_checkout_completed_then_updates_follow_stripe(self, new_owner, stripe_on):
        tid = Tenant.objects.get(subdomain="komorebi").pk
        with mock.patch.object(stripe.Subscription, "retrieve", return_value=stripe_sub(tenant_id=tid)):
            r, _ = post_webhook(
                "checkout.session.completed",
                {"mode": "subscription", "subscription": "sub_1", "client_reference_id": str(tid)},
            )
        assert r.status_code == 200
        assert Subscription.objects.get(tenant_id=tid).status == "active"
        # 同じ知らせが重なっても、順番が入れ替わっても、Stripe の今の状態に合わせる
        with mock.patch.object(stripe.Subscription, "retrieve", return_value=stripe_sub("past_due", tid)):
            post_webhook("customer.subscription.updated", {"id": "sub_1", "status": "active"})
            post_webhook("customer.subscription.updated", {"id": "sub_1", "status": "active"})
        assert Subscription.objects.get(tenant_id=tid).status == "past_due"
        with mock.patch.object(stripe.Subscription, "retrieve", return_value=stripe_sub("canceled", tid, cancel=True)):
            post_webhook("customer.subscription.deleted", {"id": "sub_1"})
        sub = Subscription.objects.get(tenant_id=tid)
        assert sub.status == "canceled" and sub.cancel_at_period_end is True and not sub.usable

    def test_unknown_store_and_other_events_are_ignored(self, new_owner, stripe_on):
        with mock.patch.object(
            stripe.Subscription, "retrieve", return_value=stripe_sub(tenant_id="999999", sub_id="sub_x")
        ):
            r, _ = post_webhook("customer.subscription.created", {"id": "sub_x"})
        assert r.status_code == 200
        r, _ = post_webhook("invoice.paid", {"id": "in_1"})
        assert r.status_code == 200
        assert Subscription.objects.get(tenant__subdomain="komorebi").status == "pending"

    def test_old_subscription_does_not_override_active_one(self, new_owner, stripe_on):
        sub = Subscription.objects.get(tenant__subdomain="komorebi")
        sub.stripe_subscription_id, sub.status = "sub_new", "active"
        sub.save()
        with mock.patch.object(
            stripe.Subscription, "retrieve", return_value=stripe_sub("canceled", sub.tenant_id, "sub_old")
        ):
            post_webhook("customer.subscription.deleted", {"id": "sub_old"})
        sub.refresh_from_db()
        assert sub.status == "active" and sub.stripe_subscription_id == "sub_new"

    def test_stripe_down_asks_for_retry(self, new_owner, stripe_on):
        with mock.patch.object(stripe.Subscription, "retrieve", side_effect=stripe.APIConnectionError("down")):
            r, _ = post_webhook("customer.subscription.updated", {"id": "sub_1"})
        assert r.status_code == 502

    def test_period_end_from_older_api_shape(self):
        assert stripe_api._period_end({"current_period_end": 1_800_000_000}) is not None
        assert stripe_api._period_end({"items": {"data": []}}) is None


class TestPlanLabel:
    PRICE = {"unit_amount": 1980, "currency": "jpy", "recurring": {"interval": "month"}, "tax_behavior": "inclusive"}

    def test_from_stripe_price_and_cached(self, db, stripe_on):
        with mock.patch.object(stripe.Price, "retrieve", return_value=obj(self.PRICE)) as retrieve:
            assert APIClient().get("/api/v1/public/plan").json() == {"price_label": "月額1,980円（税込）"}
            assert stripe_api.plan_label() == "月額1,980円（税込）"
        assert retrieve.call_count == 1

    def test_setting_overrides_and_unconfigured_or_failure_is_empty(self, db, settings):
        assert stripe_api.plan_label() == ""
        settings.STRIPE_SECRET_KEY, settings.STRIPE_PRICE_ID = "sk", "price"
        with mock.patch.object(stripe.Price, "retrieve", side_effect=stripe.APIConnectionError("down")):
            assert stripe_api.plan_label() == ""
        settings.PLAN_PRICE_LABEL = "月額2,000円"
        assert stripe_api.plan_label() == "月額2,000円"

    def test_format(self):
        f = stripe_api.format_price
        assert (
            f({"unit_amount": 21780, "currency": "jpy", "recurring": {"interval": "year"}, "tax_behavior": "exclusive"})
            == "年額21,780円（税別）"
        )
        assert f({"unit_amount": 1980, "currency": "jpy"}) == "1,980円"
        assert f({"unit_amount": 10, "currency": "usd"}) == ""
        assert f({"currency": "jpy"}) == ""

    def test_billing_includes_price_label(self, new_owner, stripe_on):
        stripe_on.PLAN_PRICE_LABEL = "月額1,980円（税込）"
        b = client_for(new_owner).get("/api/v1/admin/tenants/komorebi/billing").json()
        assert b["price_label"] == "月額1,980円（税込）"
