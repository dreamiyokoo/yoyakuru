from rest_framework import serializers

from apps.stores.models import Service, Staff

from .models import Booking, CustomerType


class PublicServiceSerializer(serializers.ModelSerializer):
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
            "capacity",
        ]


class PublicStaffSerializer(serializers.ModelSerializer):
    service_ids = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = ["id", "display_name", "title", "service_ids"]

    def get_service_ids(self, obj):
        return sorted(s.id for s in obj.services.all() if s.is_active)


class AvailabilityQuerySerializer(serializers.Serializer):
    service = serializers.IntegerField()
    date = serializers.DateField()
    customer_type = serializers.ChoiceField(choices=CustomerType.choices, default=CustomerType.REPEAT)
    staff = serializers.IntegerField(required=False)
    party_size = serializers.IntegerField(required=False, min_value=1, max_value=20, default=1)


class HoldRequestSerializer(serializers.Serializer):
    service = serializers.IntegerField()
    staff = serializers.IntegerField(required=False, allow_null=True)
    starts_at = serializers.DateTimeField()
    customer_type = serializers.ChoiceField(choices=CustomerType.choices, default=CustomerType.REPEAT)
    customer_name = serializers.CharField(max_length=100)
    customer_email = serializers.EmailField()
    customer_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    party_size = serializers.IntegerField(required=False, min_value=1, max_value=20, default=1)
    idempotency_key = serializers.CharField(max_length=64, required=False, allow_blank=True)


class TokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=64)


class PublicBookingSerializer(serializers.ModelSerializer):
    """お客様に見せる予約の内容。管理用のIDや他の予約の情報は含めない（WEB-02）。"""

    service_name = serializers.CharField(source="service.name")
    staff_name = serializers.CharField(source="staff.display_name")
    store_name = serializers.CharField(source="tenant.name")
    store_phone = serializers.CharField(source="tenant.phone")

    class Meta:
        model = Booking
        fields = [
            "status",
            "starts_at",
            "ends_at",
            "hold_expires_at",
            "service_name",
            "staff_name",
            "store_name",
            "store_phone",
            "customer_name",
            "auto_assigned",
        ]
