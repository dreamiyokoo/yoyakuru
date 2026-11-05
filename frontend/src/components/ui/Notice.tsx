import type { ReactNode } from "react";

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div role={tone === "warn" ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${tone === "warn" ? "border-2 border-ink bg-muted" : "bg-muted"}`}>
      {children}
    </div>
  );
}

export function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="rounded-xl border border-line px-4 py-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-1.5">
          <dt className="text-sm text-sub">{k}</dt>
          <dd className="text-right text-sm font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
