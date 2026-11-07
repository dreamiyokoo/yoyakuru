"use client";

import Link from "next/link";
import { Notice } from "../ui/Notice";
import { GOOGLE_ERRORS, GoogleButton, GoogleScopeNote } from "./GoogleButton";
import { Onboarding } from "./Onboarding";

/** 24 ログイン。Googleアカウントだけで入る（パスワードはありません）。 */
export function LoginPage({ error }: { error?: string }) {
  return (
    <Onboarding title="ログイン" lead={<p>Googleアカウントでログインします。</p>}>
      {error ? <Notice tone="warn">{GOOGLE_ERRORS[error] ?? GOOGLE_ERRORS.failed}</Notice> : null}
      <GoogleButton intent={{ kind: "login" }} label="Googleでログイン" />
      <GoogleScopeNote />
      <p className="text-center text-sm text-sub">
        はじめての方は{" "}
        <Link href="/signup" className="font-bold text-button underline">
          新規登録
        </Link>
      </p>
    </Onboarding>
  );
}
