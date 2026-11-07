"""店舗利用者向けの予約API（ADMIN-01〜02、3章の権限表）。

`/api/v1/admin/tenants/{店舗名}/` 配下。ログインユーザーがその店舗に所属しているかをサーバーで判定する。
スタッフは自分が担当する予約だけを扱える。日時・担当の変更はオーナーのみ（ASSIGN-04）。
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import usable as billing_usable
from apps.core import google
from apps.stores.models import Membership, Role, Service, Staff
from apps.tenants.models import Tenant

from .admin_serializers import (
    AdminBookingSerializer,
    AdminCreateBookingSerializer,
    BookingEventSerializer,
    DateRangeSerializer,
    RescheduleSerializer,
)
from .availability import available_slots, store_tz
from .models import Booking, BookingStatus, Channel
from .serializers import AvailabilityQuerySerializer, PublicServiceSerializer, PublicStaffSerializer
from .services import BookingError, cancel_by_store, create_booking, reschedule_booking
from .tasks import queue_email


class TenantAdminView(APIView):
    permission_classes = [IsAuthenticated]
    # True なら、月額の支払いが済んでいなくても使える（お支払いの画面）
    allow_unpaid = False

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        tenant = Tenant.objects.filter(subdomain=kwargs["subdomain"], is_active=True).first()
        membership = (
            Membership.objects.filter(user=request.user, tenant=tenant, is_active=True).select_related("staff").first()
            if tenant
            else None
        )
        if membership is None:
            raise PermissionDenied("この店舗の管理権限がありません")
        if not self.allow_unpaid and not billing_usable(tenant):
            raise PermissionDenied("お支払いの登録が必要です", code="payment_required")
        self.tenant, self.membership = tenant, membership

    @property
    def is_owner(self) -> bool:
        return self.membership.role == Role.OWNER

    def handle_exception(self, exc):
        if isinstance(exc, BookingError):
            return Response({"code": exc.code, "message": exc.message}, status=exc.status)
        return super().handle_exception(exc)

    def bookings(self):
        qs = Booking.objects.for_tenant(self.tenant).select_related("service", "staff")
        if not self.is_owner:
            qs = qs.filter(staff_id=self.membership.staff_id) if self.membership.staff_id else qs.none()
        return qs

    def own_staff_or_403(self, staff: Staff | None) -> None:
        if not self.is_owner and (staff is None or staff.id != self.membership.staff_id):
            raise PermissionDenied("スタッフは自分の分だけ操作できます")

    def calendar_issues(self) -> list[dict]:
        """Googleカレンダーが未接続・接続切れで、予約枠に出ていない担当者。スタッフには自分の分だけ見せる。"""
        staff = Staff.objects.for_tenant(self.tenant).filter(is_active=True)
        if not self.is_owner:
            staff = staff.filter(pk=self.membership.staff_id)
        staff = list(staff)
        ok = google.calendar_owners(staff)
        return [{"staff_id": s.id, "name": s.display_name} for s in staff if s.id not in ok]

    def staff_or_404(self, staff_id) -> Staff:
        return get_object_or_404(Staff.objects.for_tenant(self.tenant), pk=staff_id, is_active=True)

    def day_bounds(self, day_from, day_to) -> tuple[datetime, datetime]:
        tz = store_tz(self.tenant)
        return datetime.combine(day_from, time.min, tz), datetime.combine(day_to + timedelta(days=1), time.min, tz)


class OptionsView(TenantAdminView):
    """フォームに使うサービスと担当者。"""

    def get(self, request, subdomain):
        services = Service.objects.for_tenant(self.tenant).filter(is_active=True)
        staff = Staff.objects.for_tenant(self.tenant).filter(is_active=True).prefetch_related("services")
        return Response(
            {
                "tenant": {"subdomain": self.tenant.subdomain, "name": self.tenant.name},
                "role": self.membership.role,
                "staff_id": self.membership.staff_id,
                "services": PublicServiceSerializer(services, many=True).data,
                "staff": PublicStaffSerializer(staff, many=True).data,
                "calendar_issues": self.calendar_issues(),
            }
        )


class BookingListView(TenantAdminView):
    def get(self, request, subdomain):
        q = DateRangeSerializer(data=request.query_params)
        q.is_valid(raise_exception=True)
        start, end = self.day_bounds(q.validated_data["date_from"], q.validated_data["date_to"])
        qs = self.bookings().filter(starts_at__gte=start, starts_at__lt=end).order_by("starts_at")
        if q.validated_data.get("status"):
            qs = qs.filter(status=q.validated_data["status"])
        else:
            qs = qs.filter(status__in=[BookingStatus.CONFIRMED, BookingStatus.HOLD])
        if q.validated_data.get("staff"):
            qs = qs.filter(staff_id=q.validated_data["staff"])
        return Response(AdminBookingSerializer(qs, many=True).data)

    def post(self, request, subdomain):
        """店舗が電話や来店で受けた予約を登録する。確定した状態で作る。"""
        data = AdminCreateBookingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        service = get_object_or_404(Service.objects.for_tenant(self.tenant), pk=v["service"], is_active=True)
        staff = self.staff_or_404(v["staff"])
        self.own_staff_or_403(staff)
        booking = create_booking(
            self.tenant,
            service=service,
            staff=staff,
            starts_at=v["starts_at"],
            customer_type=v["customer_type"],
            customer_name=v["customer_name"],
            customer_email=v["customer_email"],
            customer_phone=v["customer_phone"],
            note=v["note"],
            channel=Channel.ADMIN,
            confirm=True,
            actor=request.user,
        ).booking
        queue_email("confirmed", booking)
        return Response(AdminBookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class BookingDetailView(TenantAdminView):
    def get(self, request, subdomain, pk):
        booking = get_object_or_404(self.bookings(), pk=pk)
        body = AdminBookingSerializer(booking).data
        body["events"] = BookingEventSerializer(booking.events.select_related("actor"), many=True).data
        return Response(body)


class BookingCancelView(TenantAdminView):
    def post(self, request, subdomain, pk):
        booking = get_object_or_404(self.bookings(), pk=pk)
        before = booking.status
        booking = cancel_by_store(booking, request.user)
        if before != booking.status:
            queue_email("cancelled", booking)
        return Response(AdminBookingSerializer(booking).data)


class BookingRescheduleView(TenantAdminView):
    def post(self, request, subdomain, pk):
        if not self.is_owner:
            raise PermissionDenied("日時・担当の変更はオーナーのみ行えます")
        booking = get_object_or_404(self.bookings(), pk=pk)
        data = RescheduleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        staff = self.staff_or_404(data.validated_data["staff"])
        booking = reschedule_booking(
            booking, starts_at=data.validated_data["starts_at"], staff=staff, actor=request.user
        )
        queue_email("changed", booking)
        return Response(AdminBookingSerializer(booking).data)


class AdminAvailabilityView(TenantAdminView):
    """手入力・変更用の空き枠。受付の締切は適用しない。"""

    def get(self, request, subdomain):
        q = AvailabilityQuerySerializer(data=request.query_params)
        q.is_valid(raise_exception=True)
        service = get_object_or_404(Service.objects.for_tenant(self.tenant), pk=q.validated_data["service"])
        staff = self.staff_or_404(q.validated_data["staff"]) if q.validated_data.get("staff") else None
        exclude = request.query_params.get("exclude_booking")
        slots = available_slots(
            self.tenant,
            service,
            q.validated_data["date"],
            q.validated_data["customer_type"],
            staff,
            exclude_booking_id=int(exclude) if exclude and exclude.isdigit() else None,
            enforce_cutoff=False,
        )
        tz = store_tz(self.tenant)
        return Response({"slots": [{"starts_at": s.starts_at.astimezone(tz), "staff_ids": s.staff_ids} for s in slots]})
