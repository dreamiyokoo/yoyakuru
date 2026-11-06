from datetime import timedelta

from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.billing.models import usable_tenants_q
from apps.stores.models import Service, Staff
from apps.tenants.models import Tenant

from . import chat, emails
from .availability import available_slots, store_tz
from .ics import CalendarRenderer, build_feed, build_ics
from .models import Booking, BookingStatus, Channel
from .serializers import (
    AvailabilityQuerySerializer,
    ChatRequestSerializer,
    HoldRequestSerializer,
    PublicBookingSerializer,
    PublicServiceSerializer,
    PublicStaffSerializer,
    TokenSerializer,
)
from .services import BookingError, cancel_by_token, cancel_deadline, confirm_by_token, create_booking
from .tasks import queue_email


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


def _store(subdomain: str) -> Tenant:
    """停止中・存在しない店舗は404（TENANT-02）。"""
    # 支払いが済んでいない（セルフ登録の直後・解約後の）店舗は公開しない
    return get_object_or_404(Tenant.objects.filter(usable_tenants_q()), subdomain=subdomain, is_active=True)


class StoreView(PublicView):
    """公開予約ページ用の店舗情報（サービス・担当者を含む）。"""

    def get(self, request, subdomain):
        store = _store(subdomain)
        services = Service.objects.for_tenant(store).filter(is_active=True)
        staff = Staff.objects.for_tenant(store).filter(is_active=True).prefetch_related("services")
        return Response(
            {
                "subdomain": store.subdomain,
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
    def get(self, request, subdomain):
        store = _store(subdomain)
        q = AvailabilityQuerySerializer(data=request.query_params)
        q.is_valid(raise_exception=True)
        service = get_object_or_404(Service, pk=q.validated_data["service"], tenant=store, is_active=True)
        staff = None
        if q.validated_data.get("staff"):
            staff = get_object_or_404(Staff, pk=q.validated_data["staff"], tenant=store, is_active=True)
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

    def post(self, request, subdomain):
        store = _store(subdomain)
        data = HoldRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        service = get_object_or_404(Service, pk=v["service"], tenant=store, is_active=True)
        staff = get_object_or_404(Staff, pk=v["staff"], tenant=store, is_active=True) if v.get("staff") else None
        from_chat = bool(v.get("chat_token")) and chat.token_is_valid(store, v["chat_token"])
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
            # 自由入力をAIが処理した会話からの予約は、利用量の対象（USAGE-01）
            channel=Channel.CHAT if from_chat else Channel.WEB,
            ai_assisted=from_chat,
        )
        if not result.replayed:
            queue_email("hold", result.booking)
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
            queue_email("confirmed", booking)
        return Response(PublicBookingSerializer(booking).data)


class BookingByTokenView(PublicView):
    throttle_scope = "public_token"

    def get(self, request, token):
        booking = get_object_or_404(Booking.objects.select_related("tenant", "service", "staff"), token=token)
        body = PublicBookingSerializer(booking).data
        body["cancel_deadline"] = cancel_deadline(booking)
        return Response(body)


class CancelView(PublicView):
    throttle_scope = "public_token"

    def post(self, request, token):
        before = Booking.objects.filter(token=token).values_list("status", flat=True).first()
        booking = cancel_by_token(token)
        if before != booking.status:
            queue_email("cancelled", booking)
        return Response(PublicBookingSerializer(booking).data)


class IcsView(PublicView):
    """確定した予約の予定ファイル（REMIND-01「カレンダーに追加」）。"""

    throttle_scope = "public_token"
    renderer_classes = [JSONRenderer, CalendarRenderer]

    def get(self, request, token):
        booking = get_object_or_404(Booking.objects.select_related("tenant", "service", "staff"), token=token)
        if booking.status != BookingStatus.CONFIRMED:
            raise Http404
        body = build_ics(booking, cancel_url=emails.booking_page_url(booking, "cancel"))
        response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="yoyaku.ics"'
        return response


REPLY_MAX = 500  # 会話の履歴として送り返せる長さ（ChatTurnSerializer）にそろえる
UNAVAILABLE = "自由入力のご質問には、いまお答えできません。選択肢からご予約いただくか、お店にお問い合わせください。"


class ChatView(PublicView):
    """自由入力の質問・予約の希望を受ける（CHAT-03〜07）。予約の確定は通常の画面で行う。"""

    throttle_scope = "public_chat"

    def post(self, request, subdomain):
        store = _store(subdomain)
        data = ChatRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        now = timezone.now()
        today = now.astimezone(store_tz(store)).date()
        provider = chat.get_provider()
        if provider is None or not chat.take_quota(store, today):
            return Response({"reply": UNAVAILABLE, "handoff": True, "phone": store.phone, "suggestion": None})
        messages = [*v["history"], {"role": "user", "content": v["message"]}]
        try:
            answer = provider.answer(chat.system_prompt(chat.store_facts(store, today)), messages)
        except chat.ChatUnavailable:
            return Response({"reply": UNAVAILABLE, "handoff": True, "phone": store.phone, "suggestion": None})
        suggestion = chat.validate(store, answer, v["context"], now)
        return Response(
            {
                "reply": answer.reply[:REPLY_MAX],
                "handoff": answer.handoff,
                "phone": store.phone,
                "suggestion": None if suggestion.empty() else suggestion.__dict__,
                "chat_token": chat.issue_token(store),
            }
        )


class StaffFeedView(PublicView):
    """担当者ごとの読み取り専用カレンダー（CAL-06）。URLのトークンだけで認証する。"""

    throttle_scope = "public_token"
    renderer_classes = [JSONRenderer, CalendarRenderer]

    def get(self, request, token):
        staff = (
            Staff.objects.filter(
                usable_tenants_q("tenant__"), calendar_token=token, is_active=True, tenant__is_active=True
            )
            .select_related("tenant")
            .first()
        )
        if not token or staff is None:
            raise Http404
        since = timezone.now() - timedelta(days=30)
        bookings = (
            Booking.objects.for_tenant(staff.tenant)
            .filter(staff=staff, status=BookingStatus.CONFIRMED, ends_at__gte=since)
            .select_related("service")
            .order_by("starts_at")
        )
        body = build_feed(staff, bookings, show_customer_name=staff.tenant.calendar_shows_customer_name)
        response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
        response["Cache-Control"] = "private, max-age=300"
        return response
