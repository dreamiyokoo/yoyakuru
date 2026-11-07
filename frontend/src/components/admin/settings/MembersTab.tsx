"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi, type Invitation, type Member } from "@/lib/adminApi";
import { formatDateTime } from "@/lib/format";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { useAdmin } from "../AdminContext";
import { useLoad } from "../useLoad";
import type { StaffSetting } from "./StaffTab";
import { inputClass } from "./useSettingChange";

const ROLE = { owner: "オーナー", staff: "スタッフ" } as const;
const STATE: Record<Invitation["state"], string> = { open: "招待中", accepted: "参加済み", revoked: "取り消し", expired: "期限切れ" };

/** 37 メンバー（ADMIN-03）。招待・停止はオーナーのみ。スタッフは担当者と結びつけ、自分の予約だけを扱う。 */
export function MembersTab({ sub, staff, onChanged }: { sub: string; staff: StaffSetting[]; onChanged?: () => void }) {
  const { me } = useAdmin();
  const list = useLoad(`${sub}|members`, () => adminApi.setting<{ members: Member[]; invitations: Invitation[] }>(sub, "members"));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (list.error) return <p className="text-sm text-danger">{list.error}</p>;
  if (!list.data) return <p className="text-sm text-sub">読み込み中…</p>;
  const { members, invitations } = list.data;
  // 停止中のメンバーも担当者との結びつきは残るので、招待の選択肢から外す
  const linked = new Set(members.filter((m) => m.staff).map((m) => m.staff));

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(done);
      list.reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作できませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {message ? <Notice>{message}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <h2 className="text-sm font-bold">メンバー</h2>
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-4 py-2 text-sm">
            <span className={m.is_active ? "" : "text-sub"}>
              <span className="font-bold">{m.name || m.email}</span>
              <span className="ml-2 rounded-full bg-muted px-2 text-xs">{ROLE[m.role]}</span>
              {m.is_active ? "" : "（停止中）"}
              <span className="block text-xs text-sub">
                {m.email}
                {m.staff_name ? `・担当者：${m.staff_name}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <button
                type="button"
                disabled={busy}
                className="min-h-11 px-2 text-sub"
                onClick={() => void run(() => adminApi.setMemberActive(sub, m.id, !m.is_active), m.is_active ? "停止しました。" : "再開しました。")}
              >
                {m.is_active ? "停止" : "再開"}
              </button>
              {m.is_active && m.two_factor_enabled && m.email !== me?.email ? (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 px-2 text-xs text-danger"
                  onClick={() => {
                    // 端末と回復コードの両方を失ったメンバーのため。本人確認ができたときだけ行う
                    if (window.confirm(`${m.email} の二段階認証をリセットします。本人に確認しましたか？`))
                      void run(() => adminApi.resetMemberTwoFactor(sub, m.id), `${m.email} の二段階認証をリセットしました。次のログインはパスワードだけになります。`);
                  }}
                >
                  二段階認証をリセット
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <InviteForm staff={staff.filter((s) => s.is_active && !linked.has(s.id))} busy={busy} onInvite={(body) => void run(() => adminApi.invite(sub, body), `${body.email} に招待メールを送りました。`)} />
      {invitations.length ? (
        <>
          <h2 className="text-sm font-bold">招待</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>
                  {i.email}（{ROLE[i.role]}
                  {i.staff_name ? `・${i.staff_name}` : ""}）{STATE[i.state]}
                  {i.state === "open" ? <span className="block text-xs text-sub">期限：{formatDateTime(i.expires_at)}</span> : null}
                </span>
                {i.state === "open" ? (
                  <button type="button" disabled={busy} className="min-h-11 px-2 text-danger" onClick={() => void run(() => adminApi.revokeInvitation(sub, i.id), "招待を取り消しました。")}>
                    取り消す
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function InviteForm({ staff, busy, onInvite }: { staff: StaffSetting[]; busy: boolean; onInvite: (body: { email: string; role: string; staff: number | null; new_staff_name: string }) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "owner">("staff");
  const [who, setWho] = useState("new");
  const [name, setName] = useState("");
  const ready = email.includes("@") && (who !== "new" || name.trim() || role === "owner");
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <h2 className="text-sm font-bold">招待する</h2>
      <Field label="招待するひとのメールアドレス" type="email" value={email} onChange={setEmail} />
      <label className="flex flex-col gap-1 text-sm font-bold">
        権限
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as "staff" | "owner")}>
          <option value="staff">スタッフ（自分の予約と休みだけ）</option>
          <option value="owner">オーナー（すべての管理）</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold">
        担当者
        <select className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="new">新しい担当者として追加する</option>
          {role === "owner" ? <option value="none">担当者にしない（予約を受けない）</option> : null}
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </label>
      {who === "new" ? <Field label="担当者の表示名" value={name} onChange={setName} hint="お客様の予約ページに表示されます" /> : null}
      <Button
        variant="secondary"
        disabled={busy || !ready}
        onClick={() => {
          onInvite({ email: email.trim(), role, staff: who === "new" || who === "none" ? null : Number(who), new_staff_name: who === "new" ? name.trim() : "" });
          setEmail("");
          setName("");
        }}
      >
        招待メールを送る
      </Button>
      <p className="text-xs text-sub">招待のリンクは7日間有効です。</p>
    </section>
  );
}
