"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAdmin } from "./AdminContext";
import { Calendar, CalendarX, List, Sliders } from "../ui/icons";
import { BillingRequired } from "./BillingRequired";
import { Onboarding } from "./Onboarding";
import { TWO_FACTOR_LEAD, TwoFactorSetup } from "./TwoFactorSetup";

// 文字だけでなくアイコンでも見分けられるようにする（UX: navigation recognizability）
const TABS = [
  { href: "/bookings", label: "予約", Icon: List },
  { href: "/calendar", label: "カレンダー", Icon: Calendar },
  { href: "/time-off", label: "休み", Icon: CalendarX },
  { href: "/settings", label: "設定", Icon: Sliders },
];

/** 管理画面の枠（ヘッダーと下部のタブ）。店舗に所属していなければ案内だけを出す。 */
export function AdminShell({ title, action, children }: { title: string; action?: ReactNode; children: (sub: string) => ReactNode }) {
  const { me, membership, setTenant, signOut, signedIn } = useAdmin();
  const pathname = usePathname();
  if (!me) return null;
  const switcher =
    me.memberships.length > 1 ? (
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
    ) : null;
  // 利用を始めるまで（二段階認証・お支払い）は、管理画面のタブを出さずに手順だけを見せる
  if (me.two_factor_required && !me.two_factor_enabled) {
    return (
      <Onboarding step={membership?.billing_managed ? 2 : undefined} title="二段階認証を設定してください" lead={<p>{TWO_FACTOR_LEAD}</p>} onSignOut={() => void signOut()}>
        <TwoFactorSetup onDone={signedIn} bare />
      </Onboarding>
    );
  }
  if (membership?.billing_required) return <BillingRequired membership={membership} onPaid={signedIn} onSignOut={() => void signOut()} switcher={switcher} />;
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-card">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <h1 className="flex-1 font-display text-lg font-bold">{title}</h1>
        {action}
        {switcher}
        <Link href="/account" className="flex min-h-11 items-center text-sm text-sub">
          アカウント
        </Link>
        <button type="button" onClick={() => void signOut()} className="min-h-11 text-sm text-sub">
          ログアウト
        </button>
      </header>
      <main className="flex flex-1 flex-col gap-3 px-4 py-4">
        {membership ? (
          children(membership.subdomain)
        ) : (
          <p className="text-sm">所属している店舗がありません。店舗のオーナーに招待を依頼してください。</p>
        )}
      </main>
      <nav aria-label="管理メニュー" className="sticky bottom-0 flex justify-around border-t border-line bg-card pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-xs transition-colors duration-150 ${active ? "font-bold text-button" : "text-sub hover:text-ink"}`}
            >
              <t.Icon className="h-5 w-5" />
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
