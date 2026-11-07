"use client";

import { createContext, useContext, useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { AdminBooking } from "@/lib/adminTypes";
import { formatDateTime } from "@/lib/format";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";

interface Pending {
  path: string;
  method: string;
  body: unknown;
  affected: AdminBooking[];
  onDone?: (result: unknown) => void;
}

/** 設定を保存したときに呼ぶ（設定画面の上の注意を読み直す）。 */
export const SettingSavedContext = createContext<() => void>(() => {});

/**
 * 設定の変更。まず保存せずに試し（dry_run）、影響を受ける予約があれば確認してから保存する（TIME-07、画面33）。
 * 既存の予約は自動で取消さない。
 */
export function useSettingChange(sub: string, source?: "ai") {
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onSaved = useContext(SettingSavedContext);

  const commit = async (p: Omit<Pending, "affected">) => {
    const res = await adminApi.changeSetting(sub, p.path, p.method, p.body, false, source);
    setPending(null);
    setMessage(res.affected_bookings.length ? `保存しました。影響を受ける予約が${res.affected_bookings.length}件あります。` : "保存しました。");
    p.onDone?.(res.result);
    onSaved();
  };

  const change = async (path: string, method: string, body: unknown, onDone?: (result: unknown) => void) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const preview = await adminApi.changeSetting(sub, path, method, body, true, source);
      if (preview.affected_bookings.length) setPending({ path, method, body, affected: preview.affected_bookings, onDone });
      else await commit({ path, method, body, onDone });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await commit(pending);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const ui = (
    <>
      {message ? <Notice>{message}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {pending ? (
        <section role="dialog" aria-label="変更前の確認" className="flex flex-col gap-2 rounded-xl border-2 border-ink bg-muted p-4">
          <h2 className="font-bold">変更前の確認</h2>
          <p className="text-sm font-bold">影響を受ける予約：{pending.affected.length}件</p>
          <ul className="text-sm">
            {pending.affected.map((b) => (
              <li key={b.id}>
                {formatDateTime(b.starts_at)} {b.service_name} {b.staff_name} {b.customer_name}様
              </li>
            ))}
          </ul>
          <p className="text-xs text-sub">予約は自動で取消しません。担当の変更やお客様への連絡は、予約の詳細から行ってください。</p>
          <Button disabled={busy} onClick={confirm}>
            変更を保存する
          </Button>
          <Button variant="secondary" onClick={() => setPending(null)}>
            戻る
          </Button>
        </section>
      ) : null}
    </>
  );

  /** 確認待ちの変更を捨てる（保存しない）。 */
  const cancel = () => setPending(null);

  return { change, busy, ui, pending: pending !== null, cancel };
}

export const TIMES = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
export const hm = (t: string) => t.slice(0, 5);
export const inputClass = "rounded-lg border border-line px-3 py-2 font-normal";

export function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} className={inputClass} value={hm(value)} onChange={(e) => onChange(e.target.value)}>
      {TIMES.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
}
