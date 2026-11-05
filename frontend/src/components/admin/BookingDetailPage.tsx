"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { AdminBooking, Options } from "@/lib/adminTypes";
import { formatDateTime, toDateKey } from "@/lib/format";
import { Button } from "../ui/Button";
import { Notice, Summary } from "../ui/Notice";
import { AdminShell, CHANNEL_LABEL, StatusBadge } from "./AdminShell";
import { SlotPicker } from "./SlotPicker";
import { useLoad } from "./useLoad";

const ACTION_LABEL: Record<string, string> = {
  held: "仮押さえ",
  confirmed: "確定",
  cancelled: "取消",
  expired: "期限切れ",
  rescheduled: "日時・担当の変更",
};

/** 09 予約の詳細・編集。 */
export function BookingDetailPage({ id }: { id: number }) {
  return <AdminShell title="予約の詳細">{(sub) => <Detail sub={sub} id={id} />}</AdminShell>;
}

function Detail({ sub, id }: { sub: string; id: number }) {
  const booking = useLoad(`${sub}|${id}`, () => adminApi.booking(sub, id));
  const options = useLoad(sub, () => adminApi.options(sub));
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  if (booking.error) return <Notice tone="warn">{booking.error}</Notice>;
  if (!booking.data || !options.data) return <p className="text-sm text-sub">読み込み中…</p>;
  const b = booking.data;
  const active = b.status === "confirmed" || b.status === "hold";

  const cancel = async () => {
    try {
      await adminApi.cancelBooking(sub, b.id);
      setMessage("予約を取消しました。お客様にメールで知らせました。");
      setConfirming(false);
      booking.reload();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "取消できませんでした");
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <StatusBadge status={b.status} />
        <span className="text-sm text-sub">{CHANNEL_LABEL[b.channel]}</span>
      </div>
      <Summary
        rows={[
          ["日時", formatDateTime(b.starts_at)],
          ["担当", b.staff_name],
          ["サービス", `${b.service_name}（${b.customer_type === "first" ? "初めて" : "2回目以降"}）`],
          ["お客様", b.customer_name],
          ["メール", b.customer_email || "なし"],
          ["電話", b.customer_phone || "なし"],
          ["ご要望", b.note || "なし"],
        ]}
      />
      {message ? <Notice>{message}</Notice> : null}
      {active && options.data.role === "owner" && !editing && b.status === "confirmed" ? (
        <Button onClick={() => setEditing(true)}>日時・担当を変更</Button>
      ) : null}
      {editing ? (
        <Reschedule
          sub={sub}
          booking={b}
          options={options.data}
          onDone={(text) => {
            setEditing(false);
            setMessage(text);
            booking.reload();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      {active && !confirming ? (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          予約を取消
        </Button>
      ) : null}
      {confirming ? (
        <Notice tone="warn">
          <p className="font-bold">この予約を取消しますか？</p>
          <p className="mt-1">お客様にはメールで知らせます。</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={cancel}>取消する</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              やめる
            </Button>
          </div>
        </Notice>
      ) : null}
      <section className="rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">履歴</h2>
        <ul className="mt-1 text-sm">
          {b.events?.map((e, i) => (
            <li key={i} className="flex justify-between py-1">
              <span className="text-sub">{formatDateTime(e.created_at)}</span>
              <span>
                {ACTION_LABEL[e.action] ?? e.action}
                {e.actor_name ? `（${e.actor_name}）` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Reschedule({
  sub,
  booking,
  options,
  onDone,
  onCancel,
}: {
  sub: string;
  booking: AdminBooking;
  options: Options;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const staffChoices = options.staff.filter((s) => s.service_ids.includes(booking.service));
  const [staff, setStaff] = useState(booking.staff);
  const [date, setDate] = useState(toDateKey(new Date(booking.starts_at)));
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    try {
      await adminApi.reschedule(sub, booking.id, startsAt, staff);
      onDone("日時・担当を変更しました。お客様にメールで知らせました。");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "変更できませんでした");
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-button px-4 py-3">
      <h2 className="text-sm font-bold">日時・担当の変更</h2>
      <label className="flex flex-col gap-1 text-sm font-bold">
        担当
        <select className="rounded-lg border border-line px-3 py-2 font-normal" value={staff} onChange={(e) => { setStaff(Number(e.target.value)); setStartsAt(""); }}>
          {staffChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        日付
        <input type="date" className="rounded-lg border border-line px-3 py-2 font-normal" value={date} onChange={(e) => { setDate(e.target.value); setStartsAt(""); }} />
      </label>
      <SlotPicker sub={sub} service={booking.service} staff={staff} date={date} customerType={booking.customer_type} excludeBooking={booking.id} value={startsAt} onChange={setStartsAt} />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button disabled={!startsAt} onClick={save}>
        変更を保存する
      </Button>
      <Button variant="secondary" onClick={onCancel}>
        やめる
      </Button>
    </section>
  );
}
