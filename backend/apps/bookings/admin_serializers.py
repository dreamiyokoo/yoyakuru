from rest_framework import serializers

from .models import Booking, BookingEvent, CustomerType


class AdminBookingSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source="service.name")
    staff_name = serializers.CharField(source="staff.display_name")

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "starts_at",
            "ends_at",
            "hold_expires_at",
            "service",
            "service_name",
            "staff",
            "staff_name",
            "customer_type",
            "customer_name",
            "customer_email",
            "customer_phone",
            "note",
            "channel",
            "auto_assigned",
            "party_size",
            "created_at",
        ]


class BookingEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = BookingEvent
        fields = ["action", "channel", "actor_name", "created_at"]

    def get_actor_name(self, obj):
        return obj.actor.get_full_name() or obj.actor.get_username() if obj.actor else ""


class AdminCreateBookingSerializer(serializers.Serializer):
    service = serializers.IntegerField()
    staff = serializers.IntegerField()
    starts_at = serializers.DateTimeField()
    customer_type = serializers.ChoiceField(choices=CustomerType.choices, default=CustomerType.REPEAT)
    customer_name = serializers.CharField(max_length=100)
    customer_email = serializers.EmailField(required=False, allow_blank=True, default="")
    customer_phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class RescheduleSerializer(serializers.Serializer):
    starts_at = serializers.DateTimeField()
    staff = serializers.IntegerField()


class DateRangeSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    status = serializers.CharField(required=False)
    staff = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if attrs["date_to"] < attrs["date_from"]:
            raise serializers.ValidationError("期間の指定が正しくありません")
        if (attrs["date_to"] - attrs["date_from"]).days > 62:
            raise serializers.ValidationError("期間は62日以内で指定してください")
        return attrs
