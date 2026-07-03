"use client";

import { useState, useMemo, FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Clock,
  Download,
  MapPin,
  Radio,
  Search,
  Signal,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  api,
  type MistClientTimeline,
  type MistClientEvent,
  type MistClientSession,
} from "@/lib/api";

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDuration(s: number | null | undefined): string {
  if (!s || s <= 0) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function normalizeMacInput(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

function isValidMac(mac: string): boolean {
  return /^[0-9a-f]{12}$/.test(mac);
}

const WINDOWS: Array<{ label: string; hours: number }> = [
  { label: "24h", hours: 24 },
  { label: "3d",  hours: 72 },
  { label: "7d",  hours: 168 },
];

function CurrentSessionCard({ current }: { current: MistClientTimeline["current"] }) {
  if (!current) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface/40 px-4 py-3 text-sm text-foreground-subtle">
        <WifiOff className="h-4 w-4" /> Not currently connected
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-success/25 bg-success/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-success">
        <Wifi className="h-3.5 w-3.5" /> Currently connected
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Field label="Site"  value={current.site_name} />
        <Field label="AP"    value={current.ap} />
        <Field label="SSID"  value={current.ssid} />
        <Field label="Band"  value={current.band} />
        <Field label="RSSI"  value={current.rssi != null ? `${current.rssi} dBm` : null} />
        <Field label="Since" value={fmtDateTime(current.connected_since)} />
        <Field label="IP"    value={current.ip} />
        <Field label="Host"  value={current.hostname} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">{label}</div>
      <div className="font-mono text-foreground truncate">{value || "—"}</div>
    </div>
  );
}

type Merged =
  | ({ kind: "session"; ts: string } & MistClientSession)
  | ({ kind: "event";   ts: string } & MistClientEvent);

function mergeTimeline(t: MistClientTimeline): Merged[] {
  const rows: Merged[] = [];
  for (const s of t.sessions) {
    if (s.started) rows.push({ ...s, kind: "session", ts: s.started });
  }
  for (const e of t.events) {
    if (e.ts) rows.push({ ...e, kind: "event", ts: e.ts });
  }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return rows;
}

function TimelineRow({ row }: { row: Merged }) {
  if (row.kind === "session") {
    return (
      <div className="flex gap-3 border-l-2 border-primary/50 pl-4 py-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-primary">
          <Wifi className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-mono text-foreground-subtle">{fmtDateTime(row.started)}</span>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Session</span>
            <span className="text-xs text-foreground-subtle">{fmtDuration(row.duration_s)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span><span className="text-foreground-subtle">site</span> <span className="font-medium">{row.site_name}</span></span>
            <span><span className="text-foreground-subtle">ap</span> <span className="font-mono">{row.ap || "—"}</span></span>
            <span><span className="text-foreground-subtle">ssid</span> <span className="font-mono">{row.ssid || "—"}</span></span>
            <span><span className="text-foreground-subtle">band</span> <span className="font-mono">{row.band || "—"}</span></span>
            {row.disconnect_reason && (
              <span><span className="text-foreground-subtle">ended</span> <span className="text-foreground">{row.disconnect_reason}</span></span>
            )}
          </div>
        </div>
      </div>
    );
  }
  const isRoam = (row.type || "").toLowerCase().includes("roam");
  const color = isRoam ? "text-amber-400 border-amber-400/40" : "text-foreground-muted border-border/40";
  return (
    <div className={`flex gap-3 border-l-2 pl-4 py-2 ${color}`}>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface">
        {isRoam ? <ArrowLeftRight className="h-3.5 w-3.5" /> : <Signal className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-mono text-foreground-subtle">{fmtDateTime(row.ts)}</span>
          <span className="text-xs font-bold uppercase tracking-wider">{row.type || "event"}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span><span className="text-foreground-subtle">site</span> <span className="font-medium text-foreground">{row.site_name}</span></span>
          {row.ap && <span><span className="text-foreground-subtle">ap</span> <span className="font-mono text-foreground">{row.ap}</span></span>}
          {row.ssid && <span><span className="text-foreground-subtle">ssid</span> <span className="font-mono text-foreground">{row.ssid}</span></span>}
          {row.detail && <span className="text-foreground-muted">— {row.detail}</span>}
        </div>
      </div>
    </div>
  );
}

export function ClientTimelinePanel() {
  const [macInput, setMacInput] = useState("");
  const [submittedMac, setSubmittedMac] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);

  const params = useMemo(() => {
    if (windowHours === 24) return undefined;
    const until = new Date();
    const since = new Date(until.getTime() - windowHours * 3600 * 1000);
    return { since: since.toISOString(), until: until.toISOString() };
  }, [windowHours]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["mist-client-timeline", submittedMac, windowHours],
    queryFn: () => api.mistClientTimeline(submittedMac!, params),
    enabled: !!submittedMac,
  });

  const merged = data ? mergeTimeline(data) : [];
  const csvHref = submittedMac ? api.mistClientTimelineCsvUrl(submittedMac, params) : "#";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = normalizeMacInput(macInput);
    if (isValidMac(clean)) setSubmittedMac(clean);
  }

  const cleanCandidate = normalizeMacInput(macInput);
  const inputValid = isValidMac(cleanCandidate);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">Client lookup</div>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Client 1:1 timeline</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Live pass-through to Mist. No local storage. Enter a MAC address to trace this client's history across every site.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={macInput}
            onChange={(e) => setMacInput(e.target.value)}
            placeholder="MAC address (e.g. 40deade992e0 or 40:de:ad:e9:92:e0)"
            className="w-full rounded-md border border-border/50 bg-transparent pl-9 pr-3 py-2 text-sm font-mono outline-none placeholder:text-foreground-subtle focus:border-primary/60"
          />
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setWindowHours(w.hours)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                windowHours === w.hours ? "bg-primary/15 text-primary" : "text-foreground-subtle hover:bg-surface hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!inputValid}
          className="rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-40 disabled:hover:bg-primary/15"
        >
          Look up
        </button>
        {submittedMac && data && (
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:border-primary/60 hover:text-foreground"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
        )}
      </form>

      {!submittedMac && (
        <div className="rounded-lg border border-dashed border-border/50 bg-surface/20 px-4 py-8 text-center text-sm text-foreground-muted">
          Enter a MAC address above to load its timeline.
        </div>
      )}

      {submittedMac && (isLoading || isFetching) && !data && (
        <div className="text-sm text-foreground-muted">Fetching from Mist…</div>
      )}

      {error && (
        <div className="rounded-lg border border-critical/40 bg-critical/5 px-4 py-3 text-sm text-critical">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          <CurrentSessionCard current={data.current} />

          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <div className="rounded-lg border border-border/50 bg-surface/30 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
                Sites seen ({data.sites_seen.length})
              </div>
              {data.sites_seen.length === 0 ? (
                <div className="mt-2 text-xs text-foreground-muted">No site history in this window.</div>
              ) : (
                <div className="mt-2 space-y-2">
                  {data.sites_seen.map((s) => (
                    <div key={s.site_id} className="text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <MapPin className="h-3 w-3 text-violet-400" />
                        <span className="truncate">{s.site_name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-foreground-subtle font-mono">
                        {fmtDateTime(s.first_seen)} → {fmtDateTime(s.last_seen)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-foreground-subtle">
                <Clock className="h-3 w-3" /> Timeline · {merged.length} entries
              </div>
              {merged.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 bg-surface/20 px-4 py-8 text-center text-sm text-foreground-muted">
                  No sessions or events in this window.
                </div>
              ) : (
                <div className="max-h-[540px] overflow-y-auto space-y-0.5 pr-1">
                  {merged.map((row, i) => (
                    <TimelineRow key={`${row.kind}-${row.ts}-${i}`} row={row} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
