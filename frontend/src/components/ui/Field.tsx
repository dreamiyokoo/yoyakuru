"use client";

import { useId, useState } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  /** 入力欄の id。エラーの一覧から入力欄へ移るときに使う */
  id?: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  multiline?: boolean;
  autoComplete?: string;
  required?: boolean;
  /** 入力欄の後ろに続けて表示する固定の文字（例：.dreami.blog） */
  suffix?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

/**
 * ラベルを常に表示し、エラーは入力欄のすぐ下に出す（UX: visible labels / error near field）。
 * パスワードは表示・非表示を切り替えられる（UX: password visibility）。
 */
export function Field(props: Props) {
  const { label, value, onChange, onBlur, type = "text", placeholder, hint, error, multiline, autoComplete, required, suffix, inputMode } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const [shown, setShown] = useState(false);
  const password = type === "password";
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    placeholder,
    required,
    autoComplete,
    onBlur,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };
  const grouped = Boolean(suffix) || password;
  const inputClass = grouped
    ? "min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none"
    : `w-full rounded-lg border px-3 py-2.5 text-base ${error ? "border-danger" : "border-line"}`;
  const input = multiline ? (
    <textarea {...common} className={inputClass} rows={3} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input {...common} className={inputClass} type={password && shown ? "text" : type} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {grouped ? (
        // 入力欄と付属の部品をひとつの枠にまとめる。枠ごとにフォーカスの輪を出す
        <div
          className={`flex items-stretch overflow-hidden rounded-lg border bg-card focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-primary ${error ? "border-danger" : "border-line"}`}
        >
          {input}
          {suffix ? (
            <span aria-hidden className="flex shrink-0 items-center bg-muted px-3 text-sm text-sub">
              {suffix}
            </span>
          ) : null}
          {password ? (
            <button
              type="button"
              aria-pressed={shown}
              aria-label={shown ? "入力した文字を隠す" : "入力した文字を表示する"}
              onClick={() => setShown((s) => !s)}
              className="min-h-11 shrink-0 cursor-pointer px-3 text-sm font-bold text-button transition-colors duration-150 hover:bg-surface"
            >
              {shown ? "隠す" : "表示"}
            </button>
          ) : null}
        </div>
      ) : (
        input
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-sub">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
