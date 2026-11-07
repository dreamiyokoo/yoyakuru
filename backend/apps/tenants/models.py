import re

from django.core.exceptions import ValidationError
from django.db import models

# TENANT-04: 共通ドメインや運用で使うため、店舗名に使えないサブドメイン
RESERVED_SUBDOMAINS = {"www", "app", "api", "mcp", "admin", "mail", "static", "media"}


def validate_subdomain(value: str) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]", value):
        raise ValidationError("サブドメインは小文字英数字とハイフンのみ、3〜32文字（先頭・末尾はハイフン不可）")
    if value in RESERVED_SUBDOMAINS:
        raise ValidationError(f"'{value}' は予約済みサブドメインのため使用できません")


class Tenant(models.Model):
    name = models.CharField(max_length=100)
    subdomain = models.SlugField(unique=True, validators=[validate_subdomain])
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # 公開ページに出す連絡先
    phone = models.CharField("電話番号", max_length=20, blank=True)
    address = models.CharField("住所", max_length=200, blank=True)
    timezone = models.CharField("タイムゾーン", max_length=50, default="Asia/Tokyo")
    # 予約の受付ルール（TIME-03〜05、CUST-05、MENU-03）
    slot_interval_minutes = models.PositiveSmallIntegerField("開始時刻の刻み（分）", default=30)
    booking_window_days = models.PositiveSmallIntegerField("何日先まで受け付けるか", default=60)
    same_day_cutoff_minutes = models.PositiveIntegerField("受付の締切（開始の何分前）", default=120)
    cancel_deadline_days = models.PositiveSmallIntegerField(
        "取消の締切（予約日の何日前の終わりまで）", default=1, help_text="0なら開始時刻まで"
    )
    default_buffer_minutes = models.PositiveSmallIntegerField("準備時間の既定値（分）", default=0)
    # チャットのAIが答えてよい店舗の案内（CHAT-05）。ここにない事項は断定しない
    guide = models.TextField("お客様への案内", blank=True, help_text="アクセス・駐車場・支払い方法・持ち物など")

    class Meta:
        verbose_name = "店舗"
        verbose_name_plural = "店舗一覧"

    def __str__(self) -> str:
        return f"{self.name} ({self.subdomain})"


class TenantOwnedQuerySet(models.QuerySet):
    def for_tenant(self, tenant: Tenant) -> "TenantOwnedQuerySet":
        return self.filter(tenant=tenant)


class TenantOwnedModel(models.Model):
    """店舗に属するデータの基底クラス。店舗ごとのデータは必ずこれを継承する（AC-09）。

    店舗をまたいだ取得を防ぐため、ビュー等では `Model.objects.for_tenant(tenant)` で絞り込む。
    """

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="+")

    objects = TenantOwnedQuerySet.as_manager()

    class Meta:
        abstract = True
