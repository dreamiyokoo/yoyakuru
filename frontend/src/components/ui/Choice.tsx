import type { ReactNode } from "react";
import { Check } from "./icons";

interface Props {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  name: string;
}

/** 選択式のカード。ラジオボタンとして読み上げられる。選択中は色だけでなく、チェックの印でも示す（UX: color not only）。 */
export function ChoiceCard({ selected, onSelect, children, name }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors duration-200 ${
        selected ? "border-2 border-button bg-surface" : "border border-line bg-card hover:bg-surface"
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col">{children}</span>
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${selected ? "bg-button text-white" : "border-2 border-line"}`}
      >
        {selected ? <Check className="h-4 w-4" /> : null}
      </span>
    </button>
  );
}

export function Chip({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`min-h-11 cursor-pointer rounded-full px-4 text-sm font-bold transition-colors duration-200 ${
        selected ? "bg-button text-white" : "border border-line bg-card text-ink"
      }`}
    >
      {children}
    </button>
  );
}
