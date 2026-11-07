from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import (
    BusinessHours,
    DateOverride,
    Membership,
    RecurringBreak,
    Resource,
    Service,
    ShiftException,
    Staff,
    WeeklyShift,
)


@admin.register(Staff)
class StaffAdmin(ModelAdmin):
    list_display = ("display_name", "tenant", "priority", "is_active")
    list_filter = ("tenant", "is_active")


@admin.register(Service)
class ServiceAdmin(ModelAdmin):
    list_display = ("name", "tenant", "duration_minutes", "first_visit_duration_minutes", "price", "is_active")
    list_filter = ("tenant", "is_active")
    filter_horizontal = ("staff",)


@admin.register(Resource)
class ResourceAdmin(ModelAdmin):
    list_display = ("name", "tenant", "quantity")
    list_filter = ("tenant",)


@admin.register(BusinessHours)
class BusinessHoursAdmin(ModelAdmin):
    list_display = ("tenant", "weekday", "opens_at", "closes_at")
    list_filter = ("tenant",)


@admin.register(DateOverride)
class DateOverrideAdmin(ModelAdmin):
    list_display = ("tenant", "date", "is_closed", "opens_at", "closes_at", "note")
    list_filter = ("tenant", "is_closed")


@admin.register(WeeklyShift)
class WeeklyShiftAdmin(ModelAdmin):
    list_display = ("staff", "weekday", "starts_at", "ends_at")
    list_filter = ("tenant",)


@admin.register(ShiftException)
class ShiftExceptionAdmin(ModelAdmin):
    list_display = ("staff", "date", "is_off", "starts_at", "ends_at")
    list_filter = ("tenant",)


@admin.register(RecurringBreak)
class RecurringBreakAdmin(ModelAdmin):
    list_display = ("tenant", "staff", "weekday", "starts_at", "ends_at")
    list_filter = ("tenant",)


@admin.register(Membership)
class MembershipAdmin(ModelAdmin):
    list_display = ("user", "tenant", "role", "staff", "is_active")
    list_filter = ("tenant", "role")
