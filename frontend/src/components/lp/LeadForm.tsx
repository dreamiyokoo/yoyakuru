"use client";

import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";

const INDUSTRIES = ["整体・治療院", "美容院・サロン", "教室・スクール", "その他"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 先行導入の申し込み。 */
export function LeadForm() {
  const [v, setV] = useState({ store_name: "", name: "", email: "", phone: "", industry: INDUSTRIES[0], website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!v.store_name.trim()) next.store_name = "お店の名前を入力してください";
    if (!v.name.trim()) next.name = "お名前を入力してください";
    if (!EMAIL_RE.test(v.email.trim())) next.email = "メールアドレスを正しく入力してください";
    setErrors(next);
    if (Object.keys(next).length) return;
    setState("sending");
    setError("");
    try {
      await request("/api/v1/public/leads", { method: "POST", body: JSON.stringify({ ...v, email: v.email.trim() }) });
      setState("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "送信できませんでした");
      setState("idle");
    }
  };

  if (state === "sent") {
    return <Notice>お申し込みありがとうございます。担当者から、ご入力のメールアドレスにご連絡します。</Notice>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="お店の名前" value={v.store_name} onChange={set("store_name")} error={errors.store_name} required />
      <Field label="お名前" value={v.name} onChange={set("name")} autoComplete="name" error={errors.name} required />
      <Field label="メールアドレス" type="email" value={v.email} onChange={set("email")} autoComplete="email" error={errors.email} required />
      <Field label="電話番号（任意）" type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" />
      <label className="flex flex-col gap-1.5 text-sm font-bold">
        業種
        <select className="rounded-lg border border-line px-3 py-2.5 text-base font-normal" value={v.industry} onChange={(e) => set("industry")(e.target.value)}>
          {INDUSTRIES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </label>
      {/* ボット対策の欄（人には見えない） */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={v.website} onChange={(e) => set("website")(e.target.value)} />
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "送信しています…" : "送信する"}
      </Button>
      <p className="text-xs text-sub">ご入力いただいた情報は、先行導入のご連絡にのみ使います。</p>
    </form>
  );
}
