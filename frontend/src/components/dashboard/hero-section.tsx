"use client";

type EventRange = "1h" | "24h" | "7d" | "30d";

interface HeroSectionProps {
  isOnline: boolean;
  eventCount: number;
  eventRange: EventRange;
  onEventRangeChange: (range: EventRange) => void;
}

const RANGE_LABELS: Record<EventRange, string> = {
  "1h": "1h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

const RANGE_FULL: Record<EventRange, string> = {
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

export function HeroSection({ isOnline, eventCount, eventRange, onEventRangeChange }: HeroSectionProps) {
  return (
    <section className="max-w-2xl space-y-6" style={{ animation: "naxis-enter 0.6s 0.1s both" }}>
      <div className="flex items-center gap-2.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-success" : "bg-foreground-subtle"}`}
          style={{ boxShadow: isOnline ? "0 0 6px 1px hsl(var(--success)/0.5)" : "none" }}
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-foreground-subtle">
          {isOnline ? "Systems nominal" : "Connecting…"}
        </span>
        <span className="ml-auto font-mono text-[10px] text-foreground-subtle/50">
          {new Intl.NumberFormat().format(eventCount)} events in {RANGE_FULL[eventRange]}
        </span>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.35em] text-foreground-subtle">
          Network Intelligence Platform · Tata Motors
        </p>
        <h1 className="text-5xl font-semibold leading-tight tracking-tight text-foreground lg:text-6xl">
          One platform.
          <br />
          <span className="naxis-shimmer-text">Every network.</span>
        </h1>
      </div>

      <p className="max-w-md text-sm leading-7 text-foreground-muted">
        Unified observability across wireless, wired, SD-WAN, and cloud — four platform observers
        feeding one intelligence layer.
      </p>

      <div className="flex flex-wrap items-end gap-4 border-t border-border/40 pt-5 text-sm">
        <div>
          <div className="font-mono text-lg font-semibold text-foreground">
            {new Intl.NumberFormat().format(eventCount)}
          </div>
          <div className="text-[11px] text-foreground-subtle">Events</div>
        </div>
        <div>
          <div className="font-mono text-lg font-semibold text-foreground">1</div>
          <div className="text-[11px] text-foreground-subtle">Vendors live</div>
        </div>
        <div>
          <div className="font-mono text-lg font-semibold text-foreground">61</div>
          <div className="text-[11px] text-foreground-subtle">Sites monitored</div>
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border border-border/40 p-0.5">
          {(Object.keys(RANGE_LABELS) as EventRange[]).map((r) => (
            <button
              key={r}
              onClick={() => onEventRangeChange(r)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                r === eventRange
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-foreground-subtle hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
