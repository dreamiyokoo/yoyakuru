"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Options, TimeOff } from "@/lib/adminTypes";
import { formatDateTime, toDateKey } from "@/lib/format";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { AdminShell } from "./AdminShell";
import { useLoad } from "./useLoad";

const TIMES = Array.from({ length: 29 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** 27 休み・予約不可時間の登録。スタッフは自分の分だけ。 */
export function TimeOffPage({ today = toDateKey(new Date()) }: { today?: string }) {
  return <AdminShell title="休み・予約不可">{(sub) => <Body sub={sub} today={today} />}</AdminShell>;
}

function Body({ sub, today }: { sub: string; today: string }) {
  const options = useLoad(sub, () => adminApi.options(sub));
  const list = useLoad(`${sub}|list`, () => adminApi.timeOffs(sub, `${today}T00:00:00+09:00`));
  const [created, setCreated] = useState<TimeOff | null>(null);
  const [error, setError] = useState("");
  if (options.error) return <Notice tone="warn">{options.error}</Notice>;
  if (!options.data) return <p className="text-sm text-sub">読み込み中…</p>;

  const remove = async (id: number) => {
    setError("");
    try {
      await adminApi.deleteTimeOff(sub, id);
      list.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "削除できませんでした");
    }
  };

  return (
    <>
      <NewTimeOff sub={sub} today={today} options={options.data} onCreated={(t) => { setCreated(t); list.reload(); }} />
      {created?.affected_bookings?.length ? (
        <Notice tone="warn">
          <p className="font-bold">影響を受ける予約：{created.affected_bookings.length}件</p>
          <ul className="mt-1">
            {created.affected_bookings.map((b) => (
              <li key={b.id}>
                {formatDateTime(b.starts_at)} {b.service_name} {b.customer_name}様
              </li>
            ))}
          </ul>
          <p className="mt-1">既存の予約は自動で取消しません。必要なら予約の詳細から変更・取消してください。</p>
        </Notice>
      ) : null}
      <h2 className="text-sm font-bold">登録済み</h2>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {list.data?.length === 0 ? <p className="text-sm text-sub">登録はありません。</p> : null}
      <ul className="flex flex-col gap-2">
        {list.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-4 py-2 text-sm">
            <span>
              <span className="font-bold">{t.staff_name}</span>
              <br />
              {formatDateTime(t.starts_at)}〜{formatDateTime(t.ends_at).slice(-5)}
              {t.reason ? `（${t.reason}）` : ""}
            </span>
            <button type="button" className="min-h-11 px-2 text-danger" onClick={() => void remove(t.id)} aria-label={`${formatDateTime(t.starts_at)}の登録を削除`}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewTimeOff({ sub, today, options, onCreated }: { sub: string; today: string; options: Options; onCreated: (t: TimeOff) => void }) {
  const owner = options.role === "owner";
  const choices = owner ? options.staff : options.staff.filter((s) => s.id === options.staff_id);
  const [staff, setStaff] = useState<string>(String(choices[0]?.id ?? ""));
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("15:00");
  const [to, setTo] = useState("17:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const select = "rounded-lg border border-line px-3 py-2 font-normal";

  const submit = async () => {
    setError("");
    try {
      const t = await adminApi.createTimeOff(sub, {
        staff: staff === "all" ? null : Number(staff),
        starts_at: `${date}T${from}:00+09:00`,
        ends_at: `${date}T${to}:00+09:00`,
        reason: reason.trim(),
      });
      setReason("");
      onCreated(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "登録できませんでした");
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
      <label className="flex flex-col gap-1 text-sm font-bold">
        担当
        <select className={select} value={staff} onChange={(e) => setStaff(e.target.value)}>
          {choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
              {s.id === options.staff_id ? "（自分）" : ""}
            </option>
          ))}
          {owner ? <option value="all">店舗全体</option> : null}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        日付
        <input type="date" className={select} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm font-bold">
          開始
          <select className={select} value={from} onChange={(e) => setFrom(e.target.value)}>
            {TIMES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-bold">
          終了
          <select className={select} value={to} onChange={(e) => setTo(e.target.value)}>
            {TIMES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <Field label="理由（任意・お客様には表示されません）" value={reason} onChange={setReason} />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button onClick={submit}>追加する</Button>
    </section>
  );
}
