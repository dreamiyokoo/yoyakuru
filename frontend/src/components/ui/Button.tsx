import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ variant = "primary", className = "", ...props }: Props) {
  const base =
    "inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 text-base font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-button text-white hover:bg-button-hover"
      : "border-[1.5px] border-button bg-card text-button hover:bg-surface";
  return <button type="button" className={`${base} ${styles} ${className}`} {...props} />;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const styles =
    variant === "primary" ? "bg-button text-white hover:bg-button-hover" : "border-[1.5px] border-button bg-card text-button";
  return (
    <a href={href} className={`inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 font-bold ${styles}`}>
      {children}
    </a>
  );
}
