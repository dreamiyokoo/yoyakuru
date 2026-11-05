"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Options } from "@/lib/adminTypes";
import { toDateKey } from "@/lib/format";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { AdminShell } from "./AdminShell";
import { SlotPicker } from "./SlotPicker";
import { useLoad } from "./useLoad";

/** 26 予約の手入力。店舗が電話や来店で受けた予約を、確定した状態で登録する。 */
export function NewBookingPage({ today = toDateKey(new Date()) }: { today?: string }) {
  return (
    <AdminShell title="予約を登録">
      {(sub) => <Form sub={sub} today={today} />}
    </AdminShell>
  );
}

function Form({ sub, today }: { sub: string; today: string }) {
  const options = useLoad(sub, () => adminApi.options(sub));
  if (options.error) return <Notice tone="warn">{options.error}</Notice>;
  if (!options.data) return <p className="text-sm text-sub">読み込み中…</p>;
  return <FormBody sub={sub} today={today} options={options.data} />;
}

function FormBody({ sub, today, options }: { sub: string; today: string; options: Options }) {
  const router = useRouter();
  const ownStaff = options.role === "staff" ? options.staff_id : null;
  const [service, setService] = useState(options.services[0]?.id ?? 0);
  const [customerType, setCustomerType] = useState<"first" | "repeat">("repeat");
  const staffChoices = options.staff.filter((s) => s.service_ids.includes(service) && (ownStaff === null || s.id === ownStaff));
  const [staff, setStaff] = useState(staffChoices[0]?.id ?? 0);
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", note: "" });
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const staffValue = staffChoices.some((s) => s.id === staff) ? staff : (staffChoices[0]?.id ?? 0);

  const submit = async () => {
    if (!form.name.trim()) {
      setNameError("お名前を入力してください");
      return;
    }
    setNameError("");
    try {
      const b = await adminApi.createBooking(sub, {
        service,
        staff: staffValue,
        starts_at: startsAt,
        customer_type: customerType,
        customer_name: form.name.trim(),
        customer_phone: form.phone.trim(),
        customer_email: form.email.trim(),
        note: form.note.trim(),
      });
      router.push(`/bookings/${b.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "登録できませんでした");
    }
  };

  const select = "rounded-lg border border-line px-3 py-2 font-normal";
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-bold">
        サービス
        <select className={select} value={service} onChange={(e) => { setService(Number(e.target.value)); setStartsAt(""); }}>
          {options.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="お客様の区分" className="flex gap-2">
        <Chip selected={customerType === "first"} onSelect={() => { setCustomerType("first"); setStartsAt(""); }}>初めて</Chip>
        <Chip selected={customerType === "repeat"} onSelect={() => { setCustomerType("repeat"); setStartsAt(""); }}>2回目以降</Chip>
      </div>
      <label className="flex flex-col gap-1 text-sm font-bold">
        担当
        <select className={select} value={staffValue} onChange={(e) => { setStaff(Number(e.target.value)); setStartsAt(""); }}>
          {staffChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        日付
        <input type="date" className={select} value={date} onChange={(e) => { setDate(e.target.value); setStartsAt(""); }} />
      </label>
      {staffValue ? (
        <SlotPicker sub={sub} service={service} staff={staffValue} date={date} customerType={customerType} value={startsAt} onChange={setStartsAt} />
      ) : (
        <p className="text-sm text-sub">このサービスを担当できる人がいません。</p>
      )}
      <Field label="お名前" value={form.name} onChange={(name) => setForm({ ...form, name })} error={nameError} required />
      <Field label="電話番号（任意）" type="tel" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
      <Field label="メールアドレス（任意）" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} hint="入れると確認メールを送ります" />
      <Field label="メモ（任意）" value={form.note} onChange={(note) => setForm({ ...form, note })} multiline />
      <p className="text-xs text-sub">Web予約と同じ空き判定で確認します。重なる予約は登録できません。</p>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button disabled={!startsAt} onClick={submit}>
        登録する
      </Button>
    </>
  );
}
