"""店舗ごとの予約の受付条件を表すモデル。

業種に依存しない言葉を使う（GEN-01）。サービス＝メニュー、担当者＝スタッフ、設備＝ベッド等の資源。
店舗のデータはすべて TenantOwnedModel を継承し、`objects.for_tenant(tenant)` で絞り込む（AC-09）。
"""

from django.conf import settings
from django.db import models

from apps.tenants.models import TenantOwnedModel


class Role(models.TextChoices):
    OWNER = "owner", "オーナー"
    STAFF = "staff", "スタッフ"


class Weekday(models.IntegerChoices):
    MON = 0, "月"
    TUE = 1, "火"
    WED = 2, "水"
    THU = 3, "木"
    FRI = 4, "金"
    SAT = 5, "土"
    SUN = 6, "日"


class Staff(TenantOwnedModel):
    """予約の担当者。ログインユーザーとは別に持つ（3章）。"""

    display_name = models.CharField("表示名", max_length=50)
    title = models.CharField("肩書き", max_length=50, blank=True)
    priority = models.PositiveSmallIntegerField(
        "指名なしの優先順位", default=100, help_text="小さいほど優先（ASSIGN-01）"
    )
    is_active = models.BooleanField("有効", default=True)

    class Meta:
        verbose_name = verbose_name_plural = "担当者"
        ordering = ["priority", "id"]

    def __str__(self) -> str:
        return self.display_name


class Membership(TenantOwnedModel):
    """ログインユーザーの店舗所属と権限。"""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField("権限", max_length=10, choices=Role.choices)
    staff = models.OneToOneField(Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="membership")
    is_active = models.BooleanField("有効", default=True)

    class Meta:
        verbose_name = verbose_name_plural = "店舗の所属"
        constraints = [models.UniqueConstraint(fields=["user", "tenant"], name="uniq_membership")]

    def __str__(self) -> str:
        return f"{self.user} ({self.get_role_display()})"


class Resource(TenantOwnedModel):
    """同時に使える数に上限がある設備（ベッド等）。"""

    name = models.CharField("名前", max_length=50)
    quantity = models.PositiveSmallIntegerField("数", default=1)

    class Meta:
        verbose_name = verbose_name_plural = "設備"

    def __str__(self) -> str:
        return self.name


class Service(TenantOwnedModel):
    """お客様が予約するサービス（メニュー）。"""

    name = models.CharField("名称", max_length=100)
    category = models.CharField("カテゴリ", max_length=50, blank=True)
    description = models.TextField("説明", blank=True)
    price = models.PositiveIntegerField("料金（表示のみ・税込）", null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField("所要時間（2回目以降）")
    first_visit_duration_minutes = models.PositiveSmallIntegerField("所要時間（初めて）", null=True, blank=True)
    buffer_before_minutes = models.PositiveSmallIntegerField("前の準備時間", null=True, blank=True)
    buffer_after_minutes = models.PositiveSmallIntegerField("後の準備時間", null=True, blank=True)
    staff = models.ManyToManyField(Staff, related_name="services", blank=True, verbose_name="担当できる人")
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.SET_NULL, verbose_name="使う設備")
    resource_quantity = models.PositiveSmallIntegerField("設備の使用数", default=1)
    capacity = models.PositiveSmallIntegerField("定員", default=1, help_text="1枠に入れる人数（EXT-01）。1は1対1")
    is_active = models.BooleanField("公開", default=True)
    sort_order = models.PositiveSmallIntegerField("並び順", default=100)

    class Meta:
        verbose_name = verbose_name_plural = "サービス"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.name

    def duration_for(self, customer_type: str) -> int:
        if customer_type == "first" and self.first_visit_duration_minutes:
            return self.first_visit_duration_minutes
        return self.duration_minutes

    def buffers(self) -> tuple[int, int]:
        default = self.tenant.default_buffer_minutes
        before = self.buffer_before_minutes if self.buffer_before_minutes is not None else default
        after = self.buffer_after_minutes if self.buffer_after_minutes is not None else default
        return before, after


class BusinessHours(TenantOwnedModel):
    """曜日ごとの営業時間（TIME-02）。行がない曜日は定休日。"""

    weekday = models.PositiveSmallIntegerField("曜日", choices=Weekday.choices)
    opens_at = models.TimeField("開始")
    closes_at = models.TimeField("終了")

    class Meta:
        verbose_name = verbose_name_plural = "営業時間"
        constraints = [models.UniqueConstraint(fields=["tenant", "weekday"], name="uniq_business_hours")]


class DateOverride(TenantOwnedModel):
    """日付指定の臨時休業・特別営業（TIME-02）。"""

    date = models.DateField("日付")
    is_closed = models.BooleanField("休業", default=True)
    opens_at = models.TimeField("開始", null=True, blank=True)
    closes_at = models.TimeField("終了", null=True, blank=True)
    note = models.CharField("メモ", max_length=100, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "臨時休業・特別営業"
        constraints = [models.UniqueConstraint(fields=["tenant", "date"], name="uniq_date_override")]


class WeeklyShift(TenantOwnedModel):
    """担当者の曜日ごとの定例勤務。行がない曜日は休み。"""

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="weekly_shifts")
    weekday = models.PositiveSmallIntegerField("曜日", choices=Weekday.choices)
    starts_at = models.TimeField("開始")
    ends_at = models.TimeField("終了")

    class Meta:
        verbose_name = verbose_name_plural = "勤務（曜日ごと）"
        constraints = [models.UniqueConstraint(fields=["staff", "weekday"], name="uniq_weekly_shift")]


class ShiftException(TenantOwnedModel):
    """日付ごとの勤務の例外。is_off なら終日休み。"""

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="shift_exceptions")
    date = models.DateField("日付")
    is_off = models.BooleanField("休み", default=False)
    starts_at = models.TimeField("開始", null=True, blank=True)
    ends_at = models.TimeField("終了", null=True, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "勤務の例外（日付ごと）"
        constraints = [models.UniqueConstraint(fields=["staff", "date"], name="uniq_shift_exception")]


class RecurringBreak(TenantOwnedModel):
    """定例の休憩（BREAK-01）。担当者が空なら店舗全員。"""

    staff = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.CASCADE, related_name="breaks")
    weekday = models.PositiveSmallIntegerField(
        "曜日", choices=Weekday.choices, null=True, blank=True, help_text="空なら毎日"
    )
    starts_at = models.TimeField("開始")
    ends_at = models.TimeField("終了")

    class Meta:
        verbose_name = verbose_name_plural = "定例の休憩"


class TimeOff(TenantOwnedModel):
    """臨時の休み・予約不可時間（BREAK-02）。担当者が空なら店舗全体。"""

    staff = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.CASCADE, related_name="time_offs")
    starts_at = models.DateTimeField("開始")
    ends_at = models.DateTimeField("終了")
    reason = models.CharField("理由（お客様には表示しない）", max_length=100, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "休み・予約不可時間"


class Holiday(models.Model):
    """祝日（CAL-02）。全店舗共通の表示用で、営業するかは DateOverride で決める。"""

    date = models.DateField("日付", unique=True)
    name = models.CharField("名前", max_length=50)

    class Meta:
        verbose_name = verbose_name_plural = "祝日"

    def __str__(self) -> str:
        return f"{self.date} {self.name}"
