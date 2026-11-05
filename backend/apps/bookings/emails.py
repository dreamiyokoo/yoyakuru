"""お客様へのメール（CUST-02〜03、REMIND-01〜04）。"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import EmailMessage

from .availability import store_tz
from .ics import build_ics
from .models import Booking


def booking_page_url(booking: Booking, path: str) -> str:
    base = settings.PUBLIC_BOOKING_URL_TEMPLATE.format(subdomain=booking.tenant.subdomain)
    return f"{base}/{path}?token={booking.token}"


def _when(booking: Booking) -> str:
    local = booking.starts_at.astimezone(store_tz(booking.tenant))
    weekday = "月火水木金土日"[local.weekday()]
    return f"{local:%m月%d日}（{weekday}）{local:%H:%M}"


def _summary(booking: Booking) -> str:
    return (
        f"日時：{_when(booking)}\n"
        f"メニュー：{booking.service.name}\n"
        f"担当：{booking.staff.display_name}\n"
        f"お名前：{booking.customer_name} 様\n"
    )


def send_hold_email(booking: Booking) -> None:
    if not booking.customer_email:
        return
    body = (
        f"{booking.customer_name} 様\n\n{booking.tenant.name}のご予約を仮押さえしました。\n"
        "15分以内に次のリンクを開くと、予約が確定します。\n\n"
        f"{booking_page_url(booking, 'confirm')}\n\n{_summary(booking)}"
    )
    EmailMessage(f"【{booking.tenant.name}】ご予約の確認", body, to=[booking.customer_email]).send()


def send_confirmed_email(booking: Booking) -> None:
    if not booking.customer_email:
        return
    cancel_url = booking_page_url(booking, "cancel")
    body = (
        f"{booking.customer_name} 様\n\nご予約が確定しました。\n\n{_summary(booking)}\n"
        "添付の予定ファイルを開くと、カレンダーに追加できます。\n"
        f"取消はこちら（締切まで）：{cancel_url}\n"
    )
    msg = EmailMessage(f"【{booking.tenant.name}】ご予約が確定しました", body, to=[booking.customer_email])
    msg.attach("yoyaku.ics", build_ics(booking, cancel_url=cancel_url), "text/calendar")
    msg.send()


def send_cancelled_email(booking: Booking) -> None:
    if not booking.customer_email:
        return
    cancel_url = booking_page_url(booking, "cancel")
    body = f"{booking.customer_name} 様\n\n次のご予約を取消しました。\n\n{_summary(booking)}"
    msg = EmailMessage(f"【{booking.tenant.name}】ご予約を取消しました", body, to=[booking.customer_email])
    msg.attach("yoyaku.ics", build_ics(booking, cancel_url=cancel_url, cancelled=True, sequence=1), "text/calendar")
    msg.send()
