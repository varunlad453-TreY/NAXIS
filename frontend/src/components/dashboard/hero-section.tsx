"use client";

import { AnimatedCounter } from "./animated-counter";
import { DataTicker } from "./data-ticker";
import { HudCorner } from "./hud-corner";

interface HeroSectionProps {
  isOnline: boolean;
  eventCount: number;
}

export function HeroSection({ isOnline, eventCount }: HeroSectionProps) {
  const hudStats = [
    { label: "Events Ingested", value: eventCount, rgb: "6,182,212" },
    { label: "Vendors Live", value: 1, rgb: "52,211,153" },
    { label: "Sites Monitored", value: 61, rgb: "167,139,250" },
    { label: "Platforms Total", value: 4, rgb: "251,191,36" },
  ];

  return (
    <>
      <div style={{ animation: "naxis-enter 0.6s 0.1s both" }}>
        <DataTicker eventCount={eventCount} />
      </div>

      <section
        className="max-w-2xl space-y-8"
        style={{ animation: "naxis-enter 0.8s 0.2s both" }}
      >
        <div
          className="inline-flex items-center gap-3 rounded-full px-4 py-1.5"
          style={{
            border: "1px solid hsl(var(--primary)/0.2)",
            background: "hsl(var(--primary)/0.06)",
            animation: "naxis-hud-pulse 3s ease-in-out infinite",
          }}
        >
          <span
            className={`h-2 w-2 rounded-full ${isOnline ? "bg-success" : "bg-foreground-subtle"}`}
            style={{
              animation: isOnline ? "naxis-blink 1.5s ease-in-out infinite" : "none",
              boxShadow: isOnline ? "0 0 8px 2px hsl(var(--success)/0.6)" : "none",
            }}
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
            {isOnline ? "All systems nominal" : "Connecting..."}
          </span>
          <span className="font-mono text-[10px] text-foreground-subtle">v2.0</span>
        </div>

        <div>
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.4em] text-foreground-subtle">
            Network Resilient Platform · Tata Motors
          </p>
          <h1 className="text-6xl font-semibold leading-none tracking-tight text-foreground lg:text-7xl">
            <span className="block">One platform.</span>
            <span className="naxis-shimmer-text mt-1 block">Every network.</span>
          </h1>
        </div>

        <p className="max-w-lg text-base leading-7 text-foreground-muted">
          Unified observability across wireless, wired, SD-WAN, and cloud — four platform
          observers feeding one intelligence layer.
        </p>

        <div className="flex flex-wrap items-stretch gap-3">
          {hudStats.map(({ label, value, rgb }) => (
            <div
              key={label}
              className="relative flex min-w-[88px] flex-col rounded-lg px-4 py-3"
              style={{
                border: `1px solid rgba(${rgb},0.18)`,
                background: `rgba(${rgb},0.04)`,
              }}
            >
              <HudCorner pos="tl" />
              <HudCorner pos="br" />
              <div
                className="font-mono text-xl font-bold"
                style={{
                  color: `rgb(${rgb})`,
                  textShadow: `0 0 16px rgba(${rgb},0.4)`,
                }}
              >
                <AnimatedCounter target={value} />
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
