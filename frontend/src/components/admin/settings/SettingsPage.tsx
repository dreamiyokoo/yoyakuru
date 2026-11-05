"use client";

import { useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { toDateKey } from "@/lib/format";
import { Notice } from "../../ui/Notice";
import { useAdmin } from "../AdminContext";
import { AdminShell } from "../AdminShell";
import { useLoad } from "../useLoad";
import { HoursTab } from "./HoursTab";
import { ResourcesTab } from "./ResourcesTab";
import { RulesTab } from "./RulesTab";
import { ServicesTab } from "./ServicesTab";
import { SetupTab } from "./SetupTab";
import { StaffTab, type StaffSetting } from "./StaffTab";

const TABS = [
  { id: "setup", label: "AIで設定" },
  { id: "rules", label: "予約ルール" },
  { id: "hours", label: "営業時間" },
  { id: "services", label: "サービス" },
  { id: "staff", label: "担当者" },
  { id: "resources", label: "設備" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** 10 設定。項目をタブで切り替え、1画面に収める（スクロールを少なく）。オーナーのみ。
 * 店舗を切り替えたら、編集中の内容や確認中の変更を捨てる（key で作り直す）。 */
export function SettingsPage({ today = toDateKey(new Date()) }: { today?: string }) {
  const { membership } = useAdmin();
  return (
    <AdminShell title="設定">
      {(sub) => (membership?.role === "owner" ? <Body key={sub} sub={sub} today={today} /> : <Notice>設定はオーナーのみ変更できます。</Notice>)}
    </AdminShell>
  );
}

function Body({ sub, today }: { sub: string; today: string }) {
  const [tab, setTab] = useState<Tab>("setup");
  const staff = useLoad(`${sub}|staff-names`, () => adminApi.setting<StaffSetting[]>(sub, "staff"));
  return (
    <>
      <div role="tablist" aria-label="設定の項目" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm ${tab === t.id ? "bg-button font-bold text-white" : "border border-line text-sub"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} className="flex flex-col gap-3">
        {tab === "setup" ? <SetupTab sub={sub} onChanged={staff.reload} /> : null}
        {tab === "rules" ? <RulesTab sub={sub} /> : null}
        {tab === "hours" ? <HoursTab sub={sub} staff={staff.data ?? []} today={today} /> : null}
        {tab === "services" ? <ServicesTab sub={sub} staff={(staff.data ?? []).filter((s) => s.is_active)} /> : null}
        {tab === "staff" ? <StaffTab sub={sub} today={today} onChanged={staff.reload} /> : null}
        {tab === "resources" ? <ResourcesTab sub={sub} /> : null}
      </div>
    </>
  );
}
