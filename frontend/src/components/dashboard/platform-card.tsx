"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HudCorner } from "./hud-corner";

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
      className="group relative flex flex-col gap-4 overflow-hidden rounded-xl p-5 transition-all duration-500"
      style={{
        border: `1px solid rgba(${accentRgb},0.2)`,
        background: `radial-gradient(circle at 50% 0%, rgba(${accentRgb},0.06) 0%, transparent 70%)`,
        opacity: active ? 1 : 0.35,
        pointerEvents: active ? "auto" : "none",
        animation: `naxis-enter 0.7s ${delay}s both`,
      }}
    >
      {active && (
        <div
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle at 50% 0%, rgba(${accentRgb},0.1) 0%, transparent 60%)`,
          }}
        />
      )}
      <div className="relative flex items-start justify-between gap-2">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg"
          style={{
            background: `rgba(${accentRgb},0.1)`,
            border: `1px solid rgba(${accentRgb},0.2)`,
            color: `rgb(${accentRgb})`,
            boxShadow: active ? `0 0 20px rgba(${accentRgb},0.15)` : "none",
          }}
        >
          {icon}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{
              color: `rgb(${accentRgb})`,
              background: `rgba(${accentRgb},0.1)`,
              border: `1px solid rgba(${accentRgb},0.25)`,
            }}
          >
            {tag}
          </span>
          {!active && (
            <span className="rounded-full border border-border/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground-subtle">
              Soon
            </span>
          )}
        </div>
      </div>
      <div className="relative flex-1 space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-foreground-subtle">
          {sublabel}
        </p>
        <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
          {label}
        </h3>
        <p className="text-xs leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <div
        className="relative flex items-center justify-between border-t pt-3"
        style={{ borderColor: `rgba(${accentRgb},0.12)` }}
      >
        {stat ? (
          <div>
            <span
              className="font-mono text-base font-bold"
              style={{ color: `rgb(${accentRgb})` }}
            >
              {stat.value}
            </span>
            <span className="ml-1.5 text-[10px] text-foreground-subtle">{stat.label}</span>
          </div>
        ) : (
          <span className="text-[10px] text-foreground-subtle">Awaiting credentials</span>
        )}
        {active && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 group-hover:translate-x-1"
            style={{
              background: `rgba(${accentRgb},0.1)`,
              color: `rgb(${accentRgb})`,
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      {active && (
        <>
          <HudCorner pos="tl" />
          <HudCorner pos="br" />
        </>
      )}
    </Link>
  );
}
