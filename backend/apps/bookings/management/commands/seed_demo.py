"""開発・E2Eテスト用のデモ店舗（伏見整体院）を作る。本番では使わない。

DEMO_USER_PASSWORD を設定すると、ログイン用のオーナー（owner@fushimi.example、Aさん）と
スタッフ（staff@fushimi.example、Bさん）も作る。未設定ならユーザーは作らない。
"""

import os
from datetime import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.bookings.models import Booking
from apps.stores.models import BusinessHours, Membership, RecurringBreak, Resource, Role, Service, Staff, WeeklyShift
from apps.tenants.models import Tenant

SUBDOMAIN = "fushimi"


class Command(BaseCommand):
    help = "デモ店舗を作る（--reset で作り直す）"

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true")

    @transaction.atomic
    def handle(self, *args, reset=False, **options):
        if reset:
            Booking.objects.filter(tenant__subdomain=SUBDOMAIN).delete()
            Tenant.objects.filter(subdomain=SUBDOMAIN).delete()
        if Tenant.objects.filter(subdomain=SUBDOMAIN).exists():
            self.stdout.write("exists")
            return
        store = Tenant.objects.create(
            subdomain=SUBDOMAIN, name="伏見整体院", phone="075-000-0000", address="京都市伏見区"
        )
        for wd in range(6):
            BusinessHours.objects.create(tenant=store, weekday=wd, opens_at=time(10), closes_at=time(20))
        RecurringBreak.objects.create(tenant=store, starts_at=time(13), ends_at=time(14))
        beds = Resource.objects.create(tenant=store, name="ベッド", quantity=2)
        staff = [
            Staff.objects.create(tenant=store, display_name=name, title=title, priority=i + 1)
            for i, (name, title) in enumerate([("Aさん", "院長"), ("Bさん", ""), ("Cさん", "")])
        ]
        for member in staff:
            for wd in range(6):
                WeeklyShift.objects.create(tenant=store, staff=member, weekday=wd, starts_at=time(10), ends_at=time(20))
        services = [
            Service.objects.create(
                tenant=store,
                name="全身調整",
                price=5000,
                duration_minutes=60,
                first_visit_duration_minutes=90,
                resource=beds,
                sort_order=1,
            ),
            Service.objects.create(
                tenant=store, name="骨盤矯正", price=4500, duration_minutes=45, resource=beds, sort_order=2
            ),
            Service.objects.create(
                tenant=store, name="肩・首集中ケア", price=3500, duration_minutes=30, resource=beds, sort_order=3
            ),
        ]
        for service in services:
            service.staff.set(staff)
        password = os.environ.get("DEMO_USER_PASSWORD")
        if password:
            users = get_user_model().objects
            for email, role, member in (
                ("owner@fushimi.example", Role.OWNER, staff[0]),
                ("staff@fushimi.example", Role.STAFF, staff[1]),
            ):
                user = users.filter(username=email).first() or users.create_user(username=email, email=email)
                user.set_password(password)
                user.save()
                Membership.objects.create(tenant=store, user=user, role=role, staff=member)
        self.stdout.write("created")
