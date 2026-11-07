"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAdmin } from "./AdminContext";
import { Onboarding } from "./Onboarding";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog";
const FIELDS = ["store_name", "subdomain", "name", "email", "password"] as const;
type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

const LABELS: Record<FieldName, string> = {
  store_name: "お店の名前",
  subdomain: "予約ページのURL",
  name: "お名前",
  email: "メールアドレス",
  password: "パスワード",
};

/** 画面で確かめられることは送る前に確かめる（サーバーでも同じことを確かめる）。 */
export function check(field: FieldName, v: Values): string | undefined {
  const value = v[field].trim();
  if (!value) return `${LABELS[field]}を入力してください`;
  if (field === "subdomain" && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value))
    return "英小文字・数字・ハイフンで3〜32文字にしてください（先頭と最後はハイフン以外）";
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "メールアドレスの形が正しくありません";
  if (field === "password" && v.password.length < 8) return "パスワードは8文字以上にしてください";
  return undefined;
}

/** 店舗の新規登録。登録するとログインした状態になり、お支払いへ進む。 */
export function SignupPage() {
  const router = useRouter();
  const { signedIn } = useAdmin();
  const [values, setValues] = useState<Values>({ store_name: "", subdomain: "", name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // エラーの一覧は、送れなかったときだけ出す（入力中の確認では出さない）
  const [attempted, setAttempted] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  const set = (k: FieldName) => (v: string) => {
    setValues((s) => ({ ...s, [k]: k === "subdomain" ? v.toLowerCase().trim() : v }));
    // 直し始めたら、その欄のエラーは消す
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  // 入力を終えた欄から確かめる（UX: validate on blur）
  const blur = (k: FieldName) => () => {
    if (values[k]) setErrors((e) => ({ ...e, [k]: check(k, values) }));
  };
  const showErrors = (found: Errors) => {
    setErrors(found);
    setAttempted(true);
    // 送れなかったときは、エラーの一覧へ移る（UX: focusable error summary）
    requestAnimationFrame(() => summary.current?.focus());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const found: Errors = {};
    for (const k of FIELDS) {
      const msg = check(k, values);
      if (msg) found[k] = msg;
    }
    if (Object.keys(found).length) return showErrors(found);
    setBusy(true);
    try {
      const me = await adminApi.signup({ ...values, store_name: values.store_name.trim(), name: values.name.trim(), email: values.email.trim() });
      signedIn(me);
      router.replace("/bookings");
    } catch (err) {
      const body = err instanceof ApiError ? err.body : undefined;
      const fromServer: Errors = {};
      if (body && typeof body === "object") {
        for (const k of FIELDS) {
          const v = (body as Record<string, unknown>)[k];
          if (Array.isArray(v) && typeof v[0] === "string") fromServer[k] = v.join(" ");
        }
      }
      if (Object.keys(fromServer).length) showErrors(fromServer);
      else setError(err instanceof ApiError ? err.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const listed = FIELDS.filter((k) => errors[k]);
  const field = (k: FieldName) => ({ id: `signup-${k}`, label: LABELS[k], value: values[k], onChange: set(k), onBlur: blur(k), error: errors[k], required: true });

  return (
    <Onboarding
      step={1}
      title="ヨヤクルに登録する"
      lead={<p>登録のあと、お支払いの登録に進みます。登録だけでは料金はかかりません。</p>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {attempted && listed.length ? (
          <div ref={summary} tabIndex={-1} role="alert" aria-labelledby="signup-errors" className="flex flex-col gap-1 rounded-xl border-2 border-danger bg-card p-3">
            <p id="signup-errors" className="text-sm font-bold text-danger">
              入力を確認してください（{listed.length}件）
            </p>
            <ul className="flex flex-col gap-0.5 text-sm">
              {listed.map((k) => (
                <li key={k}>
                  <a href={`#signup-${k}`} className="text-danger underline">
                    {errors[k]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Field {...field("store_name")} autoComplete="organization" />
        <Field
          {...field("subdomain")}
          suffix={`.${BASE_DOMAIN}`}
          hint="お客様が開く予約ページのURLです。英小文字・数字・ハイフンで3〜32文字"
          autoComplete="off"
          placeholder="komorebi"
        />
        <Field {...field("name")} autoComplete="name" />
        <Field {...field("email")} type="email" inputMode="email" autoComplete="email" hint="ログインとお知らせに使います" />
        <Field {...field("password")} type="password" autoComplete="new-password" hint="8文字以上。よく使われるものや、メールアドレスに似たものは使えません" />
        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "登録しています…" : "登録して次へ"}
        </Button>
      </form>
      <p className="text-center text-sm text-sub">
        登録済みの方は{" "}
        <Link href="/login" className="font-bold text-button underline">
          ログイン
        </Link>
      </p>
    </Onboarding>
  );
}
