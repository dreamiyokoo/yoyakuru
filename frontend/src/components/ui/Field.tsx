import { useId } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  multiline?: boolean;
  autoComplete?: string;
  required?: boolean;
}

/** ラベルを常に表示し、エラーは入力欄のすぐ下に出す（UX: visible labels / error near field）。 */
export function Field({ label, value, onChange, type = "text", placeholder, hint, error, multiline, autoComplete, required }: Props) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    placeholder,
    required,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: `w-full rounded-lg border px-3 py-2.5 text-base ${error ? "border-danger" : "border-line"}`,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-sub">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-bold text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
