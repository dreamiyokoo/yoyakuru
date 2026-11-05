"use client";

import Link from "next/link";
import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { addDays, formatDateKey, toDateKey } from "@/lib/format";
import { Notice } from "../ui/Notice";
import { AdminShell, STATUS_LABEL } from "./AdminShell";
import { CalendarFeed } from "./CalendarFeed";
import { useLoad } from "./useLoad";

const START_HOUR = 9;
const END_HOUR = 21;
const HOUR_PX = 56;

const VISIBLE_MINUTES = (END_HOUR - START_HOUR) * 60;

/** 表示している日（日本時間）の表示開始からの分。日をまたぐ予定でも、その日の範囲に切り詰める。 */
export function minutesOnDay(iso: string, date: string): number {
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  const minutes = (Date.parse(iso) - dayStart) / 60_000 - START_HOUR * 60;
  return Math.min(Math.max(minutes, 0), VISIBLE_MINUTES);
}

function Block({ date, from, to, className, children, label }: { date: string; from: string; to: string; className: string; children: React.ReactNode; label: string }) {
  const start = minutesOnDay(from, date);
  const end = minutesOnDay(to, date);
  if (end <= start) return null; // 表示している時間帯にかからない
  const top = start * (HOUR_PX / 60);
  const height = Math.max(18, (end - start) * (HOUR_PX / 60) - 2);
  return (
    <div aria-label={label} className={`absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-0.5 text-xs ${className}`} style={{ top, height }}>
      {children}
    </div>
  );
}

/** 08 カレンダー（日表示・スタッフ別の列）。状態は色と文字の両方で示す（CAL-03）。 */
export function CalendarPage({ today = toDateKey(new Date()) }: { today?: string }) {
  const [date, setDate] = useState(today);
  return (
    <AdminShell title={formatDateKey(date)}>
      {(sub) => <Day sub={sub} date={date} setDate={setDate} today={today} />}
    </AdminShell>
  );
}

function Day({ sub, date, setDate, today }: { sub: string; date: string; setDate: (d: string) => void; today: string }) {
  const { data, error, loading } = useLoad(`${sub}|${date}`, () => adminApi.calendar(sub, date));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  return (
    <>
      <div className="flex items-center justify-between">
        <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => setDate(addDays(date, -1))}>
          ‹ 前日
        </button>
        <button type="button" className="min-h-11 px-3 text-sm text-sub" onClick={() => setDate(today)}>
          今日
        </button>
        <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => setDate(addDays(date, 1))}>
          翌日 ›
        </button>
      </div>
      {loading ? <p className="text-sm text-sub">読み込み中…</p> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {data ? (
        <div className="flex overflow-x-auto">
          <div className="w-10 shrink-0 pt-7">
            {hours.map((h) => (
              <div key={h} className="text-[10px] text-sub" style={{ height: HOUR_PX }}>
                {h}:00
              </div>
            ))}
          </div>
          {data.staff.map((s) => (
            <section key={s.id} aria-label={s.display_name} className="min-w-24 flex-1 border-l border-line">
              <h2 className="h-7 text-center text-xs font-bold">{s.display_name}</h2>
              <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <div key={h} className="border-t border-line" style={{ height: HOUR_PX }} />
                ))}
                {data.breaks
                  .filter((b) => b.staff === null || b.staff === s.id)
                  .map((b, i) => (
                    <Block key={`b${i}`} date={date} from={b.starts_at} to={b.ends_at} className="bg-muted text-sub" label="休憩">
                      休憩
                    </Block>
                  ))}
                {data.time_offs
                  .filter((t) => t.staff === null || t.staff === s.id)
                  .map((t) => (
                    <Block key={`t${t.id}`} date={date} from={t.starts_at} to={t.ends_at} className="border border-dashed border-sub bg-muted text-sub" label="予約不可">
                      予約不可
                    </Block>
                  ))}
                {data.bookings
                  .filter((b) => b.staff === s.id)
                  .map((b) => (
                    <Block
                      key={b.id}
                      date={date}
                      from={b.starts_at}
                      to={b.ends_at}
                      label={`${b.customer_name} ${STATUS_LABEL[b.status]}`}
                      className={b.status === "confirmed" ? "border border-button bg-surface text-ink" : "border border-dashed border-ink bg-card text-ink"}
                    >
                      <Link href={`/bookings/${b.id}`} className="block font-bold">
                        {b.service_name}
                        <br />
                        {b.customer_name}
                      </Link>
                      <span>{STATUS_LABEL[b.status]}</span>
                    </Block>
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-sub">状態は色と文字で表示します（確定／仮押さえ／休憩／予約不可）。</p>
      <CalendarFeed sub={sub} />
    </>
  );
}
