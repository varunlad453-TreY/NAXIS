"use client";

import { Starfield } from "./starfield";
import { OrbitalSystem } from "./orbital-system";

export function DashboardBackground({
  eventCount,
  children,
}: {
  eventCount: number;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Themed background layers */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-60 dark:opacity-100"
          style={{
            background:
              "radial-gradient(ellipse 100% 70% at 60% 40%, hsl(var(--primary)/0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 100% at 100% 50%, hsl(var(--primary)/0.05) 0%, transparent 50%)",
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute right-1/4 top-1/4 h-80 w-80 rounded-full opacity-10 dark:opacity-25"
          style={{
            background: "radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)",
            filter: "blur(80px)",
            animation: "naxis-float 10s ease-in-out infinite",
          }}
        />
        <div
          className="absolute bottom-1/4 left-1/3 h-64 w-64 rounded-full opacity-8 dark:opacity-20"
          style={{
            background: "radial-gradient(circle, rgba(6,182,212,0.5) 0%, transparent 70%)",
            filter: "blur(60px)",
            animation: "naxis-float 14s ease-in-out infinite reverse",
          }}
        />
      </div>

      <Starfield />

      <div
        className="pointer-events-none absolute left-0 right-0 h-px opacity-10 dark:opacity-25"
        style={{
          background: "linear-gradient(90deg, transparent 0%, hsl(var(--primary)) 50%, transparent 100%)",
          animation: "naxis-scan 8s linear infinite",
          top: 0,
        }}
      />

      <div className="absolute bottom-0 right-0 top-0 hidden w-[600px] xl:block">
        <OrbitalSystem eventCount={eventCount} />
      </div>

      {children}
    </div>
  );
}
