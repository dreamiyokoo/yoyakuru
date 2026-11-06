"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";
import { AdminShell } from "./AdminShell";
import { TwoFactorSetup } from "./TwoFactorSetup";

/** 39 アカウント。二段階認証の回復コードの再発行と、認証アプリの変更（端末の買い替え・紛失）。 */
export function AccountPage() {
  return <AdminShell title="アカウント">{() => <Body />}</AdminShell>;
}

function Body() {
  const { me, signedIn } = useAdmin();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  if (!me) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setCode("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作できませんでした");
    } finally {
      setBusy(false);
    }
  };

  if (setup) return <TwoFactorSetup onDone={(m) => { signedIn(m); setSetup(false); setMessage("二段階認証を設定しました。"); }} />;

  return (
    <>
      <p className="text-sm">
        <span className="font-bold">{me.name || me.email}</span>
        <span className="block text-sub">{me.email}</span>
      </p>
      {message ? <Notice>{message}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <section aria-label="二段階認証" className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
        <h2 className="text-sm font-bold">二段階認証：{me.two_factor_enabled ? "設定済み" : "未設定"}</h2>
        {me.two_factor_enabled ? (
          <>
            <Field label="認証アプリの6桁（または回復コード）" value={code} onChange={setCode} autoComplete="one-time-code" hint="本人確認のため、下の操作の前に入力してください" />
            <Button variant="secondary" disabled={busy || !code.trim()} onClick={() => void run(async () => setCodes((await adminApi.regenerateRecoveryCodes(code.trim())).recovery_codes))}>
              回復コードを作り直す
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !code.trim()}
              onClick={() =>
                void run(async () => {
                  const next = await adminApi.resetTwoFactor(code.trim());
                  setCodes(null);
                  signedIn(next);
                  if (next.two_factor_required) setSetup(true); // オーナーはすぐに新しい端末で設定し直す
                  else setMessage("二段階認証を外しました。");
                })
              }
            >
              認証アプリを変更する（新しい端末で設定し直す）
            </Button>
            <p className="text-xs text-sub">端末を失くして回復コードもない場合は、ほかのオーナーに「設定 → メンバー」からリセットを依頼してください。</p>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setSetup(true)}>
            二段階認証を設定する
          </Button>
        )}
        {codes ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">新しい回復コードです。古い回復コードは使えなくなりました。この画面を離れると二度と表示しないので、安全な場所に保存してください。</p>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}
