"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/adminApi";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { useLoad } from "../useLoad";
import type { StaffSetting } from "./StaffTab";
import { inputClass, useSettingChange } from "./useSettingChange";

export interface SetupStep {
  label: string;
  path: string;
  method: string;
  body: unknown;
  /** この手順で作ったもののIDを、後の手順が {"$ref": ref} で使う */
  ref?: string;
}
interface Plan {
  reply?: string;
  steps: SetupStep[];
  notes: string[];
}
interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** 後の手順にある参照（{"$ref": ...}）を、反映済みのIDに置き換える。 */
export function resolveRefs(body: unknown, refs: Record<string, number>, staffIds: number[]): unknown {
  if (Array.isArray(body)) return body.map((x) => resolveRefs(x, refs, staffIds));
  if (body && typeof body === "object") {
    const ref = (body as { $ref?: string }).$ref;
    if (ref === "all_staff") return staffIds;
    if (ref) return refs[ref] ?? null;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, resolveRefs(v, refs, staffIds)]));
  }
  return body;
}

/**
 * 34 AIで設定（SETUP-01〜05、08）。業種テンプレートか、店舗の様子を書くと設定案が手順で並ぶ。
 * 手順は1つずつ確認してから反映し、予約に影響があれば保存前に一覧で確認する。
 */
export function SetupTab({ sub, onChanged }: { sub: string; onChanged?: () => void }) {
  const templates = useLoad(`${sub}|templates`, () => adminApi.setting<{ key: string; label: string }[]>(sub, "templates"));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (load: () => Promise<Plan>) => {
    setBusy(true);
    setError("");
    try {
      setPlan(await load());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "設定案を作れませんでした");
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    void run(async () => {
      const res = await adminApi.setupAssistant(sub, message, turns.slice(-8)); // サーバーが使うのは直近8件
      setTurns([...turns, { role: "user", content: message }, { role: "assistant", content: res.reply }]);
      return res;
    });
  };

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">業種のテンプレートから始める</h2>
        <div role="group" aria-label="業種のテンプレート" className="flex flex-wrap gap-2">
          {templates.data?.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={busy}
              className="min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => void run(() => adminApi.setting<Plan>(sub, `templates/${t.key}`))}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">ことばで伝える</h2>
        <div role="log" aria-live="polite" className="flex flex-col gap-1 text-sm">
          {turns.map((t, i) => (
            <p key={i} className={t.role === "user" ? "self-end rounded-lg bg-muted px-3 py-1" : ""}>
              {t.content}
            </p>
          ))}
        </div>
        <textarea
          aria-label="店舗の様子"
          rows={3}
          maxLength={1000}
          className={inputClass}
          placeholder="例：スタッフ3人、ベッド2台、10時〜20時、昼休み13〜14時、初回90分・再来60分"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button variant="secondary" disabled={busy || !text.trim()} onClick={ask}>
          {busy ? "考えています…" : "設定案を作る"}
        </Button>
        <p className="text-xs text-sub">AIは設定を直接変えません。案を1つずつ確認してから反映します。契約・支払い・権限はAIから変えられません。</p>
      </section>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {plan ? <StepRunner key={JSON.stringify(plan.steps)} sub={sub} plan={plan} onChanged={onChanged} /> : null}
    </>
  );
}

function StepRunner({ sub, plan, onChanged }: { sub: string; plan: Plan; onChanged?: () => void }) {
  const [index, setIndex] = useState(0);
  const [refs, setRefs] = useState<Record<string, number>>({});
  const [done, setDone] = useState<{ label: string; applied: boolean }[]>([]);
  const { change, busy, ui, cancel } = useSettingChange(sub);
  const step = plan.steps[index];

  const next = (applied: boolean) => {
    if (!applied) cancel(); // 確認待ちのまま飛ばした変更を、次の手順に持ち越さない
    setDone((d) => [...d, { label: step.label, applied }]);
    setIndex((i) => i + 1);
  };

  const apply = async () => {
    const staff = await adminApi.setting<StaffSetting[]>(sub, "staff").catch(() => [] as StaffSetting[]);
    const body = resolveRefs(step.body, refs, staff.filter((s) => s.is_active).map((s) => s.id));
    void change(step.path, step.method, body, (result) => {
      const id = (result as { id?: number } | null)?.id;
      if (step.ref && typeof id === "number") setRefs((r) => ({ ...r, [step.ref as string]: id }));
      onChanged?.();
      next(true);
    });
  };

  return (
    <section aria-label="設定案" className="flex flex-col gap-2 rounded-xl border-2 border-ink p-4">
      {plan.notes.map((n) => (
        <Notice key={n} tone="warn">
          {n}
        </Notice>
      ))}
      {plan.steps.length === 0 ? <p className="text-sm text-sub">変更する項目はありません。</p> : null}
      <ol className="flex flex-col gap-1 text-sm">
        {done.map((d, i) => (
          <li key={i} className="text-sub">
            {d.applied ? "✓ 反映" : "– スキップ"}：{d.label}
          </li>
        ))}
      </ol>
      {step ? (
        <>
          <p className="text-xs text-sub">
            手順 {index + 1} / {plan.steps.length}
          </p>
          <p className="font-bold">{step.label}</p>
          {ui}
          <Button disabled={busy} onClick={() => void apply()}>
            反映する
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => next(false)}>
            スキップ
          </Button>
        </>
      ) : plan.steps.length ? (
        <Notice>設定案の確認が終わりました。各タブで、いつでも変更できます。</Notice>
      ) : null}
    </section>
  );
}
