import type { ReactNode } from "react";
import { ChevronLeft } from "./icons";

interface Props {
  title: string;
  onBack?: () => void;
  step?: { current: number; total: number; label: string };
  footer?: ReactNode;
  children: ReactNode;
}

/** 1画面1操作のステップ式画面（UI-01〜03）。 */
export function Screen({ title, onBack, step, footer, children }: Props) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-card">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card px-4 pb-3 pt-4">
        {onBack ? (
          <button type="button" onClick={onBack} className="-ml-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-surface" aria-label="戻る">
            <ChevronLeft />
          </button>
        ) : null}
        <h1 className="font-display text-lg font-bold">{title}</h1>
      </header>
      {step ? (
        <div className="px-4 pt-3" aria-label="進み具合">
          <p className="text-sm font-bold text-sub">
            ステップ {step.current}/{step.total}　{step.label}
          </p>
          <div className="mt-1.5 flex gap-1" aria-hidden="true">
            {Array.from({ length: step.total }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < step.current ? "bg-button" : "bg-line"}`} />
            ))}
          </div>
        </div>
      ) : null}
      <main className="flex flex-1 flex-col gap-3 px-4 py-4">{children}</main>
      {footer ? <footer className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-card px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">{footer}</footer> : null}
    </div>
  );
}
