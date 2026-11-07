"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { useLoad } from "../useLoad";
import type { Resource } from "./ResourcesTab";
import { ChevronRight } from "../../ui/icons";
import { inputClass, useSettingChange } from "./useSettingChange";

export interface ServiceSetting {
  id?: number;
  name: string;
  category: string;
  description: string;
  price: number | null;
  duration_minutes: number;
  first_visit_duration_minutes: number | null;
  /** null は店舗の既定値を使う */
  buffer_before_minutes: number | null;
  buffer_after_minutes: number | null;
  staff: number[];
  resource: number | null;
  resource_quantity: number;
  capacity: number;
  is_active: boolean;
  sort_order: number;
}

const BLANK: ServiceSetting = {
  name: "",
  category: "",
  description: "",
  price: null,
  duration_minutes: 60,
  first_visit_duration_minutes: null,
  buffer_before_minutes: null,
  buffer_after_minutes: null,
  staff: [],
  resource: null,
  resource_quantity: 1,
  capacity: 1,
  is_active: true,
  sort_order: 0,
};

const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60];

/** 30 サービス（メニュー）。所要時間・初回の時間・準備時間・担当できる人・設備・定員（SVC-01〜05）。 */
export function ServicesTab({ sub, staff }: { sub: string; staff: { id: number; display_name: string }[] }) {
  const list = useLoad(`${sub}|services`, () => adminApi.setting<ServiceSetting[]>(sub, "services"));
  const resources = useLoad(`${sub}|resources`, () => adminApi.setting<Resource[]>(sub, "resources"));
  const [editing, setEditing] = useState<ServiceSetting | null>(null);
  const { change, busy, ui } = useSettingChange(sub);
  if (list.error) return <p className="text-sm text-danger">{list.error}</p>;
  if (!list.data || !resources.data) return <p className="text-sm text-sub">読み込み中…</p>;

  const save = (s: ServiceSetting) => {
    const { id, ...body } = s;
    void change(id ? `services/${id}` : "services", id ? "PATCH" : "POST", body, () => {
      setEditing(null);
      list.reload();
    });
  };

  return (
    <>
      {ui}
      {editing ? (
        <ServiceForm key={editing.id ?? "new"} initial={editing} staff={staff} resources={resources.data} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left text-sm" onClick={() => setEditing(s)}>
                  <span>
                    <span className="font-bold">{s.name}</span>
                    {s.is_active ? "" : "（非公開）"}
                    <br />
                    <span className="text-sub">
                      {s.duration_minutes}分{s.first_visit_duration_minutes ? `（初回${s.first_visit_duration_minutes}分）` : ""}
                      {s.price !== null ? `・${s.price.toLocaleString()}円` : ""}
                      {s.capacity > 1 ? `・定員${s.capacity}名` : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-sub" />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => setEditing({ ...BLANK, staff: staff.map((s) => s.id) })}>
            サービスを追加
          </Button>
        </>
      )}
    </>
  );
}

function NumberSelect({ label, value, options, onChange, none }: { label: string; value: number | null; options: number[]; onChange: (v: number | null) => void; none?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-bold">
      {label}
      <select className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {none ? <option value="">{none}</option> : null}
        {options.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </label>
  );
}

function ServiceForm({
  initial,
  staff,
  resources,
  busy,
  onSave,
  onCancel,
}: {
  initial: ServiceSetting;
  staff: { id: number; display_name: string }[];
  resources: Resource[];
  busy: boolean;
  onSave: (s: ServiceSetting) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof ServiceSetting>(k: K, value: ServiceSetting[K]) => setV({ ...v, [k]: value });
  const toggleStaff = (id: number) => set("staff", v.staff.includes(id) ? v.staff.filter((x) => x !== id) : [...v.staff, id]);
  return (
    <section aria-label="サービスの編集" className="flex flex-col gap-3">
      <Field label="サービス名" value={v.name} onChange={(x) => set("name", x)} />
      <Field label="分類（任意）" value={v.category} onChange={(x) => set("category", x)} hint="例：整体、カット、個別指導" />
      <Field label="料金（税込・円）" type="number" value={v.price === null ? "" : String(v.price)} onChange={(x) => set("price", x === "" ? null : Number(x))} />
      <NumberSelect label="所要時間" value={v.duration_minutes} options={DURATIONS} onChange={(x) => set("duration_minutes", x ?? 60)} />
      <NumberSelect label="初回の所要時間" value={v.first_visit_duration_minutes} options={DURATIONS} none="通常と同じ" onChange={(x) => set("first_visit_duration_minutes", x)} />
      <div className="flex gap-2">
        <NumberSelect label="前の準備" value={v.buffer_before_minutes} options={BUFFERS} none="店舗の既定値" onChange={(x) => set("buffer_before_minutes", x)} />
        <NumberSelect label="後の片付け" value={v.buffer_after_minutes} options={BUFFERS} none="店舗の既定値" onChange={(x) => set("buffer_after_minutes", x)} />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-bold">担当できる人</legend>
        {staff.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={v.staff.includes(s.id)} onChange={() => toggleStaff(s.id)} />
            {s.display_name}
          </label>
        ))}
      </fieldset>
      {resources.length ? (
        <label className="flex flex-col gap-1 text-sm font-bold">
          使う設備
          <select className={inputClass} value={v.resource ?? ""} onChange={(e) => set("resource", e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">使わない</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Field label="定員（1回あたりの人数）" type="number" value={String(v.capacity)} onChange={(x) => set("capacity", Number(x))} hint="2名以上にすると、同じ時間に複数のお客様が予約できます（グループレッスンなど）" />
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={v.is_active} onChange={(e) => set("is_active", e.target.checked)} />
        予約ページに公開する
      </label>
      <Button disabled={busy || !v.name} onClick={() => onSave(v)}>
        保存する
      </Button>
      <Button variant="secondary" onClick={onCancel}>
        戻る
      </Button>
    </section>
  );
}
