"use client";

import Link from "next/link";
import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { addDays, formatDateKey, formatTime, toDateKey } from "@/lib/format";
import { Chip } from "../ui/Choice";
import { Notice } from "../ui/Notice";
import { AdminShell, CHANNEL_LABEL, StatusBadge } from "./AdminShell";
import { useLoad } from "./useLoad";

type Range = "today" | "tomorrow" | "week";

/** 25 予約一覧。 */
export function BookingListPage({ today = toDateKey(new Date()) }: { today?: string }) {
  const [range, setRange] = useState<Range>("today");
  const [from, to] = range === "today" ? [today, today] : range === "tomorrow" ? [addDays(today, 1), addDays(today, 1)] : [today, addDays(today, 6)];
  return (
    <AdminShell
      title="予約"
      action={
        <Link href="/bookings/new" className="min-h-11 rounded-md bg-button px-3 py-2 text-sm font-bold text-white">
          ＋ 追加
        </Link>
      }
    >
      {(sub) => <List sub={sub} from={from} to={to} range={range} setRange={setRange} />}
    </AdminShell>
  );
}

function List({ sub, from, to, range, setRange }: { sub: string; from: string; to: string; range: Range; setRange: (r: Range) => void }) {
  const { data, error, loading } = useLoad(`${sub}|${from}|${to}`, () => adminApi.bookings(sub, from, to));
  return (
    <>
      <div role="radiogroup" aria-label="期間" className="flex gap-2">
        <Chip selected={range === "today"} onSelect={() => setRange("today")}>今日</Chip>
        <Chip selected={range === "tomorrow"} onSelect={() => setRange("tomorrow")}>明日</Chip>
        <Chip selected={range === "week"} onSelect={() => setRange("week")}>今週</Chip>
      </div>
      {loading ? <p className="text-sm text-sub">読み込み中…</p> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {data && data.length === 0 ? <p className="text-sm text-sub">この期間の予約はありません。</p> : null}
      <ul className="flex flex-col gap-2">
        {data?.map((b) => (
          <li key={b.id}>
            <Link href={`/bookings/${b.id}`} className="block rounded-xl border border-line px-4 py-3 hover:bg-surface">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">
                  {range === "week" ? `${formatDateKey(toDateKey(new Date(b.starts_at)))} ` : ""}
                  {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                </span>
                <StatusBadge status={b.status} />
              </span>
              <span className="mt-1 block font-bold">{b.customer_name}</span>
              <span className="block text-xs text-sub">
                {b.service_name} ／ {b.staff_name} ／ {CHANNEL_LABEL[b.channel]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
