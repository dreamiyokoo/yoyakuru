"""
開発用の初期データ（demo 店舗とスーパーユーザー）を作成する管理コマンド（冪等）。

Usage:
    python manage.py seed_dev
"""

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "開発用の demo 店舗と admin スーパーユーザーを作成する"

    def handle(self, *args, **options):
        _, created = Tenant.objects.get_or_create(subdomain="demo", defaults={"name": "Demo"})
        self.stdout.write(
            self.style.SUCCESS("demo 店舗を作成しました") if created else "demo 店舗は既に存在します"
        )

        User = get_user_model()
        if User.objects.filter(username="admin").exists():
            self.stdout.write("スーパーユーザー admin は既に存在します")
            return
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
        if not password:
            self.stdout.write(
                self.style.WARNING("DJANGO_SUPERUSER_PASSWORD が未設定のためスーパーユーザーを作成しません")
            )
            return
        User.objects.create_superuser(
            username="admin", email=f"admin@{settings.TENANT_BASE_DOMAIN}", password=password
        )
        self.stdout.write(self.style.SUCCESS("スーパーユーザー admin を作成しました"))
