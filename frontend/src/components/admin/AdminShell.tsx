"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAdmin } from "./AdminContext";
import { TwoFactorSetup } from "./TwoFactorSetup";

const TABS = [
  { href: "/bookings", label: "予約" },
  { href: "/calendar", label: "カレンダー" },
  { href: "/time-off", label: "休み" },
  { href: "/settings", label: "設定" },
];

/** 管理画面の枠（ヘッダーと下部のタブ）。店舗に所属していなければ案内だけを出す。 */
export function AdminShell({ title, action, children }: { title: string; action?: ReactNode; children: (sub: string) => ReactNode }) {
  const { me, membership, setTenant, signOut, signedIn } = useAdmin();
  const pathname = usePathname();
  if (!me) return null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-card">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <h1 className="flex-1 font-display text-lg font-bold">{title}</h1>
        {action}
        {me.memberships.length > 1 ? (
          <select
            aria-label="店舗"
            className="rounded-md border border-line px-2 py-1 text-sm"
            value={membership?.subdomain}
            onChange={(e) => setTenant(e.target.value)}
          >
            {me.memberships.map((m) => (
              <option key={m.subdomain} value={m.subdomain}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" onClick={() => void signOut()} className="min-h-11 text-sm text-sub">
          ログアウト
        </button>
      </header>
      <main className="flex flex-1 flex-col gap-3 px-4 py-4">
        {me.two_factor_required && !me.two_factor_enabled ? (
          <TwoFactorSetup onDone={signedIn} />
        ) : membership ? (
          children(membership.subdomain)
        ) : (
          <p className="text-sm">所属している店舗がありません。店舗のオーナーに招待を依頼してください。</p>
        )}
      </main>
      <nav aria-label="管理メニュー" className="sticky bottom-0 flex justify-around border-t border-line bg-card pb-5 pt-2">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 min-w-16 items-center justify-center rounded-md px-3 text-sm ${active ? "font-bold text-button" : "text-sub"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: "確定",
  hold: "仮押さえ",
  cancelled: "取消",
  expired: "期限切れ",
};

export const CHANNEL_LABEL: Record<string, string> = {
  web: "Web",
  chat: "チャット",
  phone: "電話（AI）",
  admin: "店舗で登録",
};

export function StatusBadge({ status }: { status: string }) {
  const strong = status === "confirmed";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold ${strong ? "bg-button text-white" : "border border-ink bg-muted text-ink"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
