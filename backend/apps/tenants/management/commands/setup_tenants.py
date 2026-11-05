"""
初期テナントとドメインをセットアップする管理コマンド（冪等）。

Usage:
    python manage.py setup_tenants
    python manage.py setup_tenants --create-superuser
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "初期テナント (public, demo) とドメインを作成する"

    def add_arguments(self, parser):
        parser.add_argument(
            "--create-superuser",
            action="store_true",
            help="admin スーパーユーザーを作成する（既存の場合はスキップ）",
        )

    def handle(self, *args, **options):
        from apps.tenants.models import Tenant

        base = settings.TENANT_BASE_DOMAIN
        connection.set_schema_to_public()

        self._tenant(
            Tenant, "public", "Public", f"admin@{base}", [(f"admin.{base}", True), (base, False), ("admin.localhost", False)]
        )
        self._tenant(
            Tenant, "demo", "Demo", f"demo@{base}", [(f"demo.{base}", True), ("localhost", False), ("demo.localhost", False)]
        )

        if options["create_superuser"]:
            self._create_superuser(base)

        self.stdout.write(self.style.SUCCESS("setup_tenants 完了"))

    def _tenant(self, Tenant, schema, name, email, domains):
        from apps.tenants.models import Domain

        tenant, created = Tenant.objects.get_or_create(
            schema_name=schema,
            defaults={"name": name, "subdomain": schema, "admin_email": email},
        )
        self.stdout.write(
            self.style.SUCCESS(f"{schema} テナントを作成しました")
            if created
            else f"{schema} テナントは既に存在します"
        )
        for domain, is_primary in domains:
            _, created = Domain.objects.get_or_create(
                domain=domain, defaults={"tenant": tenant, "is_primary": is_primary}
            )
            self.stdout.write(f"  ドメイン {domain}: {'作成' if created else '既存'}")
        return tenant

    def _create_superuser(self, base):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        if User.objects.filter(username="admin").exists():
            self.stdout.write("スーパーユーザー admin は既に存在します")
            return
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
        if not password:
            self.stdout.write(
                self.style.WARNING(
                    "DJANGO_SUPERUSER_PASSWORD が未設定のためスーパーユーザーを作成しません"
                )
            )
            return
        User.objects.create_superuser(
            username="admin", email=f"admin@{base}", password=password
        )
        self.stdout.write(self.style.SUCCESS("スーパーユーザー admin を作成しました"))
