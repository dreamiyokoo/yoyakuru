"use client";

import { useEffect, useState } from "react";
import { ApiError, confirmBooking, icsUrl } from "@/lib/api";
import { formatDateTime, googleCalendarUrl } from "@/lib/format";
import type { PublicBooking } from "@/lib/types";
import { ButtonLink } from "../ui/Button";
import { Notice, Summary } from "../ui/Notice";
import { Screen } from "../ui/Screen";

type State = { kind: "loading" } | { kind: "done"; booking: PublicBooking } | { kind: "expired" } | { kind: "error"; message: string };

/** 確認メールのリンクを開いたときの画面（06 完了 / 22 期限切れ）。店舗のサブドメインの /confirm で表示する。 */
export function ConfirmView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    const run = token
      ? confirmBooking(token)
      : Promise.reject(new ApiError(400, "missing_token", "リンクが正しくありません。メールのリンクをもう一度開いてください。"));
    run
      .then((booking) => active && setState({ kind: "done", booking }))
      .catch((e: unknown) => {
        if (!active) return;
        if (e instanceof ApiError && e.code === "hold_expired") setState({ kind: "expired" });
        else setState({ kind: "error", message: e instanceof ApiError ? e.message : "確認できませんでした" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state.kind === "loading") return <Screen title="ご予約の確認"><p className="text-sm text-sub">確認しています…</p></Screen>;

  if (state.kind === "expired") {
    return (
      <Screen title="ご予約の確認" footer={<ButtonLink href="/">もう一度予約する</ButtonLink>}>
        <h2 className="text-lg font-bold">確認の期限（15分）を過ぎました</h2>
        <p className="text-sm text-sub">枠は解放されました。お手数ですが、もう一度ご予約ください。</p>
      </Screen>
    );
  }

  if (state.kind === "error") {
    return (
      <Screen title="ご予約の確認" footer={<ButtonLink href="/">予約ページへ</ButtonLink>}>
        <Notice tone="warn">{state.message}</Notice>
      </Screen>
    );
  }

  const b = state.booking;
  const title = `${b.store_name} ${b.service_name}`;
  return (
    <Screen title="予約完了">
      <div className="flex flex-col items-center gap-2 py-4">
        <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-surface text-2xl font-bold text-accent">✓</span>
        <h2 className="text-lg font-bold">ご予約が確定しました</h2>
      </div>
      <Summary rows={[["日時", formatDateTime(b.starts_at)], ["メニュー", b.service_name], ["担当", b.staff_name]]} />
      <ButtonLink href={icsUrl(token)} variant="secondary">カレンダーに追加（予定ファイル）</ButtonLink>
      <ButtonLink href={googleCalendarUrl(title, b.starts_at, b.ends_at, `担当：${b.staff_name}`)} variant="secondary">
        Googleカレンダーに追加
      </ButtonLink>
      <p className="text-xs text-sub">
        予定ファイルには、前日と1時間前の通知が入っています。取消は確認メールのリンクから行えます（締切まで）。それ以降はお電話（{b.store_phone}）ください。
      </p>
    </Screen>
  );
}
