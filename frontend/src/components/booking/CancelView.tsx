"use client";

import { useEffect, useState } from "react";
import { ApiError, cancelBooking, fetchBooking } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { PublicBooking } from "@/lib/types";
import { Button, ButtonLink } from "../ui/Button";
import { Notice, Summary } from "../ui/Notice";
import { Screen } from "../ui/Screen";

/** 予約の取消（21）。締切後は店舗の電話番号を案内する。 */
export function CancelView({ token, now = () => new Date() }: { token: string; now?: () => Date }) {
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBooking(token)
      .then((b) => active && setBooking(b))
      .catch((e: unknown) => active && setError(e instanceof ApiError ? e.message : "予約を読み込めませんでした"));
    return () => {
      active = false;
    };
  }, [token]);

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      setBooking(await cancelBooking(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "取消できませんでした");
    } finally {
      setBusy(false);
    }
  };

  if (!booking) {
    return (
      <Screen title="予約の取消" footer={error ? <ButtonLink href="/">予約ページへ</ButtonLink> : undefined}>
        {error ? <Notice tone="warn">{error}</Notice> : <p className="text-sm text-sub">読み込み中…</p>}
      </Screen>
    );
  }

  const rows: [string, string][] = [
    ["日時", formatDateTime(booking.starts_at)],
    ["メニュー", booking.service_name],
    ["担当", booking.staff_name],
    ["お名前", booking.customer_name],
  ];

  if (booking.status === "cancelled") {
    return (
      <Screen title="予約の取消" footer={<ButtonLink href="/" variant="secondary">予約ページへ</ButtonLink>}>
        <h2 className="text-lg font-bold">ご予約を取消しました</h2>
        <Summary rows={rows} />
        <p className="text-sm text-sub">日時を変える場合は、予約ページからもう一度ご予約ください。</p>
      </Screen>
    );
  }

  const deadline = booking.cancel_deadline ? new Date(booking.cancel_deadline) : null;
  const passed = deadline !== null && now() >= deadline;
  const cancellable = booking.status === "confirmed" || booking.status === "hold";

  return (
    <Screen
      title="予約の取消"
      footer={
        cancellable && !passed ? (
          <>
            <Button disabled={busy} onClick={cancel}>{busy ? "取消しています…" : "予約を取消する"}</Button>
            <ButtonLink href="/" variant="secondary">取消しない</ButtonLink>
          </>
        ) : undefined
      }
    >
      <h2 className="font-bold">次のご予約を取消しますか？</h2>
      <Summary rows={rows} />
      {deadline ? <p className="text-sm font-bold">取消の締切：{formatDateTime(new Date(deadline.getTime() - 60_000).toISOString())}まで</p> : null}
      {passed ? (
        <Notice tone="warn">取消の締切を過ぎています。お手数ですが、お電話（{booking.store_phone}）でご連絡ください。</Notice>
      ) : (
        <p className="text-xs text-sub">取消すと、枠はすぐに解放されます。日時の変更は、取消してから予約し直してください。</p>
      )}
      {!cancellable ? <Notice tone="warn">この予約は取消できません。</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </Screen>
  );
}
