"use client";

export function DashboardBackground({
  children,
}: {
  eventCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 70% 20%, hsl(var(--primary)/0.05) 0%, transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}
