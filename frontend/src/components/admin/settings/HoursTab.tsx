"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatDateKey, toDateKey } from "@/lib/format";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { useLoad } from "../useLoad";
import { TimeSelect, WEEKDAYS, hm, inputClass, useSettingChange } from "./useSettingChange";

interface Hours {
  weekday: number;
  opens_at: string;
  closes_at: string;
}
interface Break {
  id: number;
  staff: number | null;
  weekday: number | null;
  starts_at: string;
  ends_at: string;
}
interface Override {
  id: number;
  date: string;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
  note: string;
}

/** 29 営業時間・休憩・臨時休業（TIME-02、BREAK-01）。 */
export function HoursTab({ sub, staff, today = toDateKey(new Date()) }: { sub: string; staff: { id: number; display_name: string }[]; today?: string }) {
  const hours = useLoad(`${sub}|hours`, () => adminApi.setting<Hours[]>(sub, "hours"));
  const breaks = useLoad(`${sub}|breaks`, () => adminApi.setting<Break[]>(sub, "breaks"));
  const overrides = useLoad(`${sub}|overrides`, () => adminApi.setting<Override[]>(sub, `date-overrides?from=${today}`));
  const { change, busy, ui } = useSettingChange(sub);
  if (!hours.data || !breaks.data || !overrides.data) return <p className="text-sm text-sub">読み込み中…</p>;
  const staffName = (id: number | null) => (id === null ? "全員" : (staff.find((s) => s.id === id)?.display_name ?? ""));

  return (
    <>
      {ui}
      <WeekEditor initial={hours.data} busy={busy} onSave={(rows) => void change("hours", "PUT", rows, hours.reload)} />
      <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">定例の休憩</h2>
        <ul className="text-sm">
          {breaks.data.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-1">
              <span>
                {staffName(b.staff)}・{b.weekday === null ? "毎日" : `${WEEKDAYS[b.weekday]}曜`} {hm(b.starts_at)}〜{hm(b.ends_at)}
              </span>
              <button type="button" className="min-h-11 px-2 text-danger" onClick={() => void change(`breaks/${b.id}`, "DELETE", undefined, breaks.reload)}>
                削除
              </button>
            </li>
          ))}
        </ul>
        <NewBreak staff={staff} busy={busy} onAdd={(body) => void change("breaks", "POST", body, breaks.reload)} />
      </section>
      <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">臨時休業・特別営業</h2>
        <ul className="text-sm">
          {overrides.data.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-1">
              <span>
                {formatDateKey(o.date)} {o.is_closed ? "休業" : `営業 ${hm(o.opens_at ?? "")}〜${hm(o.closes_at ?? "")}`}
                {o.note ? `（${o.note}）` : ""}
              </span>
              <button type="button" className="min-h-11 px-2 text-danger" onClick={() => void change(`date-overrides/${o.id}`, "DELETE", undefined, overrides.reload)}>
                削除
              </button>
            </li>
          ))}
        </ul>
        <NewOverride today={today} busy={busy} onAdd={(body) => void change("date-overrides", "POST", body, overrides.reload)} />
        <p className="text-xs text-sub">祝日に営業するかも、日付ごとにここで設定します。</p>
      </section>
    </>
  );
}

function WeekEditor({ initial, busy, onSave }: { initial: Hours[]; busy: boolean; onSave: (rows: Hours[]) => void }) {
  const [rows, setRows] = useState(() =>
    WEEKDAYS.map((_, d) => {
      const h = initial.find((x) => x.weekday === d);
      return { weekday: d, open: Boolean(h), opens_at: hm(h?.opens_at ?? "10:00"), closes_at: hm(h?.closes_at ?? "20:00") };
    }),
  );
  const update = (d: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r) => (r.weekday === d ? { ...r, ...patch } : r)));
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <h2 className="text-sm font-bold">営業時間（曜日ごと）</h2>
      {rows.map((r) => (
        <div key={r.weekday} className="flex items-center gap-2">
          <label className="flex w-16 items-center gap-1 text-sm font-bold">
            <input type="checkbox" checked={r.open} onChange={(e) => update(r.weekday, { open: e.target.checked })} />
            {WEEKDAYS[r.weekday]}
          </label>
          {r.open ? (
            <>
              <TimeSelect label={`${WEEKDAYS[r.weekday]}曜の開始`} value={r.opens_at} onChange={(v) => update(r.weekday, { opens_at: v })} />
              〜
              <TimeSelect label={`${WEEKDAYS[r.weekday]}曜の終了`} value={r.closes_at} onChange={(v) => update(r.weekday, { closes_at: v })} />
            </>
          ) : (
            <span className="text-sm text-sub">定休日</span>
          )}
        </div>
      ))}
      <Button disabled={busy} onClick={() => onSave(rows.filter((r) => r.open).map(({ weekday, opens_at, closes_at }) => ({ weekday, opens_at, closes_at })))}>
        営業時間を保存する
      </Button>
    </section>
  );
}

function NewBreak({ staff, busy, onAdd }: { staff: { id: number; display_name: string }[]; busy: boolean; onAdd: (body: unknown) => void }) {
  const [who, setWho] = useState("all");
  const [day, setDay] = useState("every");
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("14:00");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="休憩の対象" className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="all">全員</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.display_name}
          </option>
        ))}
      </select>
      <select aria-label="休憩の曜日" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)}>
        <option value="every">毎日</option>
        {WEEKDAYS.map((w, i) => (
          <option key={w} value={i}>
            {w}曜
          </option>
        ))}
      </select>
      <TimeSelect label="休憩の開始" value={from} onChange={setFrom} />〜<TimeSelect label="休憩の終了" value={to} onChange={setTo} />
      <Button variant="secondary" disabled={busy} onClick={() => onAdd({ staff: who === "all" ? null : Number(who), weekday: day === "every" ? null : Number(day), starts_at: from, ends_at: to })}>
        休憩を追加
      </Button>
    </div>
  );
}

function NewOverride({ today, busy, onAdd }: { today: string; busy: boolean; onAdd: (body: unknown) => void }) {
  const [date, setDate] = useState(today);
  const [closed, setClosed] = useState(true);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("17:00");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <input aria-label="日付" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      <select aria-label="休業か営業か" className={inputClass} value={closed ? "closed" : "open"} onChange={(e) => setClosed(e.target.value === "closed")}>
        <option value="closed">休業</option>
        <option value="open">特別営業（時間を指定）</option>
      </select>
      {!closed ? (
        <div className="flex items-center gap-2">
          <TimeSelect label="特別営業の開始" value={from} onChange={setFrom} />〜<TimeSelect label="特別営業の終了" value={to} onChange={setTo} />
        </div>
      ) : null}
      <Field label="メモ（任意）" value={note} onChange={setNote} />
      <Button variant="secondary" disabled={busy} onClick={() => onAdd({ date, is_closed: closed, opens_at: closed ? null : from, closes_at: closed ? null : to, note })}>
        臨時休業・特別営業を追加
      </Button>
    </div>
  );
}
