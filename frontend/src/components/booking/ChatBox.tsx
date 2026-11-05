"use client";

import { useState } from "react";
import { ApiError, sendChat } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ChatSuggestion, ChatTurn, CustomerType, Slot } from "@/lib/types";

interface Props {
  slug: string;
  context: Conditions;
  onSuggest: (s: ChatSuggestion) => void;
  onSlot: (s: Slot, conditions: Conditions) => void;
  onToken: (token: string) => void;
}

export interface Conditions {
  customer_type: CustomerType;
  service: number | null;
  staff: number | null;
}

interface Line extends ChatTurn {
  slots?: Slot[];
  /** 空き枠を探した条件。あとで条件を変えても、この枠はこの条件で予約する */
  conditions?: Conditions;
  phone?: string;
}

/**
 * 自由入力の質問（CHAT-03〜07）。選んだ条件は保ったまま、質問に答えたり、ことばの希望から候補を出す。
 * 予約の確定は、いつもの確認画面を通す（CHAT-04）。
 */
export function ChatBox({ slug, context, onSuggest, onSlot, onToken }: Props) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="min-h-11 self-start text-sm font-bold text-button underline" onClick={() => setOpen(true)}>
        ことばで質問・検索する
      </button>
    );
  }

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    // 直近だけを、サーバーの上限（1件500文字）に収めて送る
    const history = lines.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 500) }));
    setLines([...lines, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    try {
      const res = await sendChat(slug, { message, history, context });
      if (res.chat_token) onToken(res.chat_token);
      if (res.suggestion) onSuggest(res.suggestion);
      const sg = res.suggestion;
      const conditions = sg
        ? { customer_type: sg.customer_type ?? context.customer_type, service: sg.service ?? context.service, staff: sg.staff ?? context.staff }
        : undefined;
      setLines((l) => [...l, { role: "assistant", content: res.reply, slots: sg?.slots, conditions, phone: res.handoff ? res.phone : undefined }]);
    } catch (e) {
      setLines((l) => [...l, { role: "assistant", content: e instanceof ApiError ? e.message : "送信に失敗しました" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="ことばで質問" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div role="log" aria-live="polite" className="flex flex-col gap-2 text-sm">
        {lines.length === 0 ? <p className="text-sub">例：「駐車場はありますか」「明日の夕方は空いていますか」</p> : null}
        {lines.map((l, i) => (
          <div key={i} className={l.role === "user" ? "self-end rounded-lg bg-card px-3 py-2" : "self-start"}>
            <p>{l.content}</p>
            {l.phone ? (
              <a className="mt-1 inline-block font-bold text-button underline" href={`tel:${l.phone}`}>
                お店に電話する（{l.phone}）
              </a>
            ) : null}
            {l.slots?.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {l.slots.map((s) => (
                  <button key={s.starts_at} type="button" className="min-h-11 rounded-lg border border-button bg-card px-3 font-bold text-button" onClick={() => l.conditions && onSlot(s, l.conditions)}>
                    {formatDateTime(s.starts_at)}で進む
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <p className="text-sub">考えています…</p> : null}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input aria-label="質問や希望" maxLength={300} className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-base" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={busy || !text.trim()} className="min-h-11 rounded-lg bg-button px-4 font-bold text-white disabled:opacity-40">
          送信
        </button>
      </form>
      <p className="text-xs text-sub">AIがお店の登録情報をもとに答えます。症状や個人情報は入力しないでください。予約は確認画面で確定します。</p>
    </section>
  );
}
