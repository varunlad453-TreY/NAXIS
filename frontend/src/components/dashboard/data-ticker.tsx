"use client";

import { useEffect, useState } from "react";

const TICKER = [
  "MIST · Wireless observer active",
  "NAXIS · Multi-vendor ingestion running",
  "SYSTEM · 61 sites monitored",
  "TELEMETRY · Event stream live",
  "NETWORK · 4 platform connectors",
  "STATUS · All collectors nominal",
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export function DataTicker({ eventCount }: { eventCount: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % TICKER.length), 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="flex items-center gap-4 overflow-hidden rounded-lg border border-primary/15 bg-primary/4 px-4 py-2 text-[11px] font-mono"
      style={{ animation: "naxis-hud-pulse 3s ease-in-out infinite" }}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-primary">
        <span
          className="h-1.5 w-1.5 rounded-full bg-primary"
          style={{ animation: "naxis-blink 1s step-end infinite" }}
        />
        LIVE
      </span>
      <span className="truncate text-foreground-subtle">{TICKER[idx]}</span>
      <span className="ml-auto hidden shrink-0 text-foreground-subtle/50 sm:block">
        {fmt(eventCount)} events ingested
      </span>
    </div>
  );
}
