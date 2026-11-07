"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";
import { AdminShell } from "./AdminShell";
import { GoogleButton } from "./GoogleButton";

/** 39 アカウント。ログインしているGoogleアカウントと、カレンダーの接続の状態、お支払いの管理。 */
export function AccountPage() {
  return <AdminShell title="アカウント">{() => <Body />}</AdminShell>;
}

function Body() {
  const { me, membership } = useAdmin();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const openPortal = async (subdomain: string) => {
    setBusy(true);
    setError("");
    try {
      window.location.assign((await adminApi.billingPortal(subdomain)).url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作できませんでした");
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm">
        <span className="font-bold">{me.name || me.email}</span>
        <span className="block text-sub">{me.email}（Googleアカウント）</span>
      </p>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <section aria-label="Googleカレンダー" className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">Googleカレンダー：{me.calendar_connected ? "接続済み" : "接続が切れています"}</h2>
        {me.calendar_connected ? (
          <p className="text-sm text-sub">カレンダーの予定がある時間は予約を受け付けず、予約が入るとカレンダーに予定を登録します。</p>
        ) : (
          <>
            <Notice tone="warn">接続が切れているあいだ、あなたの予約枠は公開ページに出ません。もう一度ログインして、カレンダーを許可してください。</Notice>
            <GoogleButton intent={{ kind: "login" }} label="Googleでつなぎ直す" />
          </>
        )}
      </section>
      {membership?.role === "owner" && membership.billing_managed ? (
        <section aria-label="お支払い" className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
          <h2 className="text-sm font-bold">お支払い（{membership.name}）</h2>
          <p className="text-sm text-sub">カードの変更、領収書の確認、解約は Stripe の画面で行います。</p>
          <Button variant="secondary" disabled={busy} onClick={() => void openPortal(membership.subdomain)}>
            お支払いの管理を開く
          </Button>
        </section>
      ) : null}
    </>
  );
}
