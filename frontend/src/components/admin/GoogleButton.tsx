"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Notice } from "../ui/Notice";

type Intent = Parameters<typeof adminApi.googleStart>[0];

/** Googleの認証が済まなかったときに、画面へ戻ってくる理由（?error=）の案内。 */
export const GOOGLE_ERRORS: Record<string, string> = {
  not_registered: "このGoogleアカウントは登録されていません。新規登録するか、招待のメールのリンクから参加してください。",
  calendar: "Googleカレンダーの権限が許可されていません。もう一度ログインし、カレンダーの項目にチェックを入れたまま許可してください。",
  cancelled: "Googleでの認証が中止されました。",
  failed: "Googleでの認証ができませんでした。時間をおいて、もう一度お試しください。",
  taken: "認証している間に、そのURLが別の店舗に使われました。別のURLで登録し直してください。",
  invitation_email: "招待されたメールアドレスのGoogleアカウントでログインしてください。",
  invalid_invitation: "この招待は無効か、期限が切れています。オーナーに招待のやり直しを依頼してください。",
  staff_taken: "この担当者には、すでにログインする人がいます。オーナーにご確認ください。",
};

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/** 入力の誤り（{ subdomain: ["このURLは既に使われています"] } など）があれば、その説明を使う。 */
function startError(e: unknown): string {
  if (!(e instanceof ApiError)) return "始められませんでした";
  const first = e.body && typeof e.body === "object" ? Object.values(e.body)[0] : undefined;
  const text = Array.isArray(first) ? first[0] : first;
  return typeof text === "string" ? text : e.message;
}

/** 「Googleで〜」のボタン。目的を預けてから、Googleの認証へ移る。ログインとカレンダーの許可を、1回で済ませる。 */
export function GoogleButton({ intent, label, disabled }: { intent: Intent; label: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      window.location.assign((await adminApi.googleStart(intent)).url);
    } catch (e) {
      setError(startError(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy || disabled}
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border-[1.5px] border-line bg-card px-5 text-base font-bold text-ink transition-colors duration-200 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GoogleMark />
        {busy ? "Googleに移動しています…" : label}
      </button>
      {error ? <Notice tone="warn">{error}</Notice> : null}
    </div>
  );
}

/** Googleに求める権限の説明。 */
export function GoogleScopeNote() {
  return <p className="text-xs leading-relaxed text-sub">ログインと同時に、Googleカレンダーの予定の閲覧・書き込みを許可していただきます。空き時間の判定と、予約の登録に使います。</p>;
}
