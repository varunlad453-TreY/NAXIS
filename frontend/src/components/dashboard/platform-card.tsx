"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface PlatformCardProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  description: string;
  stat?: { value: string; label: string };
  active: boolean;
  accentRgb: string;
  tag: string;
  delay: number;
}

export function PlatformCard({
  href,
  icon,
  label,
  sublabel,
  description,
  stat,
  active,
  accentRgb,
  tag,
  delay,
}: PlatformCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-4 rounded-xl border border-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-border hover:bg-surface"
      style={{
        opacity: active ? 1 : 0.4,
        pointerEvents: active ? "auto" : "none",
        animation: `naxis-enter 0.6s ${delay}s both`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{
            background: `rgba(${accentRgb},0.1)`,
            color: `rgb(${accentRgb})`,
          }}
        >
          {icon}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: `rgb(${accentRgb})`,
              background: `rgba(${accentRgb},0.08)`,
            }}
          >
            {tag}
          </span>
          {!active && (
            <span className="rounded-full border border-border/40 px-2 py-0.5 text-[10px] text-foreground-subtle">
              Soon
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-foreground-subtle">
          {sublabel}
        </p>
        <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
          {label}
        </h3>
        <p className="text-xs leading-relaxed text-foreground-muted">{description}</p>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        {stat ? (
          <div>
            <span className="font-mono text-sm font-semibold" style={{ color: `rgb(${accentRgb})` }}>
              {stat.value}
            </span>
            <span className="ml-1.5 text-[10px] text-foreground-subtle">{stat.label}</span>
          </div>
        ) : (
          <span className="text-[10px] text-foreground-subtle">Awaiting credentials</span>
        )}
        {active && (
          <ChevronRight
            className="h-4 w-4 text-foreground-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
          />
        )}
      </div>
    </Link>
  );
}
