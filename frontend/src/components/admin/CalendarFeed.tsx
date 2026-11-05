"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi, type CalendarFeed as Feed } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { useLoad } from "./useLoad";

/** 自分の予約を、ふだん使うカレンダーアプリに表示するためのURL（CAL-06、07）。 */
export function CalendarFeed({ sub }: { sub: string }) {
  const { data, error } = useLoad(`${sub}|feed`, () => adminApi.calendarFeed(sub));
  const [feed, setFeed] = useState<Feed | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = feed ?? data;
  if (error) return <p className="text-xs text-sub">{error}</p>;
  if (!current) return null;
  const url = current.path ? `${window.location.origin}${current.path}` : "";

  const run = async (action: () => Promise<Feed>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      setFeed(await action());
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "操作できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="カレンダーアプリに表示" className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <h2 className="text-sm font-bold">カレンダーアプリに表示</h2>
      <p className="text-xs text-sub">
        自分の予約を、Googleカレンダーなどに読み取り専用で表示できます。内容は時間とメニュー
        {current.shows_customer_name ? "、お客様の名前" : ""}だけです。表示されるまでの間隔はアプリによって異なり、数時間かかることがあります。
      </p>
      {message ? <Notice>{message}</Notice> : null}
      {url ? (
        <>
          <input aria-label="カレンダーのURL" readOnly value={url} className="rounded-lg border border-line px-3 py-2 text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="secondary" disabled={busy} onClick={() => void navigator.clipboard?.writeText(url).then(() => setMessage("URLをコピーしました。"))}>
            URLをコピー
          </Button>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="min-h-11 text-sm text-sub underline" onClick={() => void run(() => adminApi.issueCalendarFeed(sub), "新しいURLを発行しました。古いURLは使えなくなりました。")}>
              URLを再発行
            </button>
            <button type="button" disabled={busy} className="min-h-11 text-sm text-danger underline" onClick={() => void run(() => adminApi.stopCalendarFeed(sub), "配信を止めました。")}>
              配信を止める
            </button>
          </div>
          <p className="text-xs text-sub">URLを知っている人は予約を見られます。共有しないでください。漏れたときは再発行してください。</p>
        </>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => adminApi.issueCalendarFeed(sub), "URLを発行しました。")}>
          URLを発行する
        </Button>
      )}
    </section>
  );
}
