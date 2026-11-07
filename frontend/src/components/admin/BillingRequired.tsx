"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Me, Membership } from "@/lib/adminTypes";
import { Button } from "../ui/Button";
import { Check, Lock } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Onboarding } from "./Onboarding";

/**
 * 月額の支払いが済んでいない店舗の案内（BILL-01）。
 * オーナーは Stripe の支払い画面へ進む。支払い画面から戻ったら（?checkout_session=）、その場で状態を確かめる。
 */
export function BillingRequired({
  membership,
  onPaid,
  onSignOut,
  switcher,
}: {
  membership: Membership;
  onPaid: (me: Me) => void;
  onSignOut?: () => void;
  /** 複数の店舗に所属するとき、ほかの店舗へ移れるようにする */
  switcher?: React.ReactNode;
}) {
  const owner = membership.role === "owner";
  // 支払い画面から戻ったときの印。管理画面はログインの確認後にブラウザだけで描くので、ここで URL を読める
  const [session] = useState(() =>
    owner && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("checkout_session") : null,
  );
  const [checking, setChecking] = useState(Boolean(session));
  // 以前に支払っていた店舗（カードの失敗・解約）は、Stripe の画面でカードの変更や領収書の確認ができる
  const [manageable, setManageable] = useState(false);
  const [priceLabel, setPriceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!owner) return;
    let active = true;
    (async () => {
      try {
        const billing = await adminApi.billing(membership.subdomain, session);
        if (!active) return;
        setManageable(billing.manageable);
        setPriceLabel(billing.price_label ?? "");
        if (billing.usable) {
          window.history.replaceState(null, "", window.location.pathname);
          onPaid(await adminApi.me());
        } else if (session) {
          setError("お支払いの確認に時間がかかっています。少し待ってから、画面を読み込み直してください。");
        }
      } catch (e) {
        if (active && session) setError(e instanceof ApiError ? e.message : "お支払いを確認できませんでした");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [owner, session, membership.subdomain, onPaid]);

  const open = async (make: (sub: string) => Promise<{ url: string }>) => {
    setBusy(true);
    setError("");
    try {
      const { url } = await make(membership.subdomain);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "お支払いの画面を開けませんでした");
      setBusy(false);
    }
  };

  if (!owner) {
    return (
      <Onboarding title={`${membership.name} はまだ利用を開始していません`} onSignOut={onSignOut} extra={switcher}>
        <p className="leading-relaxed">オーナーがお支払いを登録すると、使えるようになります。</p>
      </Onboarding>
    );
  }

  return (
    <Onboarding
      step={3}
      title="お支払いを登録して、利用を始めましょう"
      lead={<p>{membership.name} の月額料金を、クレジットカードで登録します。</p>}
      onSignOut={onSignOut}
      extra={switcher}
    >
      <div className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3">
        <span className="text-sm text-sub">料金</span>
        {priceLabel ? (
          <span className="font-display text-2xl font-bold text-button">{priceLabel}</span>
        ) : (
          <span className="leading-relaxed">次の画面に表示されます</span>
        )}
        <span className="text-sm text-sub">スタッフの人数で料金は増えません</span>
      </div>
      <ul className="flex flex-col gap-2">
        {["予約ページを公開して、お客様の予約を受け付けられます", "管理画面のすべての機能が使えます", "カードの変更や解約は「アカウント」からいつでもできます"].map((t) => (
          <li key={t} className="flex gap-2 text-sm leading-relaxed">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            {t}
          </li>
        ))}
      </ul>
      {checking ? <Notice>お支払いを確認しています…</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button onClick={() => void open(adminApi.checkout)} disabled={busy || checking}>
        {busy ? "お支払いの画面を開いています…" : "お支払いを登録する"}
      </Button>
      <p className="flex items-start gap-2 text-sm text-sub">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        お支払いは決済サービス Stripe の画面で行います。カード番号はヨヤクルに保存しません。
      </p>
      {manageable ? (
        <Button variant="secondary" onClick={() => void open(adminApi.billingPortal)} disabled={busy || checking}>
          カードの変更・領収書の確認
        </Button>
      ) : null}
    </Onboarding>
  );
}
