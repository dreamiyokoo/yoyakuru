"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";
import { useLoad } from "./useLoad";

/** 38 招待の受け入れ。アカウントがなければパスワードを決め、あればそのパスワードで参加する。 */
export function InvitePage({ token }: { token: string }) {
  const router = useRouter();
  const { signedIn } = useAdmin();
  const info = useLoad(`invite|${token}`, () => adminApi.invitation(token));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      signedIn(await adminApi.acceptInvitation(token, password, name.trim()));
      router.replace("/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "参加できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-2xl font-bold text-button">ヨヤクルへの招待</h1>
      {info.error ? <Notice tone="warn">{info.error}</Notice> : null}
      {info.data ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-bold">{info.data.tenant}</span>に、{info.data.role === "owner" ? "オーナー" : "スタッフ"}として参加します
            {info.data.staff_name ? `（担当者：${info.data.staff_name}）` : ""}。
          </p>
          <p className="text-sm text-sub">{info.data.email}</p>
          {info.data.has_account ? (
            <Field label="パスワード" type="password" value={password} onChange={setPassword} autoComplete="current-password" hint="このメールアドレスのアカウントがあります。そのパスワードを入力してください" required />
          ) : (
            <>
              <Field label="お名前" value={name} onChange={setName} autoComplete="name" />
              <Field label="パスワードを決める" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="10文字以上で、推測されにくいものにしてください" required />
            </>
          )}
          {info.data.role === "owner" ? <p className="text-xs text-sub">オーナーは、参加の後に二段階認証の設定が必要です。</p> : null}
          {error ? <Notice tone="warn">{error}</Notice> : null}
          <Button type="submit" disabled={busy || !password}>
            {busy ? "参加しています…" : "参加する"}
          </Button>
        </form>
      ) : null}
    </main>
  );
}
