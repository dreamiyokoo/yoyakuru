import type { ReactNode } from "react";

interface Props {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  name: string;
}

/** 選択式のカード。ラジオボタンとして読み上げられる。 */
export function ChoiceCard({ selected, onSelect, children, name }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      onClick={onSelect}
      className={`w-full rounded-xl px-4 py-3 text-left transition-colors duration-200 ${
        selected ? "border-2 border-button bg-surface" : "border border-line bg-card hover:bg-surface"
      }`}
    >
      {children}
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
      className={`min-h-11 rounded-full px-4 text-sm font-bold ${
        selected ? "bg-button text-white" : "border border-line bg-card text-ink"
      }`}
    >
      {children}
    </button>
  );
}
