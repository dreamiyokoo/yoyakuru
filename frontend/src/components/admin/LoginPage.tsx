"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      signedIn(await adminApi.login(email.trim(), password));
      router.replace("/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ログインできませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-2xl font-bold text-button">ヨヤクル 管理画面</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="username" required />
        <Field label="パスワード" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "ログインしています…" : "ログイン"}
        </Button>
      </form>
    </main>
  );
}
