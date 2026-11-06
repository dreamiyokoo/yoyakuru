"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Me, Membership } from "@/lib/adminTypes";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";

/**
 * 月額の支払いが済んでいない店舗の案内（BILL-01）。
 * オーナーは Stripe の支払い画面へ進む。支払い画面から戻ったら（?checkout_session=）、その場で状態を確かめる。
 */
export function BillingRequired({ membership, onPaid }: { membership: Membership; onPaid: (me: Me) => void }) {
  const owner = membership.role === "owner";
  // 支払い画面から戻ったときの印。管理画面はログインの確認後にブラウザだけで描くので、ここで URL を読める
  const [session] = useState(() =>
    owner && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("checkout_session") : null,
  );
  const [checking, setChecking] = useState(Boolean(session));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      try {
        const billing = await adminApi.billing(membership.subdomain, session);
        if (!active) return;
        if (billing.usable) {
          window.history.replaceState(null, "", window.location.pathname);
          onPaid(await adminApi.me());
        } else {
          setError("お支払いの確認に時間がかかっています。少し待ってから、画面を読み込み直してください。");
        }
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : "お支払いを確認できませんでした");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, membership.subdomain, onPaid]);

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await adminApi.checkout(membership.subdomain);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "お支払いの画面を開けませんでした");
      setBusy(false);
    }
  };

  if (!owner) {
    return (
      <section aria-label="お支払い" className="flex flex-col gap-2 rounded-xl border border-line px-4 py-4">
        <h2 className="font-bold">{membership.name} はまだ利用を開始していません</h2>
        <p className="text-sm text-sub">オーナーがお支払いを登録すると使えるようになります。</p>
      </section>
    );
  }

  return (
    <section aria-label="お支払い" className="flex flex-col gap-4 rounded-xl border border-line px-4 py-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-bold">お支払いを登録して、利用を始めましょう</h2>
        <p className="text-sm leading-relaxed text-sub">
          {membership.name} の月額料金のお支払いを、クレジットカードで登録します。お支払いは決済サービスの Stripe
          の画面で行い、カード番号はヨヤクルに保存しません。料金は次の画面に表示されます。
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>・登録が済むと、予約ページの公開と管理画面のすべての機能が使えます</li>
          <li>・カードの変更や解約は「アカウント」からいつでもできます</li>
        </ul>
      </div>
      {checking ? <Notice>お支払いを確認しています…</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button onClick={() => void pay()} disabled={busy || checking}>
        {busy ? "お支払いの画面を開いています…" : "お支払いを登録する"}
      </Button>
    </section>
  );
}
