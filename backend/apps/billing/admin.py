from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Subscription


@admin.register(Subscription)
class SubscriptionAdmin(ModelAdmin):
    list_display = ("tenant", "status", "current_period_end", "cancel_at_period_end", "updated_at")
    list_filter = ("status",)
    search_fields = ("tenant__name", "tenant__subdomain", "stripe_customer_id", "stripe_subscription_id")
    # 状態は Stripe から同期する。ここで書き換えると Stripe とずれる
    readonly_fields = (
        "status",
        "stripe_customer_id",
        "stripe_subscription_id",
        "current_period_end",
        "cancel_at_period_end",
    )
