"use client";

import { useEffect, useRef, useState } from "react";

import { getApiBase } from "@/lib/api";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

export type IncidentStreamStatus = "connecting" | "live" | "error";

interface UseIncidentStreamResult {
  /** Connection state of the SSE channel. */
  status: IncidentStreamStatus;
  /** Timestamp (ms) of the last incident push received, or null. */
  lastEventAt: number | null;
}

/**
 * Subscribe to the backend SSE incident stream. On each pushed incident it
 * invokes `onIncident` so the caller can invalidate/refetch. Heartbeats and
 * the initial "connected" event are used only to track liveness — they do not
 * trigger a refetch.
 */
export function useIncidentStream(onIncident: () => void): UseIncidentStreamResult {
  const [status, setStatus] = useState<IncidentStreamStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  // Keep the latest callback without re-opening the stream on every render.
  const onIncidentRef = useRef(onIncident);
  onIncidentRef.current = onIncident;

  useEffect(() => {
    // Resolve the base at call time, exactly as lib/api.ts does. Reading
    // NEXT_PUBLIC_API_URL directly pinned this to localhost:8000, which is
    // baked into the browser bundle at build time — so the stream failed for
    // every browser except one running on the Docker host, and the UI sat on
    // "connecting" forever while the rest of the data loaded fine.
    // EventSource cannot set headers; the backend accepts the key as a query
    // param for this endpoint only.
    const url =
      `${getApiBase()}/correlation/incidents/stream` +
      (API_KEY ? `?api_key=${encodeURIComponent(API_KEY)}` : "");
    const source = new EventSource(url);

    source.onopen = () => setStatus("live");

    source.onmessage = (event) => {
      setStatus("live");
      let payload: { type?: string } | null = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = null;
      }
      const type = payload?.type;
      if (type === "connected" || type === "heartbeat") return;
      // Any other message is a real incident push.
      setLastEventAt(Date.now());
      onIncidentRef.current();
    };

    source.onerror = () => {
      // EventSource auto-reconnects; surface the interim state.
      setStatus("error");
    };

    return () => source.close();
  }, []);

  return { status, lastEventAt };
}
