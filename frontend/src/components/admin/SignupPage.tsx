"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog";
const FIELDS = ["store_name", "subdomain", "name", "email", "password"] as const;
type FieldName = (typeof FIELDS)[number];

/** 店舗の新規登録。登録するとログインした状態になり、二段階認証 → お支払いへ進む。 */
export function SignupPage() {
  const router = useRouter();
  const { signedIn } = useAdmin();
  const [values, setValues] = useState<Record<FieldName, string>>({ store_name: "", subdomain: "", name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: FieldName) => (v: string) => setValues((s) => ({ ...s, [k]: k === "subdomain" ? v.toLowerCase().trim() : v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setErrors({});
    try {
      const me = await adminApi.signup({ ...values, email: values.email.trim() });
      signedIn(me);
      router.replace("/bookings");
    } catch (err) {
      const body = err instanceof ApiError ? err.body : undefined;
      const found: Partial<Record<FieldName, string>> = {};
      if (body && typeof body === "object") {
        for (const k of FIELDS) {
          const v = (body as Record<string, unknown>)[k];
          if (Array.isArray(v) && typeof v[0] === "string") found[k] = v.join(" ");
        }
      }
      setErrors(found);
      if (Object.keys(found).length === 0) setError(err instanceof ApiError ? err.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold text-button">ヨヤクルに登録する</h1>
        <p className="text-sm leading-relaxed text-sub">
          登録のあと、ログインを守る二段階認証の設定と、月額料金のお支払いの登録に進みます。
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="お店の名前" value={values.store_name} onChange={set("store_name")} error={errors.store_name} required />
        <Field
          label="予約ページのURL"
          value={values.subdomain}
          onChange={set("subdomain")}
          error={errors.subdomain}
          hint={`お客様が開く予約ページは https://${values.subdomain || "（ここに入れた文字）"}.${BASE_DOMAIN} になります。英小文字・数字・ハイフンで3〜32文字`}
          autoComplete="off"
          required
        />
        <Field label="お名前" value={values.name} onChange={set("name")} error={errors.name} autoComplete="name" required />
        <Field label="メールアドレス" type="email" value={values.email} onChange={set("email")} error={errors.email} autoComplete="email" required />
        <Field
          label="パスワード"
          type="password"
          value={values.password}
          onChange={set("password")}
          error={errors.password}
          hint="8文字以上。よく使われるものや、メールアドレスに似たものは使えません"
          autoComplete="new-password"
          required
        />
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "登録しています…" : "登録する"}
        </Button>
      </form>
      <p className="text-center text-sm text-sub">
        登録済みの方は{" "}
        <Link href="/login" className="font-bold text-button underline">
          ログイン
        </Link>
      </p>
    </main>
  );
}
