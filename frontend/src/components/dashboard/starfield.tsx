"use client";

import { useMemo } from "react";

export function Starfield() {
  const stars = useMemo(
    () =>
      Array.from({ length: 140 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        r: Math.random() * 1.3 + 0.3,
        anim: ["naxis-twinkle-a", "naxis-twinkle-b", "naxis-twinkle-c"][i % 3],
        dur: (Math.random() * 4 + 2).toFixed(1),
        delay: (Math.random() * 6).toFixed(1),
      })),
    []
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden dark-only-stars">
      <svg
        className="h-full w-full opacity-70 dark:opacity-100"
        xmlns="http://www.w3.org/2000/svg"
      >
        {stars.map((s) => (
          <circle
            key={s.id}
            cx={`${s.x}%`}
            cy={`${s.y}%`}
            r={s.r}
            fill="rgba(148,163,184,0.7)"
            style={{ animation: `${s.anim} ${s.dur}s ${s.delay}s ease-in-out infinite` }}
          />
        ))}
      </svg>
    </div>
  );
}
