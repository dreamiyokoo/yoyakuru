"""店舗（テナント）と、予約の受付条件を表すモデル。

業種に依存しない言葉を使う（GEN-01）。サービス＝メニュー、担当者＝スタッフ、資源＝ベッド等の設備。
"""

import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

RESERVED_SLUGS = {"www", "app", "api", "mcp", "admin", "static", "mail", "help", "support"}
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$")


def validate_store_slug(value: str) -> None:
    """店舗名（サブドメイン）の検証（TENANT-04）。"""
    if not SLUG_RE.match(value or ""):
        raise ValidationError("英小文字・数字・ハイフンの3〜32文字で、先頭と末尾は英数字にしてください")
    if value in RESERVED_SLUGS:
        raise ValidationError("この名前は使えません")


class Store(models.Model):
    slug = models.CharField(max_length=32, unique=True, validators=[validate_store_slug])
    name = models.CharField(max_length=100)
    phone = models.CharField(max_length=20, blank=True)
    address = models.CharField(max_length=200, blank=True)
    timezone = models.CharField(max_length=50, default="Asia/Tokyo")
    is_active = models.BooleanField(default=True)
    # 受付ルール（TIME-03〜05、CUST-05）
    slot_interval_minutes = models.PositiveSmallIntegerField(default=30)
    booking_window_days = models.PositiveSmallIntegerField(default=60)
    same_day_cutoff_minutes = models.PositiveIntegerField(default=120)
    cancel_deadline_days = models.PositiveSmallIntegerField(
        default=1, help_text="予約日の何日前の終わりまで取消できるか"
    )
    default_buffer_minutes = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class Role(models.TextChoices):
    OWNER = "owner", "オーナー"
    STAFF = "staff", "スタッフ"


class Staff(models.Model):
    """予約の担当者。ログインユーザーとは別に持つ（3章）。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="staff")
    display_name = models.CharField(max_length=50)
    title = models.CharField(max_length=50, blank=True)
    priority = models.PositiveSmallIntegerField(default=100, help_text="指名なしの割当順。小さいほど優先（ASSIGN-01）")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["priority", "id"]

    def __str__(self) -> str:
        return self.display_name


class Membership(models.Model):
    """ログインユーザーの店舗所属と権限。"""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices)
    staff = models.OneToOneField(Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="membership")
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "store"], name="uniq_membership")]


class Resource(models.Model):
    """同時に使える数に上限がある設備（ベッド等）。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="resources")
    name = models.CharField(max_length=50)
    quantity = models.PositiveSmallIntegerField(default=1)

    def __str__(self) -> str:
        return self.name


class Service(models.Model):
    """お客様が予約するサービス（メニュー）。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="services")
    name = models.CharField(max_length=100)
    category = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    price = models.PositiveIntegerField(null=True, blank=True, help_text="表示のみ（税込）")
    duration_minutes = models.PositiveSmallIntegerField(help_text="通常（2回目以降）の所要時間")
    first_visit_duration_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    buffer_before_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    buffer_after_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    staff = models.ManyToManyField(Staff, related_name="services", blank=True)
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.SET_NULL)
    resource_quantity = models.PositiveSmallIntegerField(default=1)
    capacity = models.PositiveSmallIntegerField(default=1, help_text="1枠に入れる人数（EXT-01）。1は1対1")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=100)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.name

    def duration_for(self, customer_type: str) -> int:
        if customer_type == "first" and self.first_visit_duration_minutes:
            return self.first_visit_duration_minutes
        return self.duration_minutes

    def buffers(self) -> tuple[int, int]:
        default = self.store.default_buffer_minutes
        before = self.buffer_before_minutes if self.buffer_before_minutes is not None else default
        after = self.buffer_after_minutes if self.buffer_after_minutes is not None else default
        return before, after


class Weekday(models.IntegerChoices):
    MON = 0, "月"
    TUE = 1, "火"
    WED = 2, "水"
    THU = 3, "木"
    FRI = 4, "金"
    SAT = 5, "土"
    SUN = 6, "日"


class BusinessHours(models.Model):
    """曜日ごとの営業時間（TIME-02）。行がない曜日は定休日。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="business_hours")
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    opens_at = models.TimeField()
    closes_at = models.TimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["store", "weekday"], name="uniq_business_hours")]


class DateOverride(models.Model):
    """日付指定の臨時休業・特別営業（TIME-02）。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="date_overrides")
    date = models.DateField()
    is_closed = models.BooleanField(default=True)
    opens_at = models.TimeField(null=True, blank=True)
    closes_at = models.TimeField(null=True, blank=True)
    note = models.CharField(max_length=100, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["store", "date"], name="uniq_date_override")]


class WeeklyShift(models.Model):
    """スタッフの曜日ごとの定例勤務。行がない曜日は休み。"""

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="weekly_shifts")
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    starts_at = models.TimeField()
    ends_at = models.TimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["staff", "weekday"], name="uniq_weekly_shift")]


class ShiftException(models.Model):
    """日付ごとの勤務の例外。is_off なら終日休み。"""

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="shift_exceptions")
    date = models.DateField()
    is_off = models.BooleanField(default=False)
    starts_at = models.TimeField(null=True, blank=True)
    ends_at = models.TimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["staff", "date"], name="uniq_shift_exception")]


class RecurringBreak(models.Model):
    """定例の休憩（BREAK-01）。staff が空なら店舗全員。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="breaks")
    staff = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.CASCADE, related_name="breaks")
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices, null=True, blank=True, help_text="空なら毎日")
    starts_at = models.TimeField()
    ends_at = models.TimeField()


class TimeOff(models.Model):
    """臨時の休み・予約不可時間（BREAK-02、Google連携前の手入力）。staff が空なら店舗全体。"""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="time_offs")
    staff = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.CASCADE, related_name="time_offs")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    reason = models.CharField(max_length=100, blank=True, help_text="お客様には表示しない")


class Holiday(models.Model):
    """祝日（CAL-02）。表示用で、営業するかは DateOverride で決める。"""

    date = models.DateField(unique=True)
    name = models.CharField(max_length=50)
