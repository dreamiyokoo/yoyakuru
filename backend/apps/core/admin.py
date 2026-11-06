from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import TwoFactor


@admin.register(TwoFactor)
class TwoFactorAdmin(ModelAdmin):
    """運営による二段階認証のリセット（店舗のオーナーが一人だけで、端末と回復コードの両方を失ったとき）。

    鍵と回復コードは表示しない。削除すると、その利用者は次のログインで設定し直す。
    """

    list_display = ["user", "confirmed_at"]
    search_fields = ["user__email"]
    fields = ["user", "confirmed_at"]
    readonly_fields = ["user", "confirmed_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
