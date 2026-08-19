"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// router.replace does not update useSearchParams synchronously, so two writes in
// one tick would both build on the same stale snapshot and the second would drop
// the first. Successive writes chain off this instead, shared across every hook
// instance because there is only ever one URL. Cleared once the URL catches up.
let pendingSearch: string | null = null;

export function useQueryState<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (v: T) => void] {
  const router = useRouter();
  const params = useSearchParams();

  const readFromUrl = useCallback((): T => {
    const raw = params.get(key);
    if (!raw) return fallback;
    if (allowed && !allowed.includes(raw as T)) return fallback;
    return raw as T;
  }, [params, key, fallback, allowed]);

  const [value, setValue] = useState<T>(readFromUrl);

  useEffect(() => {
    pendingSearch = null;
    const next = readFromUrl();
    setValue((prev) => (prev === next ? prev : next));
  }, [readFromUrl]);

  const write = useCallback(
    (v: T) => {
      setValue(v);
      const next = new URLSearchParams(pendingSearch ?? params.toString());
      if (v === fallback) next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      pendingSearch = qs;
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [params, router, key, fallback],
  );

  return [value, write];
}
