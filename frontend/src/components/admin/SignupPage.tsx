"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Field } from "../ui/Field";
import { GoogleButton, GoogleScopeNote } from "./GoogleButton";
import { Onboarding } from "./Onboarding";

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "dreami.blog";
const FIELDS = ["store_name", "subdomain"] as const;
type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;

const LABELS: Record<FieldName, string> = { store_name: "お店の名前", subdomain: "予約ページのURL" };

/** 画面で確かめられることは確かめる（サーバーでも、Googleに移る前に同じことを確かめる）。 */
export function check(field: FieldName, v: Values): string | undefined {
  const value = v[field].trim();
  if (!value) return `${LABELS[field]}を入力してください`;
  if (field === "subdomain" && !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value))
    return "英小文字・数字・ハイフンで3〜32文字にしてください（先頭と最後はハイフン以外）";
  return undefined;
}

/** 店舗の新規登録。お店の名前とURLを決め、Googleアカウントで登録する。そのあとお支払いへ進む。 */
export function SignupPage() {
  const [values, setValues] = useState<Values>({ store_name: "", subdomain: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const ref = useRef<HTMLDivElement>(null);
  const set = (k: FieldName) => (v: string) => {
    setValues((s) => ({ ...s, [k]: k === "subdomain" ? v.toLowerCase().trim() : v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  // 入力を終えた欄から確かめる（UX: validate on blur）
  const blur = (k: FieldName) => () => {
    if (values[k]) setErrors((e) => ({ ...e, [k]: check(k, values) }));
  };
  const ready = FIELDS.every((k) => !check(k, values));
  const field = (k: FieldName) => ({ id: `signup-${k}`, label: LABELS[k], value: values[k], onChange: set(k), onBlur: blur(k), error: errors[k], required: true });

  return (
    <Onboarding step={1} title="ヨヤクルに登録する" lead={<p>お店の名前とURLを決めて、Googleアカウントで登録します。登録だけでは料金はかかりません。</p>}>
      <div ref={ref} className="flex flex-col gap-4">
        <Field {...field("store_name")} autoComplete="organization" />
        <Field
          {...field("subdomain")}
          suffix={`.${BASE_DOMAIN}`}
          hint="お客様が開く予約ページのURLです。英小文字・数字・ハイフンで3〜32文字"
          autoComplete="off"
          placeholder="komorebi"
        />
        <GoogleButton
          intent={{ kind: "signup", store_name: values.store_name.trim(), subdomain: values.subdomain }}
          label="Googleで登録する"
          disabled={!ready}
        />
        <GoogleScopeNote />
      </div>
      <p className="text-center text-sm text-sub">
        登録済みの方は{" "}
        <Link href="/login" className="font-bold text-button underline">
          ログイン
        </Link>
      </p>
    </Onboarding>
  );
}
