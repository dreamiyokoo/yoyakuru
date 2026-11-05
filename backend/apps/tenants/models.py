import re

from django.core.exceptions import ValidationError
from django.db import models

# TENANT-04: 共通ドメインや運用で使うため、店舗名に使えないサブドメイン
RESERVED_SUBDOMAINS = {"www", "app", "api", "mcp", "admin", "mail", "static", "media"}


def validate_subdomain(value: str) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]", value):
        raise ValidationError(
            "サブドメインは小文字英数字とハイフンのみ、3〜32文字（先頭・末尾はハイフン不可）"
        )
    if value in RESERVED_SUBDOMAINS:
        raise ValidationError(f"'{value}' は予約済みサブドメインのため使用できません")


class Tenant(models.Model):
    name = models.CharField(max_length=100)
    subdomain = models.SlugField(unique=True, validators=[validate_subdomain])
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

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
