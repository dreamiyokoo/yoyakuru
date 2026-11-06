"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import type { Me } from "@/lib/adminTypes";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";

/** 24 ログイン。 */
export function LoginPage() {
  const router = useRouter();
  const { signedIn } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = needsCode ? await adminApi.loginCode(code.trim()) : await adminApi.login(email.trim(), password);
      if ("two_factor_required" in res && !("email" in res)) {
        setNeedsCode(true); // パスワードは合っている。認証アプリのコードを求める
        return;
      }
      signedIn(res as Me);
      router.replace("/bookings");
    } catch (err) {
      if (err instanceof ApiError && err.code === "expired") {
        setNeedsCode(false); // 時間切れ。パスワードからやり直してもらう
        setCode("");
      }
      setError(err instanceof ApiError ? err.message : "ログインできませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-2xl font-bold text-button">ヨヤクル 管理画面</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {needsCode ? (
          <Field
            label="確認コード"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            hint="認証アプリに表示される6桁の数字です。認証アプリを使えないときは、回復コードを入力してください"
            required
          />
        ) : (
          <>
            <Field label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="username" required />
            <Field label="パスワード" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          </>
        )}
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "ログインしています…" : needsCode ? "確認する" : "ログイン"}
        </Button>
        {needsCode ? (
          <button
            type="button"
            className="min-h-11 text-sm text-sub underline"
            onClick={() => {
              setNeedsCode(false);
              setCode("");
              setError("");
            }}
          >
            パスワードの入力に戻る
          </button>
        ) : null}
      </form>
      {needsCode ? null : (
        <p className="text-center text-sm text-sub">
          はじめての方は{" "}
          <Link href="/signup" className="font-bold text-button underline">
            新規登録
          </Link>
        </p>
      )}
    </main>
  );
}
