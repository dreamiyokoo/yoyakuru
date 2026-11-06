from django.db import models
from django.db.models import Q

from apps.tenants.models import Tenant

# 店舗を使える契約の状態。past_due は Stripe が支払いをやり直している間なので、すぐには止めない
USABLE_STATUSES = ("active", "trialing", "past_due")


class Subscription(models.Model):
    """店舗の月額契約（BILL-01、BILL-04）。状態は Stripe の Subscription に合わせる。

    この記録がない店舗（運営が管理サイトで作った店舗）は、支払いなしで使える。
    セルフ登録した店舗は pending で作られ、Stripe で支払いが済むまで使えない。
    """

    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="subscription")
    status = models.CharField("状態", max_length=30, default="pending")
    stripe_customer_id = models.CharField(max_length=100, blank=True)
    stripe_subscription_id = models.CharField(max_length=100, blank=True, db_index=True)
    # 作成済みの支払い画面。開いたままの画面があれば使い回し、二重の契約を防ぐ
    checkout_session_id = models.CharField(max_length=100, blank=True)
    current_period_end = models.DateTimeField("次の請求日", null=True, blank=True)
    cancel_at_period_end = models.BooleanField("期間の終わりに解約", default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = verbose_name_plural = "契約"

    def __str__(self) -> str:
        return f"{self.tenant} {self.status}"

    @property
    def usable(self) -> bool:
        return self.status in USABLE_STATUSES


def usable(tenant: Tenant) -> bool:
    sub = Subscription.objects.filter(tenant=tenant).first()
    return sub is None or sub.usable


def usable_tenants_q(prefix: str = "") -> Q:
    """支払いが済んでいる（または契約の記録がない）店舗を絞り込む条件。"""
    return Q(**{f"{prefix}subscription__isnull": True}) | Q(**{f"{prefix}subscription__status__in": USABLE_STATUSES})
