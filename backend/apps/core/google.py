"""Googleカレンダーとの連携（TimeRex型）。

各スタッフは本人のGoogleアカウントでログインし、そのときカレンダーの権限も一緒に許可する。
トークンは django-allauth（SocialToken）に保存する。

- 空き判定：本人のカレンダーの予定（ヨヤクルが書いた予定を除く）を、勤務時間から差し引く
- 予約の確定・変更・取消：担当スタッフのカレンダーへ予定を書き込む（予定のIDは予約ごとに固定し、冪等にする）
- 接続切れ（取消された・権限がない）：トークンを消し、そのスタッフの枠を出さず、本人とオーナーにメールで知らせる
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import requests
from allauth.socialaccount.models import SocialToken
from django.conf import settings
from django.core.cache import cache
from django.core.mail import EmailMessage
from django.utils import timezone

log = logging.getLogger(__name__)

PROVIDER = "google"
# 予定の閲覧と書き込みだけ。これ1つで、予定の読み取りも書き込みもできる
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
API = "https://www.googleapis.com/calendar/v3/calendars/primary"
TOKEN_URL = "https://oauth2.googleapis.com/token"
TIMEOUT = 8
BUSY_CACHE_SECONDS = 60  # 通話中の空き確認でGoogleを呼びすぎない。確定時だけ最新を取り直す
# ヨヤクルが書いた予定の目印。空き判定ではこの予定を数えない（予約はDBのほうで数えるため）
MARK = "yoyakuru"

Interval = tuple[datetime, datetime]


class Disconnected(Exception):  # noqa: N818
    """接続が切れている（取消された・権限がない・未接続）。"""


class Unavailable(Exception):  # noqa: N818
    """Googleに一時的につながらない。接続は生きているので、やり直せる。"""


# ---- 接続の有無


def _tokens(user_ids: Sequence[int]) -> set[int]:
    rows = SocialToken.objects.filter(account__provider=PROVIDER, account__user_id__in=user_ids).exclude(
        token_secret=""
    )
    return set(rows.values_list("account__user_id", flat=True))


def connected(user) -> bool:
    """更新用のトークンがあり、いつでも使える状態か。"""
    return user.pk in _tokens([user.pk])


def calendar_owners(staff: Sequence) -> dict[int, object]:
    """担当者ID → 接続済みのGoogleアカウントを持つユーザー。未接続の担当者は含めない。"""
    from apps.stores.models import Membership

    memberships = Membership.objects.filter(staff__in=staff, is_active=True, user__is_active=True).select_related(
        "user"
    )
    by_staff = {m.staff_id: m.user for m in memberships}
    ok = _tokens([u.pk for u in by_staff.values()])
    return {sid: user for sid, user in by_staff.items() if user.pk in ok}


# ---- 認証


def _app() -> dict:
    return settings.SOCIALACCOUNT_PROVIDERS[PROVIDER]["APP"]


class _FakeResponse:
    """E2E用：Googleの代わりに、予定がない空のカレンダーを返す。"""

    def __init__(self, status_code: int, body: dict):
        self.status_code, self._body = status_code, body

    def json(self) -> dict:
        return self._body


def _send(method: str, url: str, **kwargs) -> requests.Response:
    """HTTPの送信。テストではここを差し替える。"""
    if settings.GOOGLE_FAKE:
        return _FakeResponse(
            204 if method == "DELETE" else 200, {"items": [], "access_token": "e2e", "expires_in": 3600}
        )
    try:
        return requests.request(method, url, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as e:
        raise Unavailable(str(e)) from e


def _token(user) -> SocialToken:
    token = (
        SocialToken.objects.filter(account__provider=PROVIDER, account__user=user)
        .exclude(token_secret="")
        .order_by("-id")
        .first()
    )
    if token is None:
        raise Disconnected("Googleカレンダーが接続されていません")
    return token


def _refresh(token: SocialToken, user) -> None:
    app = _app()
    res = _send(
        "POST",
        TOKEN_URL,
        data={
            "client_id": app["client_id"],
            "client_secret": app["secret"],
            "refresh_token": token.token_secret,
            "grant_type": "refresh_token",
        },
    )
    if res.status_code == 400 and res.json().get("error") == "invalid_grant":
        disconnect(user)
        raise Disconnected("Googleの接続が取り消されました")
    if res.status_code != 200:
        raise Unavailable(f"token refresh failed: {res.status_code}")
    body = res.json()
    token.token = body["access_token"]
    token.expires_at = timezone.now() + timedelta(seconds=int(body.get("expires_in", 3600)))
    token.save(update_fields=["token", "expires_at"])


def access_token(user) -> str:
    token = _token(user)
    if token.expires_at is None or token.expires_at <= timezone.now() + timedelta(seconds=60):
        _refresh(token, user)
    return token.token


def _call(user, method: str, path: str, *, ok: Sequence[int] = (200,), **kwargs) -> requests.Response:
    """認証つきでカレンダーAPIを呼ぶ。期限切れなら1度だけ更新してやり直す。"""
    for attempt in (0, 1):
        res = _send(method, f"{API}{path}", headers={"Authorization": f"Bearer {access_token(user)}"}, **kwargs)
        if res.status_code == 401 and attempt == 0:
            _refresh(_token(user), user)
            continue
        break
    if res.status_code in ok:
        return res
    if res.status_code in (401, 403):
        # 権限がない（カレンダーの許可を外した等）。つなぎ直してもらう
        disconnect(user)
        raise Disconnected("Googleカレンダーの権限がありません")
    raise Unavailable(f"calendar api {method} {path}: {res.status_code}")


def verify_calendar(user) -> None:
    """ログイン直後に、カレンダーの権限が許可されているか確かめる。"""
    _call(user, "GET", "/events", params={"maxResults": 1, "fields": "items(id)"})


def disconnect(user) -> None:
    """接続を切り、本人とオーナーに知らせる。トークンを消すので、知らせるのは1度だけになる。"""
    deleted, _ = SocialToken.objects.filter(account__provider=PROVIDER, account__user=user).delete()
    if deleted:
        notify_disconnected(user)


def notify_disconnected(user) -> None:
    from apps.stores.models import Membership, Role

    mine = Membership.objects.filter(user=user, is_active=True, staff__isnull=False).select_related("tenant")
    name = user.get_full_name() or user.email
    for m in mine:
        owners = Membership.objects.filter(tenant=m.tenant, role=Role.OWNER, is_active=True).select_related("user")
        to = sorted({user.email, *(o.user.email for o in owners)} - {""})
        body = (
            f"{m.tenant.name}の{name}さんのGoogleカレンダーとの接続が切れました。\n"
            f"つなぎ直すまで、{name}さんの予約枠は公開ページに出ません。\n\n"
            f"{name}さんが、次のページからGoogleでログインし直してください。\n{settings.ADMIN_APP_URL}/login\n"
        )
        try:
            EmailMessage(f"【{m.tenant.name}】Googleカレンダーの接続が切れました", body, to=to).send()
        except Exception:  # noqa: BLE001  知らせの失敗で、予約の処理は止めない
            log.exception("could not notify calendar disconnection of user %s", user.pk)


# ---- 空き判定：予定の読み取り


def _parse(value: dict, tz: ZoneInfo) -> datetime:
    if "dateTime" in value:
        return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
    # 終日の予定。店舗の時刻で、その日の0時から（終了は日付の0時まで）
    day = datetime.fromisoformat(value["date"]).date()
    return datetime.combine(day, time.min, tz)


def _busy(event: dict, tz: ZoneInfo) -> Interval | None:
    if event.get("status") == "cancelled" or event.get("transparency") == "transparent":
        return None
    if event.get("extendedProperties", {}).get("private", {}).get(MARK):
        return None
    if any(a.get("self") and a.get("responseStatus") == "declined" for a in event.get("attendees", [])):
        return None
    return _parse(event["start"], tz), _parse(event["end"], tz)


def busy_intervals(user, start: datetime, end: datetime, tz: ZoneInfo, fresh: bool = False) -> list[Interval]:
    """本人のカレンダーで予定が入っている時間（ヨヤクルが書いた予定を除く）。短時間はキャッシュを使う。"""
    key = f"gcal:busy:{user.pk}:{start.isoformat()}:{end.isoformat()}"
    if not fresh and (hit := cache.get(key)) is not None:
        return hit
    params = {
        "timeMin": start.isoformat(),
        "timeMax": end.isoformat(),
        "singleEvents": "true",
        "maxResults": 250,
        "fields": "nextPageToken,items(status,transparency,start,end,attendees(self,responseStatus),"
        "extendedProperties/private)",
    }
    busy: list[Interval] = []
    for _ in range(4):  # 1日の予定が1000件を超えることは想定しない
        body = _call(user, "GET", "/events", params=params).json()
        busy += [b for e in body.get("items", []) if (b := _busy(e, tz))]
        if not (page := body.get("nextPageToken")):
            break
        params = {**params, "pageToken": page}
    cache.set(key, busy, BUSY_CACHE_SECONDS)
    return busy


# ---- 予約の書き込み


def event_id(booking_id: int) -> str:
    """予約ごとに固定の予定ID（Googleが許す英数字のみ）。同じ予約を何度書いても1件になる。"""
    return f"{MARK}{booking_id:x}"


def upsert_event(user, booking_id: int, body: dict) -> None:
    eid = event_id(booking_id)
    full = {**body, "id": eid, "status": "confirmed"}
    res = _call(user, "POST", "/events", ok=(200, 409), json=full)
    if res.status_code == 409:  # すでにある（再送・変更・取消後の復活）
        _call(user, "PUT", f"/events/{eid}", json=full)


def delete_event(user, booking_id: int) -> None:
    _call(user, "DELETE", f"/events/{event_id(booking_id)}", ok=(200, 204, 404, 410))
