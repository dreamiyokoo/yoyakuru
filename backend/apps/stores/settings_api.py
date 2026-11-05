"""店舗の設定API（ADMIN-02、3章の権限表：設定はオーナーのみ）。

`/api/v1/admin/tenants/{店舗名}/settings/` 配下。変更は `?dry_run=1` を付けると保存せずに、
変更によって空き判定から外れる既存の予約（影響を受ける予約）だけを返す（TIME-07、画面33）。
保存した場合も、影響を受ける予約を返す。既存の予約は自動で取消さない。
"""

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.bookings.admin_api import TenantAdminView
from apps.bookings.admin_serializers import AdminBookingSerializer
from apps.bookings.availability import available_slots, peak_resource_usage, store_tz
from apps.bookings.models import Booking
from apps.tenants.models import Tenant

from .models import BusinessHours, DateOverride, RecurringBreak, Resource, Service, ShiftException, Staff, WeeklyShift


def affected_bookings(tenant: Tenant, now) -> list[Booking]:
    """今後の予約のうち、今の設定では受け付けられないもの。"""
    out = []
    active = list(
        Booking.objects.blocking(now).filter(tenant=tenant, occupied_until__gt=now).select_related("service", "staff")
    )
    quantities = dict(Resource.objects.for_tenant(tenant).values_list("id", "quantity"))
    for b in active:
        if b.starts_at < now:
            continue
        day = b.starts_at.astimezone(store_tz(tenant)).date()
        slots = available_slots(
            tenant,
            b.service,
            day,
            b.customer_type,
            b.staff,
            now,
            b.party_size,
            exclude_booking_id=b.id,
            enforce_cutoff=False,
        )
        fits = any(s.starts_at == b.starts_at for s in slots)
        # 空き判定はグループへの参加なら設備を数えないため、設備の数は既存の予約全体で直接確かめる
        if fits and b.resource_id:
            used = peak_resource_usage(active, b.resource_id, b.occupied_from, b.occupied_until)
            fits = used <= quantities.get(b.resource_id, 0)
        if not fits:
            out.append(b)
    return out


class SettingsView(TenantAdminView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not self.is_owner:
            raise PermissionDenied("設定の変更はオーナーのみ行えます")

    def apply(self, request, change, status_code=status.HTTP_200_OK):
        """変更を適用し、新たに影響を受ける予約を返す。dry_run=1 なら保存しない。"""
        dry_run = request.query_params.get("dry_run") == "1"
        now = timezone.now()
        with transaction.atomic():
            Tenant.objects.select_for_update().get(pk=self.tenant.pk)
            before = {b.id for b in affected_bookings(self.tenant, now)}
            result = change()
            self.tenant.refresh_from_db()
            affected = [b for b in affected_bookings(self.tenant, now) if b.id not in before]
            if dry_run:
                transaction.set_rollback(True)
        return Response(
            {
                "applied": not dry_run,
                "result": result,
                "affected_bookings": AdminBookingSerializer(affected, many=True).data,
            },
            status=status.HTTP_200_OK if dry_run else status_code,
        )

    def staff_of_tenant(self, pk) -> Staff:
        return get_object_or_404(Staff.objects.for_tenant(self.tenant), pk=pk)


# ---- 予約ルール・店舗情報


class StoreSerializer(serializers.ModelSerializer):
    slot_interval_minutes = serializers.ChoiceField(choices=[15, 30, 60])
    booking_window_days = serializers.IntegerField(min_value=1, max_value=365)
    same_day_cutoff_minutes = serializers.IntegerField(min_value=0, max_value=10080)
    cancel_deadline_days = serializers.IntegerField(min_value=0, max_value=30)
    default_buffer_minutes = serializers.IntegerField(min_value=0, max_value=120)

    class Meta:
        model = Tenant
        fields = [
            "name",
            "phone",
            "address",
            "slot_interval_minutes",
            "booking_window_days",
            "same_day_cutoff_minutes",
            "cancel_deadline_days",
            "default_buffer_minutes",
        ]


class StoreSettingsView(SettingsView):
    def get(self, request, subdomain):
        return Response(StoreSerializer(self.tenant).data)

    def put(self, request, subdomain):
        data = StoreSerializer(self.tenant, data=request.data)
        data.is_valid(raise_exception=True)
        return self.apply(request, lambda: StoreSerializer(data.save()).data)


# ---- 営業時間


class HoursItem(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    opens_at = serializers.TimeField()
    closes_at = serializers.TimeField()

    def validate(self, attrs):
        if attrs["closes_at"] <= attrs["opens_at"]:
            raise serializers.ValidationError("終了は開始より後にしてください")
        return attrs


def hours_payload(tenant):
    return [
        {"weekday": h.weekday, "opens_at": h.opens_at, "closes_at": h.closes_at}
        for h in BusinessHours.objects.for_tenant(tenant).order_by("weekday")
    ]


class BusinessHoursView(SettingsView):
    """曜日ごとの営業時間。送らなかった曜日は定休日になる。"""

    def get(self, request, subdomain):
        return Response(serializers.ListSerializer(child=HoursItem()).to_representation(hours_payload(self.tenant)))

    def put(self, request, subdomain):
        data = HoursItem(data=request.data, many=True)
        data.is_valid(raise_exception=True)
        weekdays = [d["weekday"] for d in data.validated_data]
        if len(weekdays) != len(set(weekdays)):
            raise serializers.ValidationError("同じ曜日が重複しています")

        def change():
            BusinessHours.objects.for_tenant(self.tenant).delete()
            BusinessHours.objects.bulk_create(BusinessHours(tenant=self.tenant, **d) for d in data.validated_data)
            return serializers.ListSerializer(child=HoursItem()).to_representation(hours_payload(self.tenant))

        return self.apply(request, change)


# ---- 定例の休憩


class BreakSerializer(serializers.ModelSerializer):
    staff = serializers.IntegerField(source="staff_id", allow_null=True, required=False)

    class Meta:
        model = RecurringBreak
        fields = ["id", "staff", "weekday", "starts_at", "ends_at"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        if attrs["ends_at"] <= attrs["starts_at"]:
            raise serializers.ValidationError("終了は開始より後にしてください")
        return attrs


class BreakListView(SettingsView):
    def get(self, request, subdomain):
        return Response(BreakSerializer(RecurringBreak.objects.for_tenant(self.tenant), many=True).data)

    def post(self, request, subdomain):
        data = BreakSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        staff_id = data.validated_data.pop("staff_id", None)
        staff = self.staff_of_tenant(staff_id) if staff_id else None
        return self.apply(
            request,
            lambda: (
                BreakSerializer(
                    RecurringBreak.objects.create(tenant=self.tenant, staff=staff, **data.validated_data)
                ).data
            ),
            status.HTTP_201_CREATED,
        )


class BreakDetailView(SettingsView):
    def delete(self, request, subdomain, pk):
        item = get_object_or_404(RecurringBreak.objects.for_tenant(self.tenant), pk=pk)
        return self.apply(request, lambda: item.delete() and None)


# ---- 臨時休業・特別営業


class DateOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = DateOverride
        fields = ["id", "date", "is_closed", "opens_at", "closes_at", "note"]
        read_only_fields = ["id"]
        validators: list = []  # 同じ日付は上書きする

    def validate(self, attrs):
        if not attrs.get("is_closed", True):
            if not (attrs.get("opens_at") and attrs.get("closes_at")):
                raise serializers.ValidationError("特別営業は開始と終了を入れてください")
            if attrs["closes_at"] <= attrs["opens_at"]:
                raise serializers.ValidationError("終了は開始より後にしてください")
        return attrs


class DateOverrideListView(SettingsView):
    def get(self, request, subdomain):
        qs = DateOverride.objects.for_tenant(self.tenant).order_by("date")
        if request.query_params.get("from"):
            qs = qs.filter(date__gte=request.query_params["from"])
        return Response(DateOverrideSerializer(qs, many=True).data)

    def post(self, request, subdomain):
        data = DateOverrideSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        if v.get("is_closed", True):
            v["opens_at"] = v["closes_at"] = None

        def change():
            item, _ = DateOverride.objects.update_or_create(tenant=self.tenant, date=v.pop("date"), defaults=v)
            return DateOverrideSerializer(item).data

        return self.apply(request, change, status.HTTP_201_CREATED)


class DateOverrideDetailView(SettingsView):
    def delete(self, request, subdomain, pk):
        item = get_object_or_404(DateOverride.objects.for_tenant(self.tenant), pk=pk)
        return self.apply(request, lambda: item.delete() and None)


# ---- 設備


class ResourceSerializer(serializers.ModelSerializer):
    quantity = serializers.IntegerField(min_value=1, max_value=99)

    class Meta:
        model = Resource
        fields = ["id", "name", "quantity"]
        read_only_fields = ["id"]


class ResourceListView(SettingsView):
    def get(self, request, subdomain):
        return Response(ResourceSerializer(Resource.objects.for_tenant(self.tenant), many=True).data)

    def post(self, request, subdomain):
        data = ResourceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return self.apply(
            request, lambda: ResourceSerializer(data.save(tenant=self.tenant)).data, status.HTTP_201_CREATED
        )


class ResourceDetailView(SettingsView):
    def patch(self, request, subdomain, pk):
        item = get_object_or_404(Resource.objects.for_tenant(self.tenant), pk=pk)
        data = ResourceSerializer(item, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        return self.apply(request, lambda: ResourceSerializer(data.save()).data)


# ---- サービス


class ServiceSettingsSerializer(serializers.ModelSerializer):
    staff = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True)
    resource = serializers.IntegerField(source="resource_id", allow_null=True, required=False)
    duration_minutes = serializers.IntegerField(min_value=5, max_value=600)
    first_visit_duration_minutes = serializers.IntegerField(min_value=5, max_value=600, allow_null=True, required=False)
    capacity = serializers.IntegerField(min_value=1, max_value=100, required=False)

    class Meta:
        model = Service
        fields = [
            "id",
            "name",
            "category",
            "description",
            "price",
            "duration_minutes",
            "first_visit_duration_minutes",
            "buffer_before_minutes",
            "buffer_after_minutes",
            "staff",
            "resource",
            "resource_quantity",
            "capacity",
            "is_active",
            "sort_order",
        ]
        read_only_fields = ["id"]

    def to_representation(self, instance):
        body = super().to_representation(instance)
        body["staff"] = sorted(s.id for s in instance.staff.all())
        return body


class ServiceWriteMixin:
    def save_service(self, data: ServiceSettingsSerializer, instance: Service | None = None) -> dict:
        v = dict(data.validated_data)
        staff_ids = v.pop("staff", None)
        if "resource_id" in v:
            rid = v.pop("resource_id")
            v["resource"] = get_object_or_404(Resource.objects.for_tenant(self.tenant), pk=rid) if rid else None
        if instance is None:
            instance = Service.objects.create(tenant=self.tenant, **v)
        else:
            for key, value in v.items():
                setattr(instance, key, value)
            instance.save()
        if staff_ids is not None:
            instance.staff.set([self.staff_of_tenant(pk) for pk in staff_ids])
        return ServiceSettingsSerializer(instance).data


class ServiceListView(ServiceWriteMixin, SettingsView):
    def get(self, request, subdomain):
        qs = Service.objects.for_tenant(self.tenant).prefetch_related("staff")
        return Response(ServiceSettingsSerializer(qs, many=True).data)

    def post(self, request, subdomain):
        data = ServiceSettingsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return self.apply(request, lambda: self.save_service(data), status.HTTP_201_CREATED)


class ServiceDetailView(ServiceWriteMixin, SettingsView):
    """削除はせず、非公開（is_active=false）にする。既存の予約が参照しているため。"""

    def patch(self, request, subdomain, pk):
        item = get_object_or_404(Service.objects.for_tenant(self.tenant), pk=pk)
        data = ServiceSettingsSerializer(item, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        return self.apply(request, lambda: self.save_service(data, item))


# ---- 担当者・勤務


class StaffSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = ["id", "display_name", "title", "priority", "is_active"]
        read_only_fields = ["id"]


class StaffListView(SettingsView):
    def get(self, request, subdomain):
        return Response(StaffSettingsSerializer(Staff.objects.for_tenant(self.tenant), many=True).data)

    def post(self, request, subdomain):
        data = StaffSettingsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return self.apply(
            request, lambda: StaffSettingsSerializer(data.save(tenant=self.tenant)).data, status.HTTP_201_CREATED
        )


class StaffDetailView(SettingsView):
    """担当者の停止（is_active=false）は、担当している今後の予約を影響として返す（ADMIN-03）。"""

    def patch(self, request, subdomain, pk):
        item = self.staff_of_tenant(pk)
        data = StaffSettingsSerializer(item, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        return self.apply(request, lambda: StaffSettingsSerializer(data.save()).data)


class StaffOrderView(SettingsView):
    """指名なしの割当の優先順位（ASSIGN-01）。上から1, 2, 3…にする。"""

    def post(self, request, subdomain):
        ids = serializers.ListField(child=serializers.IntegerField()).run_validation(request.data.get("ids"))
        members = [self.staff_of_tenant(pk) for pk in ids]

        def change():
            for i, member in enumerate(members, start=1):
                member.priority = i
                member.save(update_fields=["priority"])
            return StaffSettingsSerializer(Staff.objects.for_tenant(self.tenant), many=True).data

        return self.apply(request, change)


class ShiftItem(HoursItem):
    starts_at = serializers.TimeField()
    ends_at = serializers.TimeField()
    opens_at = None
    closes_at = None

    def validate(self, attrs):
        if attrs["ends_at"] <= attrs["starts_at"]:
            raise serializers.ValidationError("終了は開始より後にしてください")
        return attrs


class ShiftExceptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShiftException
        fields = ["id", "date", "is_off", "starts_at", "ends_at"]
        read_only_fields = ["id"]
        validators: list = []

    def validate(self, attrs):
        if not attrs.get("is_off", False):
            if not (attrs.get("starts_at") and attrs.get("ends_at")):
                raise serializers.ValidationError("勤務する場合は開始と終了を入れてください")
            if attrs["ends_at"] <= attrs["starts_at"]:
                raise serializers.ValidationError("終了は開始より後にしてください")
        return attrs


def shifts_payload(staff: Staff) -> dict:
    return {
        "weekly": [
            {"weekday": s.weekday, "starts_at": s.starts_at, "ends_at": s.ends_at}
            for s in staff.weekly_shifts.order_by("weekday")
        ],
        "exceptions": ShiftExceptionSerializer(staff.shift_exceptions.order_by("date"), many=True).data,
    }


class StaffShiftView(SettingsView):
    """28 勤務シフト。週の定例は丸ごと置き換える（送らなかった曜日は休み）。"""

    def get(self, request, subdomain, pk):
        return Response(shifts_payload(self.staff_of_tenant(pk)))

    def put(self, request, subdomain, pk):
        staff = self.staff_of_tenant(pk)
        data = ShiftItem(data=request.data, many=True)
        data.is_valid(raise_exception=True)
        weekdays = [d["weekday"] for d in data.validated_data]
        if len(weekdays) != len(set(weekdays)):
            raise serializers.ValidationError("同じ曜日が重複しています")

        def change():
            staff.weekly_shifts.all().delete()
            WeeklyShift.objects.bulk_create(
                WeeklyShift(tenant=self.tenant, staff=staff, **d) for d in data.validated_data
            )
            return shifts_payload(staff)

        return self.apply(request, change)


class StaffExceptionListView(SettingsView):
    def post(self, request, subdomain, pk):
        staff = self.staff_of_tenant(pk)
        data = ShiftExceptionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        if v.get("is_off"):
            v["starts_at"] = v["ends_at"] = None

        def change():
            item, _ = ShiftException.objects.update_or_create(
                tenant=self.tenant, staff=staff, date=v.pop("date"), defaults=v
            )
            return ShiftExceptionSerializer(item).data

        return self.apply(request, change, status.HTTP_201_CREATED)


class StaffExceptionDetailView(SettingsView):
    def delete(self, request, subdomain, pk, eid):
        item = get_object_or_404(ShiftException.objects.for_tenant(self.tenant), pk=eid, staff_id=pk)
        return self.apply(request, lambda: item.delete() and None)
