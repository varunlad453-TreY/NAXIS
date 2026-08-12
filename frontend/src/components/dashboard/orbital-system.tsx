"use client";

import { AnimatedCounter } from "./animated-counter";

export function OrbitalSystem({ eventCount }: { eventCount: number }) {
  return (
    <div className="pointer-events-none select-none">
      <div className="font-mono text-lg font-bold text-primary">
        <AnimatedCounter target={eventCount} />
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">
        Events
      </div>
    </div>
  );
}
