"""Stripe とのやりとり（BILL-01、BILL-04）。

状態はイベントの中身を信用せず、毎回 Stripe から今の Subscription を取り直して合わせる。
イベントが重複しても、順番が入れ替わっても、最後は Stripe と同じ状態になる（冪等）。
"""

from __future__ import annotations

from datetime import UTC, datetime

import stripe
from django.conf import settings

from apps.tenants.models import Tenant

from .models import Subscription


class NotConfigured(Exception):
    pass


def configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID)


def _key() -> str:
    if not configured():
        raise NotConfigured
    return settings.STRIPE_SECRET_KEY


def open_checkout_url(sub: Subscription) -> str | None:
    """作成済みの支払い画面がまだ開いていれば、そのURLを返す（別のタブ・やり直しでも同じ画面を使う）。"""
    if not sub.checkout_session_id:
        return None
    session = stripe.checkout.Session.retrieve(sub.checkout_session_id, api_key=_key()).to_dict()
    if session.get("status") == "open":
        return session.get("url")
    if session.get("status") == "complete" and session.get("subscription"):
        # 支払いは済んでいて、知らせがまだ届いていない
        sync_subscription(str(session["subscription"]), str(sub.tenant_id))
    return None


def create_checkout(sub: Subscription, email: str) -> str:
    """月額契約の支払い画面（Stripe Checkout）のURLを作り、使い回せるように覚えておく。"""
    tenant_id = str(sub.tenant_id)
    params: dict = {
        "mode": "subscription",
        "line_items": [{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
        "client_reference_id": tenant_id,
        "metadata": {"tenant_id": tenant_id},
        "subscription_data": {"metadata": {"tenant_id": tenant_id}},
        "success_url": f"{settings.ADMIN_APP_URL}/bookings?checkout_session={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.ADMIN_APP_URL}/bookings",
        "locale": "ja",
    }
    if sub.stripe_customer_id:
        params["customer"] = sub.stripe_customer_id
    else:
        params["customer_email"] = email
    session = stripe.checkout.Session.create(api_key=_key(), **params)
    sub.checkout_session_id = session["id"]
    sub.save(update_fields=["checkout_session_id", "updated_at"])
    return session["url"]


def create_portal(sub: Subscription) -> str:
    """カードの変更・領収書・解約を行う画面（Stripe カスタマーポータル）のURLを作る。"""
    session = stripe.billing_portal.Session.create(
        api_key=_key(), customer=sub.stripe_customer_id, return_url=f"{settings.ADMIN_APP_URL}/account"
    )
    return session["url"]


def construct_event(payload: bytes, signature: str):
    return stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)


def _period_end(stripe_sub) -> datetime | None:
    # 新しいAPIでは請求期間は契約の項目ごとに持つ。古いAPIの形にも対応する
    items = (stripe_sub.get("items") or {}).get("data") or []
    ts = (items[0].get("current_period_end") if items else None) or stripe_sub.get("current_period_end")
    return datetime.fromtimestamp(ts, UTC) if ts else None


def sync_subscription(subscription_id: str, tenant_id: str | None = None) -> Subscription | None:
    """Stripe の今の契約の状態を、店舗の契約に写す。どの店舗のものか分からなければ何もしない。"""
    stripe_sub = stripe.Subscription.retrieve(subscription_id, api_key=_key()).to_dict()
    tid = (stripe_sub.get("metadata") or {}).get("tenant_id") or tenant_id
    sub = Subscription.objects.filter(stripe_subscription_id=subscription_id).first()
    if sub is None and tid and str(tid).isdigit():
        sub = Subscription.objects.filter(tenant_id=int(tid)).first()
        if sub and sub.stripe_subscription_id and sub.stripe_subscription_id != subscription_id and sub.usable:
            # 既に有効な別の契約がある店舗を、古い（または別の）契約の知らせで上書きしない
            return sub
    if sub is None:
        return None
    sub.stripe_subscription_id = subscription_id
    sub.stripe_customer_id = str(stripe_sub.get("customer") or sub.stripe_customer_id)
    sub.status = stripe_sub["status"]
    sub.current_period_end = _period_end(stripe_sub)
    sub.cancel_at_period_end = bool(stripe_sub.get("cancel_at_period_end"))
    sub.save()
    return sub


def sync_checkout_session(session_id: str, tenant: Tenant) -> Subscription | None:
    """支払い画面から戻ったときに、Webhook を待たずに状態を合わせる。他の店舗の支払いは扱わない。"""
    session = stripe.checkout.Session.retrieve(session_id, api_key=_key()).to_dict()
    if str(session.get("client_reference_id")) != str(tenant.pk) or not session.get("subscription"):
        return None
    return sync_subscription(str(session["subscription"]), str(tenant.pk))


def handle_event(event: dict) -> None:
    obj = event["data"]["object"]
    kind = event["type"]
    if kind == "checkout.session.completed" and obj.get("mode") == "subscription" and obj.get("subscription"):
        sync_subscription(str(obj["subscription"]), obj.get("client_reference_id"))
    elif kind.startswith("customer.subscription."):
        sync_subscription(str(obj["id"]))
