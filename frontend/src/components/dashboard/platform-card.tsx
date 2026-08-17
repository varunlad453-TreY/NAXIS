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
}: PlatformCardProps) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 py-2 transition-colors"
      style={{
        opacity: active ? 1 : 0.4,
        pointerEvents: active ? "auto" : "none",
        borderLeft: active ? `2px solid rgb(${accentRgb})` : "2px solid transparent",
        paddingLeft: active ? 10 : 12,
      }}
    >
      <span style={{ color: `rgb(${accentRgb})` }}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-[10px] text-foreground-subtle">{sublabel}</span>
        <span className="hidden text-[10px] text-foreground-muted sm:inline">·</span>
        <span className="hidden truncate text-[10px] text-foreground-muted sm:inline">{description}</span>
      </div>
      <div className="flex items-center gap-3">
        {stat && (
          <span className="font-mono text-xs text-foreground-subtle">
            <span className="text-foreground">{stat.value}</span> {stat.label}
          </span>
        )}
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: `rgb(${accentRgb})` }}
        >
          {tag}
        </span>
        {!active && (
          <span className="text-[10px] text-foreground-subtle">Soon</span>
        )}
        {active && (
          <ChevronRight className="h-3.5 w-3.5 text-foreground-subtle transition-colors group-hover:text-foreground" />
        )}
      </div>
    </Link>
  );
}
