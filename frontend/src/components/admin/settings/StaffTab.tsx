"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { formatDateKey, toDateKey } from "@/lib/format";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { useLoad } from "../useLoad";
import { TimeSelect, WEEKDAYS, hm, inputClass, useSettingChange } from "./useSettingChange";

export interface StaffSetting {
  id: number;
  display_name: string;
  title: string;
  priority: number;
  is_active: boolean;
}
interface Shift {
  weekday: number;
  starts_at: string;
  ends_at: string;
}
interface ShiftException {
  id: number;
  date: string;
  is_off: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

/** 31 担当者（指名なしの割当順・停止）と、28 勤務シフト（週の定例と日ごとの例外）。 */
export function StaffTab({ sub, onChanged, today = toDateKey(new Date()) }: { sub: string; onChanged?: () => void; today?: string }) {
  const list = useLoad(`${sub}|staff`, () => adminApi.setting<StaffSetting[]>(sub, "staff"));
  const [selected, setSelected] = useState<StaffSetting | null>(null);
  const [name, setName] = useState("");
  const { change, busy, ui } = useSettingChange(sub);
  if (list.error) return <p className="text-sm text-danger">{list.error}</p>;
  if (!list.data) return <p className="text-sm text-sub">読み込み中…</p>;
  if (selected) return <ShiftEditor sub={sub} staff={selected} today={today} onBack={() => setSelected(null)} />;

  const sorted = [...list.data].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const reload = () => {
    list.reload();
    onChanged?.();
  };
  const move = (i: number, d: number) => {
    const ids = sorted.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void change("staff/order", "POST", { ids }, reload);
  };

  return (
    <>
      {ui}
      <p className="text-xs text-sub">指名なしの予約は、上の人から順に空いている人へ割り当てます。</p>
      <ol className="flex flex-col gap-2">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <span className="w-5 text-center font-bold">{i + 1}</span>
            <span className="flex-1">
              <span className="font-bold">{s.display_name}</span>
              {s.is_active ? "" : "（停止中）"}
              {s.title ? <span className="block text-sub">{s.title}</span> : null}
            </span>
            <button type="button" aria-label={`${s.display_name}を上へ`} disabled={busy || i === 0} className="min-h-11 min-w-11 rounded-md border border-line disabled:opacity-40" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" aria-label={`${s.display_name}を下へ`} disabled={busy || i === sorted.length - 1} className="min-h-11 min-w-11 rounded-md border border-line disabled:opacity-40" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className="min-h-11 px-2 text-button" onClick={() => setSelected(s)}>
              勤務
            </button>
            <button type="button" disabled={busy} className="min-h-11 px-2 text-sub" onClick={() => void change(`staff/${s.id}`, "PATCH", { is_active: !s.is_active }, reload)}>
              {s.is_active ? "停止" : "再開"}
            </button>
          </li>
        ))}
      </ol>
      <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">担当者を追加</h2>
        <Field label="表示名" value={name} onChange={setName} hint="お客様の予約ページに表示されます" />
        <Button
          variant="secondary"
          disabled={busy || !name}
          onClick={() =>
            void change("staff", "POST", { display_name: name, priority: sorted.length + 1 }, () => {
              setName("");
              reload();
            })
          }
        >
          担当者を追加
        </Button>
      </section>
    </>
  );
}

function ShiftEditor({ sub, staff, today, onBack }: { sub: string; staff: StaffSetting; today: string; onBack: () => void }) {
  const shifts = useLoad(`${sub}|shifts|${staff.id}`, () => adminApi.setting<{ weekly: Shift[]; exceptions: ShiftException[] }>(sub, `staff/${staff.id}/shifts`));
  const { change, busy, ui } = useSettingChange(sub);
  if (!shifts.data) return <p className="text-sm text-sub">読み込み中…</p>;
  const upcoming = shifts.data.exceptions.filter((e) => e.date >= today);
  return (
    <>
      <button type="button" className="min-h-11 self-start text-sm text-sub" onClick={onBack}>
        ‹ 担当者の一覧へ
      </button>
      <h2 className="font-bold">{staff.display_name}の勤務</h2>
      {ui}
      <WeeklyShifts key={shifts.data.weekly.map((w) => `${w.weekday}${w.starts_at}${w.ends_at}`).join()} initial={shifts.data.weekly} busy={busy} onSave={(rows) => void change(`staff/${staff.id}/shifts`, "PUT", rows, shifts.reload)} />
      <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
        <h3 className="text-sm font-bold">日ごとの変更（休み・時間の変更）</h3>
        <ul className="text-sm">
          {upcoming.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-1">
              <span>
                {formatDateKey(e.date)} {e.is_off ? "休み" : `${hm(e.starts_at ?? "")}〜${hm(e.ends_at ?? "")}`}
              </span>
              <button type="button" className="min-h-11 px-2 text-danger" onClick={() => void change(`staff/${staff.id}/exceptions/${e.id}`, "DELETE", undefined, shifts.reload)}>
                削除
              </button>
            </li>
          ))}
        </ul>
        <NewException today={today} busy={busy} onAdd={(body) => void change(`staff/${staff.id}/exceptions`, "POST", body, shifts.reload)} />
      </section>
    </>
  );
}

function WeeklyShifts({ initial, busy, onSave }: { initial: Shift[]; busy: boolean; onSave: (rows: Shift[]) => void }) {
  const [rows, setRows] = useState(() =>
    WEEKDAYS.map((_, d) => {
      const s = initial.find((x) => x.weekday === d);
      return { weekday: d, on: Boolean(s), starts_at: hm(s?.starts_at ?? "10:00"), ends_at: hm(s?.ends_at ?? "19:00") };
    }),
  );
  const update = (d: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r) => (r.weekday === d ? { ...r, ...patch } : r)));
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <h3 className="text-sm font-bold">週の勤務</h3>
      {rows.map((r) => (
        <div key={r.weekday} className="flex items-center gap-2">
          <label className="flex w-16 items-center gap-1 text-sm font-bold">
            <input type="checkbox" checked={r.on} onChange={(e) => update(r.weekday, { on: e.target.checked })} />
            {WEEKDAYS[r.weekday]}
          </label>
          {r.on ? (
            <>
              <TimeSelect label={`${WEEKDAYS[r.weekday]}曜の勤務開始`} value={r.starts_at} onChange={(v) => update(r.weekday, { starts_at: v })} />
              〜
              <TimeSelect label={`${WEEKDAYS[r.weekday]}曜の勤務終了`} value={r.ends_at} onChange={(v) => update(r.weekday, { ends_at: v })} />
            </>
          ) : (
            <span className="text-sm text-sub">休み</span>
          )}
        </div>
      ))}
      <Button disabled={busy} onClick={() => onSave(rows.filter((r) => r.on).map(({ weekday, starts_at, ends_at }) => ({ weekday, starts_at, ends_at })))}>
        勤務を保存する
      </Button>
    </section>
  );
}

function NewException({ today, busy, onAdd }: { today: string; busy: boolean; onAdd: (body: unknown) => void }) {
  const [date, setDate] = useState(today);
  const [off, setOff] = useState(true);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("15:00");
  return (
    <div className="flex flex-col gap-2">
      <input aria-label="変更する日" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      <select aria-label="休みか時間変更か" className={inputClass} value={off ? "off" : "work"} onChange={(e) => setOff(e.target.value === "off")}>
        <option value="off">休み</option>
        <option value="work">この時間だけ勤務</option>
      </select>
      {!off ? (
        <div className="flex items-center gap-2">
          <TimeSelect label="その日の勤務開始" value={from} onChange={setFrom} />〜<TimeSelect label="その日の勤務終了" value={to} onChange={setTo} />
        </div>
      ) : null}
      <Button variant="secondary" disabled={busy} onClick={() => onAdd({ date, is_off: off, starts_at: off ? null : from, ends_at: off ? null : to })}>
        日ごとの変更を追加
      </Button>
    </div>
  );
}
