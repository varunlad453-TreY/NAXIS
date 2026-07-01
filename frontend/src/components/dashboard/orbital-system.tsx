"use client";

import { AnimatedCounter } from "./animated-counter";

export function OrbitalSystem({ eventCount }: { eventCount: number }) {
  return (
    <div
      className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 select-none"
      style={{ width: 560, height: 560 }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, hsl(var(--primary)/0.07) 0%, transparent 70%)",
        }}
      />

      {/* rings */}
      <div className="absolute inset-0 rounded-full border border-primary/10" />
      <div className="absolute rounded-full border border-primary/12" style={{ inset: 56 }} />
      <div className="absolute rounded-full border border-violet-500/8" style={{ inset: 112 }} />

      {/* arm 1 CW 18s */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ animation: "naxis-orbit-cw 18s linear infinite" }}
      >
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div
            className="h-3 w-3 rounded-full bg-cyan-400"
            style={{ boxShadow: "0 0 10px 3px rgba(6,182,212,0.7)" }}
          />
        </div>
      </div>
      {/* arm 2 CCW 26s */}
      <div
        className="absolute rounded-full"
        style={{ inset: 56, animation: "naxis-orbit-ccw 26s linear infinite" }}
      >
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div
            className="h-2.5 w-2.5 rounded-full bg-violet-400"
            style={{ boxShadow: "0 0 8px 2px rgba(139,92,246,0.7)" }}
          />
        </div>
      </div>
      {/* arm 3 CW 11s */}
      <div
        className="absolute rounded-full"
        style={{ inset: 56, animation: "naxis-orbit-cw 11s linear infinite" }}
      >
        <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2">
          <div
            className="h-2 w-2 rounded-full bg-emerald-400"
            style={{ boxShadow: "0 0 8px 2px rgba(52,211,153,0.7)" }}
          />
        </div>
      </div>
      {/* arm 4 CCW 20s inner */}
      <div
        className="absolute rounded-full"
        style={{ inset: 112, animation: "naxis-orbit-ccw 20s linear infinite" }}
      >
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
          <div
            className="h-2 w-2 rounded-full bg-amber-400"
            style={{ boxShadow: "0 0 8px 2px rgba(251,191,36,0.7)" }}
          />
        </div>
      </div>

      {/* centre */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          style={{
            animation:
              "naxis-orb-pulse 4s ease-in-out infinite, naxis-float 7s ease-in-out infinite",
          }}
        >
          <div className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/20" />
          <div
            className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
            style={{ animation: "naxis-radar 8s linear infinite" }}
          >
            <div className="absolute left-1/2 top-1/2 h-px w-1/2 origin-left bg-gradient-to-r from-primary/80 to-transparent" />
          </div>
          <div
            className="flex h-20 w-20 flex-col items-center justify-center rounded-full text-center"
            style={{
              background:
                "radial-gradient(circle, hsl(var(--primary)/0.2) 0%, hsl(var(--primary)/0.04) 60%, transparent 100%)",
              boxShadow:
                "0 0 0 1px hsl(var(--primary)/0.25), inset 0 0 20px hsl(var(--primary)/0.08)",
            }}
          >
            <div className="text-base font-bold font-mono leading-none text-primary">
              <AnimatedCounter target={eventCount} />
            </div>
            <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.2em] text-primary/60">
              Events
            </div>
          </div>
        </div>
      </div>

      {/* HUD labels */}
      <div
        className="absolute right-10 top-6 text-right"
        style={{ animation: "naxis-enter 1s 0.8s both" }}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">
          Platforms
        </div>
        <div className="font-mono text-sm font-bold text-amber-400">4</div>
      </div>
      <div
        className="absolute bottom-14 left-6"
        style={{ animation: "naxis-enter 1s 1s both" }}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">
          Vendors
        </div>
        <div className="font-mono text-sm font-bold text-emerald-400">1 Live</div>
      </div>
    </div>
  );
}
