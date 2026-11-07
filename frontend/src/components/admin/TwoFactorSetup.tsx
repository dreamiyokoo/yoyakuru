"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Me } from "@/lib/adminTypes";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";

/** 36 二段階認証の設定（LOGIN-07：任意）。QRコードを認証アプリで読み取り、表示された6桁で確認する。 */
export function TwoFactorSetup({ onDone }: { onDone: (me: Me) => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<(Me & { recovery_codes: string[] }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "設定できませんでした");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section aria-label="回復コード" className="flex flex-col gap-3">
        <h2 className="font-bold">二段階認証を設定しました</h2>
        <p className="text-sm">認証アプリを使えなくなったときのための回復コードです。各コードは1回だけ使えます。この画面を閉じると二度と表示しないので、安全な場所に保存してください。</p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
          {done.recovery_codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(done.recovery_codes.join("\n"))
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? "コピーしました" : "回復コードをコピーする"}
        </Button>
        <Button onClick={() => onDone(done)}>回復コードを保存しました</Button>
      </section>
    );
  }

  return (
    <section aria-label="二段階認証の設定" className="flex flex-col gap-3">
      <h2 className="font-bold">二段階認証を設定する</h2>
      <p className="text-sm">ログインのとき、パスワードに加えて、スマホの認証アプリ（Google Authenticator など）のコードを入力します。</p>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {setup ? (
        <>
          <ol className="flex flex-col gap-1 text-sm">
            <li>1. スマホに認証アプリ（Google Authenticator など）を入れる</li>
            <li>2. 認証アプリで、下のQRコードを読み取る</li>
            <li>3. 認証アプリに表示された6桁を入力する</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- サーバーが作ったQRコード（SVG） */}
          <img alt="認証アプリで読み取るQRコード" className="h-48 w-48 self-center" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`} />
          <p className="text-sm text-sub">
            QRコードを読み取れないときは、認証アプリに次の鍵を入力してください：<span className="break-all font-mono">{setup.secret}</span>
          </p>
          <a className="text-sm text-button underline" href={setup.uri}>
            このスマホの認証アプリで開く
          </a>
          <Field label="認証アプリに表示された6桁" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" required />
          <Button disabled={busy || !code.trim()} onClick={() => void run(async () => setDone(await adminApi.confirmTwoFactor(code.trim())))}>
            確認して有効にする
          </Button>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void run(async () => setSetup(await adminApi.setupTwoFactor()))}>
          設定を始める
        </Button>
      )}
    </section>
  );
}
