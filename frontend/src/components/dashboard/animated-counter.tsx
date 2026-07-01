"use client";

import { useEffect, useState } from "react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export function AnimatedCounter({ target, duration = 1400 }: { target: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    let cur = 0;
    const step = target / (duration / 16);
    const t = setInterval(() => {
      cur = Math.min(cur + step, target);
      setVal(Math.floor(cur));
      if (cur >= target) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [target, duration]);
  return <>{fmt(val)}</>;
}
