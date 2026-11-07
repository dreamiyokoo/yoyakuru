import type { ReactNode } from "react";

const STEPS = ["登録", "二段階認証", "お支払い"];

/**
 * 利用開始までの画面（登録 → 二段階認証 → お支払い）の枠。
 * 管理画面のタブは、使えるようになるまで出さない。今どこにいるかを常に示す（UX: progress indicators）。
 */
export function Onboarding({ step, title, lead, onSignOut, children }: { step?: number; title: string; lead?: ReactNode; onSignOut?: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex items-center justify-between px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- 文字を含むSVGロゴは最適化の対象外 */}
        <img src="/brand/logo.svg" alt="ヨヤクル" width={116} height={32} className="h-8 w-auto" />
        {onSignOut ? (
          <button type="button" onClick={onSignOut} className="min-h-11 cursor-pointer px-2 text-sm text-sub underline">
            ログアウト
          </button>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pb-10 pt-2">
        {step ? <Steps current={step} /> : null}
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold leading-snug text-ink">{title}</h1>
          {lead ? <div className="leading-relaxed text-sub">{lead}</div> : null}
        </div>
        <div className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-sm">{children}</div>
      </main>
    </div>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <nav aria-label={`利用開始までの手順（${STEPS.length}つのうち${current}つ目）`}>
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "todo";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${state === "todo" ? "bg-line" : "bg-button"}`} />
              <span className={`text-xs ${state === "current" ? "font-bold text-ink" : "text-sub"}`}>
                {n}. {label}
                {state === "done" ? <span className="sr-only">（済み）</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
