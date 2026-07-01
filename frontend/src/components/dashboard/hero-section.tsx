"use client";

interface HeroSectionProps {
  isOnline: boolean;
  eventCount: number;
}

export function HeroSection({ isOnline, eventCount }: HeroSectionProps) {
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
          {new Intl.NumberFormat().format(eventCount)} events ingested
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

      <div className="flex flex-wrap gap-4 border-t border-border/40 pt-5 text-sm">
        {[
          { label: "Events", value: eventCount },
          { label: "Vendors live", value: 1 },
          { label: "Sites monitored", value: 61 },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="font-mono text-lg font-semibold text-foreground">
              {new Intl.NumberFormat().format(value)}
            </div>
            <div className="text-[11px] text-foreground-subtle">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
