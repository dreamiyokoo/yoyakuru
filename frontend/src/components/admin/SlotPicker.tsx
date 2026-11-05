"use client";

import { adminApi } from "@/lib/adminApi";
import { formatTime } from "@/lib/format";
import { useLoad } from "./useLoad";

interface Props {
  sub: string;
  service: number;
  staff: number;
  date: string;
  customerType: string;
  excludeBooking?: number;
  value: string;
  onChange: (startsAt: string) => void;
}

/** 管理画面用の空き枠の選択。受付の締切は適用しない。 */
export function SlotPicker({ sub, service, staff, date, customerType, excludeBooking, value, onChange }: Props) {
  const key = `${sub}|${service}|${staff}|${date}|${customerType}|${excludeBooking ?? ""}`;
  const { data, error, loading } = useLoad(date ? key : null, () =>
    adminApi.availability(sub, { service, staff, date, customer_type: customerType, exclude_booking: excludeBooking }),
  );
  if (!date) return null;
  if (loading) return <p className="text-sm text-sub">空き枠を読み込み中…</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data?.slots.length) return <p className="text-sm text-sub">この日は空きがありません。</p>;
  return (
    <div role="radiogroup" aria-label="開始時刻" className="grid grid-cols-4 gap-2">
      {data.slots.map((s) => (
        <button
          key={s.starts_at}
          type="button"
          role="radio"
          aria-checked={value === s.starts_at}
          onClick={() => onChange(s.starts_at)}
          className={`min-h-11 rounded-lg border text-sm ${value === s.starts_at ? "border-button bg-button font-bold text-white" : "border-line"}`}
        >
          {formatTime(s.starts_at)}
        </button>
      ))}
    </div>
  );
}
