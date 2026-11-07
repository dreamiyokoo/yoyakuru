"use client";

import { Notice } from "../ui/Notice";
import { GoogleButton, GoogleScopeNote } from "./GoogleButton";
import { useLoad } from "./useLoad";
import { adminApi } from "@/lib/adminApi";

/** 38 招待の受け入れ。招待されたメールアドレスのGoogleアカウントでログインして、店舗に参加する。 */
export function InvitePage({ token }: { token: string }) {
  const info = useLoad(`invite|${token}`, () => adminApi.invitation(token));
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-2xl font-bold text-button">ヨヤクルへの招待</h1>
      {info.error ? <Notice tone="warn">{info.error}</Notice> : null}
      {info.data ? (
        <>
          <p className="text-sm">
            <span className="font-bold">{info.data.tenant}</span>に、{info.data.role === "owner" ? "オーナー" : "スタッフ"}として参加します
            {info.data.staff_name ? `（担当者：${info.data.staff_name}）` : ""}。
          </p>
          <p className="text-sm text-sub">
            招待されたメールアドレス：<span className="font-bold text-ink">{info.data.email}</span>
            <span className="block">このメールアドレスのGoogleアカウントでログインしてください。</span>
          </p>
          <GoogleButton intent={{ kind: "invite", token }} label="Googleで参加する" />
          <GoogleScopeNote />
        </>
      ) : null}
    </main>
  );
}
