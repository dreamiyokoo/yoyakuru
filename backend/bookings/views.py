from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from stores.models import Service, Staff, Store

from . import emails
from .availability import available_slots, store_tz
from .models import Booking, Channel
from .serializers import (
    AvailabilityQuerySerializer,
    HoldRequestSerializer,
    PublicBookingSerializer,
    PublicServiceSerializer,
    PublicStaffSerializer,
    TokenSerializer,
)
from .services import BookingError, cancel_by_token, cancel_deadline, confirm_by_token, create_booking


class PublicView(APIView):
    """お客様向けAPI。ログインは不要で、店舗の境界はURLの店舗名で決める。"""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_read"

    def handle_exception(self, exc):
        if isinstance(exc, BookingError):
            return Response({"code": exc.code, "message": exc.message}, status=exc.status)
        return super().handle_exception(exc)


def _store(slug: str) -> Store:
    return get_object_or_404(Store, slug=slug, is_active=True)


class StoreView(PublicView):
    def get(self, request, slug):
        store = _store(slug)
        services = store.services.filter(is_active=True)
        staff = store.staff.filter(is_active=True).prefetch_related("services")
        return Response(
            {
                "slug": store.slug,
                "name": store.name,
                "phone": store.phone,
                "address": store.address,
                "slot_interval_minutes": store.slot_interval_minutes,
                "booking_window_days": store.booking_window_days,
                "services": PublicServiceSerializer(services, many=True).data,
                "staff": PublicStaffSerializer(staff, many=True).data,
            }
        )


class AvailabilityView(PublicView):
    def get(self, request, slug):
        store = _store(slug)
        q = AvailabilityQuerySerializer(data=request.query_params)
        q.is_valid(raise_exception=True)
        service = get_object_or_404(Service, pk=q.validated_data["service"], store=store, is_active=True)
        staff = None
        if q.validated_data.get("staff"):
            staff = get_object_or_404(Staff, pk=q.validated_data["staff"], store=store, is_active=True)
        slots = available_slots(
            store,
            service,
            q.validated_data["date"],
            q.validated_data["customer_type"],
            staff,
            party_size=q.validated_data["party_size"],
        )
        tz = store_tz(store)
        return Response(
            {
                "date": q.validated_data["date"],
                "slots": [
                    {
                        "starts_at": s.starts_at.astimezone(tz),
                        "ends_at": s.ends_at.astimezone(tz),
                        "staff_ids": s.staff_ids,
                    }
                    for s in slots
                ],
            }
        )


class HoldView(PublicView):
    throttle_scope = "public_hold"

    def post(self, request, slug):
        store = _store(slug)
        data = HoldRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        service = get_object_or_404(Service, pk=v["service"], store=store, is_active=True)
        staff = get_object_or_404(Staff, pk=v["staff"], store=store, is_active=True) if v.get("staff") else None
        result = create_booking(
            store,
            service=service,
            staff=staff,
            starts_at=v["starts_at"],
            customer_type=v["customer_type"],
            customer_name=v["customer_name"],
            customer_email=v["customer_email"],
            customer_phone=v["customer_phone"],
            note=v["note"],
            party_size=v["party_size"],
            idempotency_key=v.get("idempotency_key") or None,
            channel=Channel.WEB,
        )
        if not result.replayed:
            emails.send_hold_email(result.booking)
        code = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
        return Response(PublicBookingSerializer(result.booking).data, status=code)


class ConfirmView(PublicView):
    throttle_scope = "public_token"

    def post(self, request):
        data = TokenSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        before = Booking.objects.filter(token=data.validated_data["token"]).values_list("status", flat=True).first()
        booking = confirm_by_token(data.validated_data["token"])
        if before != booking.status:
            emails.send_confirmed_email(booking)
        return Response(PublicBookingSerializer(booking).data)


class BookingByTokenView(PublicView):
    throttle_scope = "public_token"

    def get(self, request, token):
        booking = get_object_or_404(Booking.objects.select_related("store", "service", "staff"), token=token)
        body = PublicBookingSerializer(booking).data
        body["cancel_deadline"] = cancel_deadline(booking)
        return Response(body)


class CancelView(PublicView):
    throttle_scope = "public_token"

    def post(self, request, token):
        before = Booking.objects.filter(token=token).values_list("status", flat=True).first()
        booking = cancel_by_token(token)
        if before != booking.status:
            emails.send_cancelled_email(booking)
        return Response(PublicBookingSerializer(booking).data)
