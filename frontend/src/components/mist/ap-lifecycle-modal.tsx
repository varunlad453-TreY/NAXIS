"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowRight,
  Clock,
  Download,
  MapPin,
  Radio,
  Rocket,
  Signal,
  Tag,
  X,
  Zap,
} from "lucide-react";
import { api, type MistHistoryEntry, type MistLifecycleEvent } from "@/lib/api";

const EVENT_META: Record<
  MistLifecycleEvent,
  { label: string; Icon: typeof Zap; color: string }
> = {
  first_seen:        { label: "First seen",       Icon: Rocket, color: "text-primary" },
  firmware_change:   { label: "Firmware change",  Icon: Zap,    color: "text-violet-400" },
  site_move:         { label: "Site move",        Icon: MapPin, color: "text-amber-400" },
  rename:            { label: "Renamed",          Icon: Tag,    color: "text-blue-400" },
  hardware_replaced: { label: "Hardware replaced", Icon: Radio, color: "text-fuchsia-400" },
  reachability:      { label: "Reachability",     Icon: Signal, color: "text-success" },
  reboot:            { label: "Reboot",           Icon: Clock,  color: "text-critical" },
};

const FILTERS: Array<{ value: "all" | MistLifecycleEvent; label: string }> = [
  { value: "all",               label: "All events" },
  { value: "firmware_change",   label: "Firmware" },
  { value: "reboot",            label: "Reboots" },
  { value: "site_move",         label: "Site moves" },
  { value: "reachability",      label: "Reachability" },
  { value: "rename",            label: "Renames" },
  { value: "hardware_replaced", label: "Hardware" },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function EventRow({ entry }: { entry: MistHistoryEntry }) {
  const meta = EVENT_META[entry.event];
  const { Icon } = meta;
  return (
    <div className="flex gap-3 border-l-2 border-border/40 pl-4 py-3 hover:border-primary/60 transition-colors">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface ${meta.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-mono text-foreground-subtle">{fmtDate(entry.observed_at)}</span>
          <span className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
        </div>
        <div className="mt-1 text-sm text-foreground">
          {entry.event === "first_seen" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><span className="text-foreground-subtle">site</span> <span className="font-medium">{entry.site_name || "—"}</span></span>
              <span><span className="text-foreground-subtle">state</span> <span className="font-medium capitalize">{entry.reachability || "—"}</span></span>
              <span><span className="text-foreground-subtle">firmware</span> <span className="font-mono">{entry.firmware || "—"}</span></span>
              {entry.uptime_s > 0 && (
                <span><span className="text-foreground-subtle">uptime</span> <span className="font-mono">{Math.floor(entry.uptime_s / 3600)}h</span></span>
              )}
            </div>
          )}
          {entry.event === "reboot" && (
            <span>Uptime reset (was <span className="font-mono">{entry.from_value}s</span>)</span>
          )}
          {entry.event !== "first_seen" && entry.event !== "reboot" && (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="font-mono text-foreground-muted">{String(entry.from_value ?? "—")}</span>
              <ArrowRight className="h-3 w-3 text-foreground-subtle" />
              <span className="font-mono text-foreground">{String(entry.to_value ?? "—")}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  serial: string;
  hostname: string;
  onClose: () => void;
}

export function ApLifecycleModal({ serial, hostname, onClose }: Props) {
  const [filter, setFilter] = useState<"all" | MistLifecycleEvent>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["mist-ap-history", serial, filter],
    queryFn: () =>
      api.mistApHistory(serial, filter === "all" ? undefined : { event: filter }),
    enabled: !!serial,
  });

  const csvHref = api.mistApHistoryCsvUrl(
    serial,
    filter === "all" ? undefined : { event: filter }
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-border/60 bg-surface/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/40 px-6 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">AP Lifecycle</div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{hostname}</h2>
            <div className="mt-0.5 text-xs font-mono text-foreground-subtle">serial {serial}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-foreground-subtle hover:bg-surface hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-6 py-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === f.value
                    ? "bg-primary/15 text-primary"
                    : "text-foreground-subtle hover:bg-surface hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-medium text-foreground-muted hover:border-primary/60 hover:text-foreground"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="text-sm text-foreground-muted">Loading history…</div>
          )}
          {error && (
            <div className="text-sm text-critical">
              {(error as Error).message.includes("404")
                ? "No history recorded for this AP yet. The ledger fills in as the collector observes changes."
                : `Failed to load history: ${(error as Error).message}`}
            </div>
          )}
          {data && data.events.length === 0 && (
            <div className="text-sm text-foreground-muted">No events match the current filter.</div>
          )}
          {data && data.events.length > 0 && (
            <div className="space-y-1">
              {data.events.map((e, i) => (
                <EventRow key={`${e.observed_at}-${e.event}-${i}`} entry={e} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
