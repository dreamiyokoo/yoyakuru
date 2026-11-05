from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import Booking, BookingEvent


class BookingEventInline(TabularInline):
    model = BookingEvent
    extra = 0
    fields = ("created_at", "action", "channel", "actor")
    readonly_fields = fields
    can_delete = False


@admin.register(Booking)
class BookingAdmin(ModelAdmin):
    list_display = ("starts_at", "tenant", "service", "staff", "customer_name", "status", "channel")
    list_filter = ("tenant", "status", "channel")
    search_fields = ("customer_name", "customer_email", "customer_phone")
    date_hierarchy = "starts_at"
    exclude = ("token",)
    readonly_fields = ("created_at", "confirmed_at", "cancelled_at", "hold_expires_at")
    inlines = [BookingEventInline]
