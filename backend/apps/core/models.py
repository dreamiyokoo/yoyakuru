"""店舗利用者の二段階認証（LOGIN-07：オーナーは必須）。

認証アプリ（Google Authenticator等）の6桁のコード（TOTP、RFC 6238）を使う。計算は実績のある pyotp に任せる
（LOGIN-09）。認証アプリを失ったときのために、1回ずつ使える回復コードを発行する（ハッシュで保存）。
"""

from django.conf import settings
from django.db import models


class TwoFactor(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="two_factor")
    secret = models.CharField(max_length=64)
    confirmed_at = models.DateTimeField(null=True, blank=True, help_text="認証アプリでの確認が済んだ日時")
    last_used_step = models.BigIntegerField(default=0, help_text="同じコードの使い回しを防ぐ")
    recovery_codes = models.JSONField(default=list, help_text="回復コードのハッシュ。使ったものは消す")

    class Meta:
        verbose_name = verbose_name_plural = "二段階認証"

    def __str__(self) -> str:
        return f"{self.user} の二段階認証"

    @property
    def enabled(self) -> bool:
        return self.confirmed_at is not None
