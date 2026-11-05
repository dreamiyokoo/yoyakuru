"""予約と、その履歴。

予約のマスターはヨヤクルDB（SYNC-01）。状態は仮押さえ・確定・取消・期限切れ（4.3）。
"""

import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.stores.models import Resource, Service, Staff
from apps.tenants.models import TenantOwnedModel, TenantOwnedQuerySet


def new_token() -> str:
    return secrets.token_urlsafe(32)


class BookingStatus(models.TextChoices):
    HOLD = "hold", "仮押さえ"
    CONFIRMED = "confirmed", "確定"
    CANCELLED = "cancelled", "取消"
    EXPIRED = "expired", "期限切れ"


class Channel(models.TextChoices):
    WEB = "web", "Web"
    CHAT = "chat", "チャット"
    PHONE = "phone", "電話"
    ADMIN = "admin", "店舗で登録"


class CustomerType(models.TextChoices):
    FIRST = "first", "初めて"
    REPEAT = "repeat", "2回目以降"


class BookingQuerySet(TenantOwnedQuerySet):
    def blocking(self, now=None):
        """枠を占有している予約（確定、または期限内の仮押さえ）。"""
        now = now or timezone.now()
        return self.filter(
            models.Q(status=BookingStatus.CONFIRMED) | models.Q(status=BookingStatus.HOLD, hold_expires_at__gt=now)
        )


class Booking(TenantOwnedModel):
    service = models.ForeignKey(Service, on_delete=models.PROTECT, related_name="bookings")
    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="bookings")
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.PROTECT)
    resource_quantity = models.PositiveSmallIntegerField(default=0)
    party_size = models.PositiveSmallIntegerField(default=1)

    starts_at = models.DateTimeField(help_text="お客様に案内する開始時刻")
    ends_at = models.DateTimeField(help_text="お客様に案内する終了時刻")
    occupied_from = models.DateTimeField(help_text="準備時間を含めて担当・設備を占有する開始")
    occupied_until = models.DateTimeField(help_text="準備時間と刻みの切り上げを含めた占有の終了")

    status = models.CharField(max_length=10, choices=BookingStatus.choices, default=BookingStatus.HOLD)
    hold_expires_at = models.DateTimeField(null=True, blank=True)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.WEB)
    ai_assisted = models.BooleanField(default=False, help_text="AIが関わった予約（USAGE-01）")
    auto_assigned = models.BooleanField(default=False, help_text="指名なしで割り当てたか")

    customer_type = models.CharField(max_length=10, choices=CustomerType.choices, default=CustomerType.REPEAT)
    customer_name = models.CharField(max_length=100)
    customer_email = models.EmailField(blank=True)
    customer_phone = models.CharField(max_length=20, blank=True)
    note = models.CharField(max_length=500, blank=True)

    token = models.CharField(max_length=64, unique=True, default=new_token, editable=False)
    idempotency_key = models.CharField(max_length=64, null=True, blank=True)  # noqa: DJ001  空の重複を許すためNULL

    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    objects = BookingQuerySet.as_manager()

    class Meta:
        ordering = ["starts_at"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="uniq_booking_idempotency"),
            models.CheckConstraint(
                condition=models.Q(occupied_until__gt=models.F("occupied_from")), name="occupied_positive"
            ),
        ]
        indexes = [models.Index(fields=["tenant", "occupied_from", "occupied_until"])]

    def __str__(self) -> str:
        return f"{self.customer_name} {self.starts_at:%Y-%m-%d %H:%M}"


class BookingEvent(TenantOwnedModel):
    """確定・取消・変更の履歴と操作経路（BOOK-07）。"""

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="events")
    action = models.CharField(max_length=20)
    channel = models.CharField(max_length=10, choices=Channel.choices)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
