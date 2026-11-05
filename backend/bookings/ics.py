"""予約をカレンダーに登録する予定ファイル（iCalendar）を作る（REMIND-01〜04）。"""

from __future__ import annotations

from datetime import UTC, datetime

from .models import Booking


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", r"\;").replace(",", "\\,").replace("\n", "\\n")


def _utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _fold(line: str) -> str:
    """75オクテットを超える行を折り返す（RFC 5545）。"""
    out, current = [], b""
    for ch in line:
        b = ch.encode()
        if len(current) + len(b) > 74:
            out.append(current.decode())
            current = b" "
        current += b
    out.append(current.decode())
    return "\r\n".join(out)


def build_ics(booking: Booking, *, cancel_url: str, cancelled: bool = False, sequence: int = 0) -> str:
    store = booking.store
    summary = f"{store.name} {booking.service.name}"
    description = f"担当：{booking.staff.display_name}\n取消はこちら（締切まで）：{cancel_url}"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//yoyakuru//booking//JA",
        f"METHOD:{'CANCEL' if cancelled else 'PUBLISH'}",
        "BEGIN:VEVENT",
        f"UID:booking-{booking.pk}@yoyakuru",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_utc(datetime.now(UTC))}",
        f"DTSTART:{_utc(booking.starts_at)}",
        f"DTEND:{_utc(booking.ends_at)}",
        f"SUMMARY:{_escape(summary)}",
        f"DESCRIPTION:{_escape(description)}",
        f"LOCATION:{_escape(store.address)}",
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
    ]
    if not cancelled:
        for trigger in ("-P1D", "-PT1H"):
            lines += [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{_escape(summary)}",
                f"TRIGGER:{trigger}",
                "END:VALARM",
            ]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
