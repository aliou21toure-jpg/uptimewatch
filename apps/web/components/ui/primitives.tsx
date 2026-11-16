import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-500 text-neutral-950 hover:bg-emerald-400 disabled:bg-emerald-500/50",
  secondary: "border border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800",
  ghost: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
  danger: "text-red-400 hover:bg-red-500/10",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-100",
        "placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-9 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="text-sm font-medium text-neutral-300" {...props} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-neutral-800 bg-neutral-900/60 p-6", className)}>{children}</div>;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-red-500/30 bg-red-500/10 text-red-300",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
