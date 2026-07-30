"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    const next = readFromUrl();
    setValue((prev) => (prev === next ? prev : next));
  }, [readFromUrl]);

  const write = useCallback(
    (v: T) => {
      setValue(v);
      const next = new URLSearchParams(Array.from(params.entries()));
      if (v === fallback) next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [params, router, key, fallback],
  );

  return [value, write];
}
