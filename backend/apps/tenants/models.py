import re

from django.core.exceptions import ValidationError
from django.db import models
from django_tenants.models import DomainMixin, TenantMixin

RESERVED_SUBDOMAINS = {"www", "api", "admin", "mail", "static", "media"}


def validate_subdomain(value: str) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]", value):
        raise ValidationError(
            "サブドメインは小文字英数字とハイフンのみ、3〜32文字（先頭・末尾はハイフン不可）"
        )
    if value in RESERVED_SUBDOMAINS:
        raise ValidationError(f"'{value}' は予約済みサブドメインのため使用できません")


class Tenant(TenantMixin):
    name = models.CharField(max_length=100)
    subdomain = models.SlugField(unique=True, validators=[validate_subdomain])
    admin_email = models.EmailField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # TenantMixin が自動でスキーマを作成する
    auto_create_schema = True

    class Meta:
        verbose_name = "テナント"
        verbose_name_plural = "テナント一覧"

    def __str__(self) -> str:
        return f"{self.name} ({self.subdomain})"


class Domain(DomainMixin):
    class Meta:
        verbose_name = "ドメイン"
        verbose_name_plural = "ドメイン一覧"
