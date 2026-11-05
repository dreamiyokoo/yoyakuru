"""店舗利用者向けの予約API（ADMIN-01〜02、3章の権限表）。

`/api/v1/admin/tenants/{店舗名}/` 配下。ログインユーザーがその店舗に所属しているかをサーバーで判定する。
スタッフは自分が担当する予約と自分の休みだけを扱える。日時・担当の変更はオーナーのみ（ASSIGN-04）。
"""

from __future__ import annotations

import secrets
from datetime import datetime, time, timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.stores.models import Membership, RecurringBreak, Role, Service, Staff, TimeOff
from apps.tenants.models import Tenant

from . import emails
from .admin_serializers import (
    AdminBookingSerializer,
    AdminCreateBookingSerializer,
    BookingEventSerializer,
    DateRangeSerializer,
    RescheduleSerializer,
    TimeOffSerializer,
)
from .availability import available_slots, overlaps, store_tz
from .models import Booking, BookingStatus, Channel
from .serializers import AvailabilityQuerySerializer, PublicServiceSerializer, PublicStaffSerializer
from .services import BookingError, cancel_by_store, create_booking, reschedule_booking


class TenantAdminView(APIView):
    permission_classes = [IsAuthenticated]

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
        emails.send_confirmed_email(booking)
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
            emails.send_cancelled_email(booking)
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
        emails.send_changed_email(booking)
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


class CalendarView(TenantAdminView):
    """日表示のカレンダー（CAL-01）。スタッフは自分の列だけを見る。"""

    def get(self, request, subdomain):
        q = DateRangeSerializer(
            data={"date_from": request.query_params.get("date"), "date_to": request.query_params.get("date")}
        )
        q.is_valid(raise_exception=True)
        day = q.validated_data["date_from"]
        start, end = self.day_bounds(day, day)
        staff = Staff.objects.for_tenant(self.tenant).filter(is_active=True)
        if not self.is_owner:
            staff = staff.filter(pk=self.membership.staff_id)
        tz = store_tz(self.tenant)
        breaks = [
            {
                "staff": b.staff_id,
                "starts_at": datetime.combine(day, b.starts_at, tz),
                "ends_at": datetime.combine(day, b.ends_at, tz),
            }
            for b in RecurringBreak.objects.for_tenant(self.tenant)
            if b.weekday in (None, day.weekday())
        ]
        time_offs = TimeOff.objects.for_tenant(self.tenant).filter(starts_at__lt=end, ends_at__gt=start)
        if not self.is_owner:
            # スタッフには、ほかの人の休み（理由を含む）を見せない。店舗全体の予約不可は見せる
            time_offs = time_offs.filter(Q(staff__isnull=True) | Q(staff_id=self.membership.staff_id))
        bookings = self.bookings().filter(
            starts_at__lt=end, ends_at__gt=start, status__in=[BookingStatus.CONFIRMED, BookingStatus.HOLD]
        )
        return Response(
            {
                "date": day,
                "staff": [{"id": s.id, "display_name": s.display_name} for s in staff],
                "bookings": AdminBookingSerializer(bookings.order_by("starts_at"), many=True).data,
                "breaks": breaks,
                "time_offs": TimeOffSerializer(time_offs, many=True).data,
            }
        )


class TimeOffListView(TenantAdminView):
    """休み・予約不可時間（BREAK-02、27）。スタッフは自分の分だけ。"""

    def get(self, request, subdomain):
        qs = TimeOff.objects.for_tenant(self.tenant).select_related("staff").order_by("starts_at")
        if not self.is_owner:
            qs = qs.filter(staff_id=self.membership.staff_id)
        start = request.query_params.get("from")
        if start:
            qs = qs.filter(ends_at__gte=start)
        return Response(TimeOffSerializer(qs[:200], many=True).data)

    def post(self, request, subdomain):
        data = TimeOffSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        staff_id = data.validated_data.get("staff").id if data.validated_data.get("staff") else None
        staff = self.staff_or_404(staff_id) if staff_id else None
        self.own_staff_or_403(staff)
        time_off = data.save(tenant=self.tenant, staff=staff)
        affected = [
            b
            for b in Booking.objects.blocking().filter(tenant=self.tenant).select_related("service", "staff")
            if (staff is None or b.staff_id == staff.id)
            and overlaps(b.occupied_from, b.occupied_until, time_off.starts_at, time_off.ends_at)
        ]
        body = TimeOffSerializer(time_off).data
        # 既存の予約は自動で取消さない（TIME-07）。影響を受ける予約を返して確認してもらう
        body["affected_bookings"] = AdminBookingSerializer(affected, many=True).data
        return Response(body, status=status.HTTP_201_CREATED)


class TimeOffDetailView(TenantAdminView):
    def delete(self, request, subdomain, pk):
        time_off = get_object_or_404(TimeOff.objects.for_tenant(self.tenant), pk=pk)
        self.own_staff_or_403(time_off.staff)
        time_off.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CalendarFeedView(TenantAdminView):
    """自分（ログインしている担当者）のカレンダー配信URLの確認・発行・停止（CAL-06）。"""

    def _staff(self) -> Staff:
        if not self.membership.staff_id:
            raise PermissionDenied("担当者として登録されていないため、カレンダー配信はありません")
        return self.membership.staff

    def _body(self, staff: Staff) -> dict:
        token = staff.calendar_token
        return {
            "path": f"/api/v1/public/calendar/{token}.ics" if token else None,
            "shows_customer_name": self.tenant.calendar_shows_customer_name,
        }

    def get(self, request, subdomain):
        return Response(self._body(self._staff()))

    def post(self, request, subdomain):
        """発行・再発行。再発行すると古いURLは使えなくなる。"""
        staff = self._staff()
        staff.calendar_token = secrets.token_urlsafe(32)
        staff.save(update_fields=["calendar_token"])
        return Response(self._body(staff))

    def delete(self, request, subdomain):
        staff = self._staff()
        staff.calendar_token = None
        staff.save(update_fields=["calendar_token"])
        return Response(self._body(staff))
