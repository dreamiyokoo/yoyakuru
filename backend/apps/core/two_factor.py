"""二段階認証の処理（コードの検証、回復コード、設定用のQRコード）。"""

from __future__ import annotations

import io
import secrets
import time

import pyotp
import segno
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from apps.stores.models import Membership, Role

from .models import TwoFactor

ISSUER = "ヨヤクル"
STEP = 30
RECOVERY_COUNT = 8


def required_for(user) -> bool:
    """オーナーとして所属している利用者は、二段階認証が必須（LOGIN-07）。"""
    return Membership.objects.filter(user=user, role=Role.OWNER, is_active=True).exists()


def enabled_for(user) -> bool:
    tf = TwoFactor.objects.filter(user=user).first()
    return bool(tf and tf.enabled)


def start_setup(user) -> tuple[TwoFactor, str, str]:
    """新しい秘密の値を作る（まだ有効にしない）。認証アプリに登録するURIとQRコード（SVG）を返す。"""
    tf, _ = TwoFactor.objects.get_or_create(user=user, defaults={"secret": pyotp.random_base32()})
    if not tf.enabled:
        tf.secret = pyotp.random_base32()
        tf.save(update_fields=["secret"])
    uri = pyotp.TOTP(tf.secret).provisioning_uri(name=user.email, issuer_name=ISSUER)
    # 画面は data URL の画像として表示するので、名前空間（xmlns）付きの完全なSVGにする。
    # svg_inline は xmlns を省くため、ブラウザが画像として読めず、QRコードが表示されなかった
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=4, border=2, xmldecl=False, svgns=True)
    svg = buf.getvalue().decode()
    return tf, uri, svg


def _verify_totp(tf: TwoFactor, code: str) -> bool:
    """前後1ステップ（±30秒）を許す。一度使ったステップ以前のコードは受け付けない。"""
    code = code.strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return False
    totp = pyotp.TOTP(tf.secret)
    now = int(time.time())
    for offset in (-1, 0, 1):
        step = now // STEP + offset
        if step > tf.last_used_step and secrets.compare_digest(totp.at(step * STEP), code):
            tf.last_used_step = step
            tf.save(update_fields=["last_used_step"])
            return True
    return False


def _use_recovery_code(tf: TwoFactor, code: str) -> bool:
    code = code.strip().replace("-", "").lower()
    for hashed in tf.recovery_codes:
        if check_password(code, hashed):
            tf.recovery_codes = [h for h in tf.recovery_codes if h != hashed]
            tf.save(update_fields=["recovery_codes"])
            return True
    return False


def verify(user, code: str) -> bool:
    """行をロックしてから確かめ、使ったコードを消す。同時の要求で同じコードが二度通ることを防ぐ。"""
    with transaction.atomic():
        tf = TwoFactor.objects.select_for_update().filter(user=user, confirmed_at__isnull=False).first()
        if tf is None:
            return False
        return _verify_totp(tf, code) or _use_recovery_code(tf, code)


def confirm(user, code: str) -> list[str] | None:
    """認証アプリのコードで設定を完了し、回復コードを発行する（表示は1回だけ）。"""
    with transaction.atomic():
        tf = TwoFactor.objects.select_for_update().filter(user=user).first()
        if tf is None or tf.enabled or not _verify_totp(tf, code):
            return None
        return _finish_setup(tf)


def _finish_setup(tf: TwoFactor) -> list[str]:
    codes = [secrets.token_hex(5) for _ in range(RECOVERY_COUNT)]
    tf.recovery_codes = [make_password(c) for c in codes]
    tf.confirmed_at = timezone.now()
    tf.save(update_fields=["recovery_codes", "confirmed_at"])
    return [f"{c[:5]}-{c[5:]}" for c in codes]


def regenerate_recovery_codes(user, code: str) -> list[str] | None:
    """今のコード（認証アプリか回復コード）で本人を確かめ、回復コードを作り直す。古いものは使えなくなる。"""
    with transaction.atomic():
        tf = TwoFactor.objects.select_for_update().filter(user=user, confirmed_at__isnull=False).first()
        if tf is None or not (_verify_totp(tf, code) or _use_recovery_code(tf, code)):
            return None
        return _finish_setup(tf)


def reset(user) -> bool:
    """二段階認証を外す。次のログインで、オーナーは設定し直す（端末の紛失など）。"""
    deleted, _ = TwoFactor.objects.filter(user=user).delete()
    return deleted > 0


def reset_with_code(user, code: str) -> bool:
    """本人が、今のコード（回復コードを含む）で確かめてから外す。新しい端末に登録し直すため。"""
    if not verify(user, code):
        return False
    return reset(user)
