"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { useLoad } from "../useLoad";
import { inputClass, useSettingChange } from "./useSettingChange";

export interface Resource {
  id: number;
  name: string;
  quantity: number;
}

/** 32 設備（ベッド・席・教室など）。数を減らすと、同じ時間の予約が入りきらなくなることがある（RES-01）。 */
export function ResourcesTab({ sub }: { sub: string }) {
  const list = useLoad(`${sub}|resources`, () => adminApi.setting<Resource[]>(sub, "resources"));
  const { change, busy, ui } = useSettingChange(sub);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  if (list.error) return <p className="text-sm text-danger">{list.error}</p>;
  if (!list.data) return <p className="text-sm text-sub">読み込み中…</p>;
  return (
    <>
      {ui}
      {list.data.length === 0 ? <p className="text-sm text-sub">設備はまだありません。同時に使える数に限りがあるもの（ベッド・席など）を登録します。</p> : null}
      <ul className="flex flex-col gap-2">
        {list.data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-4 py-2 text-sm">
            <span className="font-bold">{r.name}</span>
            <select
              aria-label={`${r.name}の数`}
              className={inputClass}
              value={r.quantity}
              disabled={busy}
              onChange={(e) => void change(`resources/${r.id}`, "PATCH", { quantity: Number(e.target.value) }, list.reload)}
            >
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}台・席
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">設備を追加</h2>
        <Field label="設備の名前" value={name} onChange={setName} />
        <Field label="数" type="number" value={quantity} onChange={setQuantity} />
        <Button
          variant="secondary"
          disabled={busy || !name}
          onClick={() =>
            void change("resources", "POST", { name, quantity: Number(quantity) }, () => {
              setName("");
              list.reload();
            })
          }
        >
          設備を追加
        </Button>
      </section>
    </>
  );
}
