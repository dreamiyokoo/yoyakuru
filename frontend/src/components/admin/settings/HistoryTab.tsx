"use client";

import { adminApi } from "@/lib/adminApi";
import { formatDateTime } from "@/lib/format";
import { Button } from "../../ui/Button";
import { useLoad } from "../useLoad";
import { useSettingChange } from "./useSettingChange";

interface Change {
  id: number;
  label: string;
  source: "manual" | "ai" | "undo";
  actor_name: string;
  created_at: string;
  reverted: boolean;
}

const SOURCE: Record<Change["source"], string> = { manual: "画面", ai: "AIで設定", undo: "取り消し" };

/** 35 設定の変更履歴（SETUP-07）。AIによる変更か手動の変更かを残し、直前の状態に戻せる。 */
export function HistoryTab({ sub, onChanged }: { sub: string; onChanged?: () => void }) {
  const list = useLoad(`${sub}|history`, () => adminApi.setting<Change[]>(sub, "history"));
  const { change, busy, ui } = useSettingChange(sub);
  if (list.error) return <p className="text-sm text-danger">{list.error}</p>;
  if (!list.data) return <p className="text-sm text-sub">読み込み中…</p>;
  const undoable = list.data.some((c) => c.source !== "undo" && !c.reverted);
  return (
    <>
      {ui}
      <Button
        variant="secondary"
        disabled={busy || !undoable}
        onClick={() =>
          void change("history/undo", "POST", {}, () => {
            list.reload();
            onChanged?.();
          })
        }
      >
        直前の変更を取り消す
      </Button>
      <p className="text-xs text-sub">取り消すと、その変更の前の設定に戻ります。続けて押すと、さらに前の変更も取り消せます。</p>
      {list.data.length === 0 ? <p className="text-sm text-sub">変更の履歴はまだありません。</p> : null}
      <ul className="flex flex-col gap-2">
        {list.data.map((c) => (
          <li key={c.id} className={`rounded-xl border border-line px-4 py-2 text-sm ${c.reverted ? "text-sub line-through" : ""}`}>
            <span className="font-bold">{c.label}</span>
            <span className="ml-2 rounded-full bg-muted px-2 text-xs no-underline">{SOURCE[c.source]}</span>
            {c.reverted ? <span className="ml-2 text-xs">（取り消し済み）</span> : null}
            <span className="block text-xs text-sub">
              {formatDateTime(c.created_at)} {c.actor_name}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
