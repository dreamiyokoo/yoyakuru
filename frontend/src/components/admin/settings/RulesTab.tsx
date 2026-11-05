"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Choice";
import { Field } from "../../ui/Field";
import { useLoad } from "../useLoad";
import { inputClass, useSettingChange } from "./useSettingChange";

interface StoreRules {
  name: string;
  phone: string;
  address: string;
  slot_interval_minutes: number;
  booking_window_days: number;
  same_day_cutoff_minutes: number;
  cancel_deadline_days: number;
  default_buffer_minutes: number;
}

const CUTOFFS: [number, string][] = [[0, "締切なし"], [30, "30分前"], [60, "1時間前"], [120, "2時間前"], [180, "3時間前"], [1440, "前日まで"]];
const CANCEL: [number, string][] = [[0, "開始時刻まで"], [1, "前日まで"], [2, "2日前まで"], [3, "3日前まで"]];

/** 11 予約ルール・店舗の情報（TIME-03〜05、CUST-05）。 */
export function RulesTab({ sub }: { sub: string }) {
  const { data, error } = useLoad(`${sub}|rules`, () => adminApi.setting<StoreRules>(sub, "store"));
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-sub">読み込み中…</p>;
  return <RulesForm sub={sub} initial={data} />;
}

function RulesForm({ sub, initial }: { sub: string; initial: StoreRules }) {
  const [v, setV] = useState(initial);
  const { change, busy, ui } = useSettingChange(sub);
  const set = <K extends keyof StoreRules>(k: K, value: StoreRules[K]) => setV({ ...v, [k]: value });
  return (
    <>
      <Field label="店舗名" value={v.name} onChange={(x) => set("name", x)} />
      <Field label="電話番号" type="tel" value={v.phone} onChange={(x) => set("phone", x)} hint="取消の締切後や、AIが答えられないときに案内します" />
      <Field label="住所" value={v.address} onChange={(x) => set("address", x)} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">開始時刻の刻み</span>
        <div role="radiogroup" aria-label="開始時刻の刻み" className="flex gap-2">
          {[15, 30, 60].map((m) => (
            <Chip key={m} selected={v.slot_interval_minutes === m} onSelect={() => set("slot_interval_minutes", m)}>
              {m}分
            </Chip>
          ))}
        </div>
      </div>
      <Field label="何日先まで受け付けるか（日）" type="number" value={String(v.booking_window_days)} onChange={(x) => set("booking_window_days", Number(x))} />
      <label className="flex flex-col gap-1 text-sm font-bold">
        当日の受付締切
        <select className={inputClass} value={v.same_day_cutoff_minutes} onChange={(e) => set("same_day_cutoff_minutes", Number(e.target.value))}>
          {CUTOFFS.map(([m, l]) => (
            <option key={m} value={m}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        お客様による取消の締切
        <select className={inputClass} value={v.cancel_deadline_days} onChange={(e) => set("cancel_deadline_days", Number(e.target.value))}>
          {CANCEL.map(([d, l]) => (
            <option key={d} value={d}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <Field label="準備時間の既定値（分）" type="number" value={String(v.default_buffer_minutes)} onChange={(x) => set("default_buffer_minutes", Number(x))} hint="サービスごとに設定がない場合に使います" />
      <p className="text-xs text-sub">仮押さえの有効時間は15分（固定）です。</p>
      {ui}
      <Button disabled={busy} onClick={() => void change("store", "PUT", v)}>
        保存する
      </Button>
    </>
  );
}
