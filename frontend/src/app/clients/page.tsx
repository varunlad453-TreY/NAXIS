"use client";

import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Filter,
  Laptop,
  MapPin,
  Search,
  Smartphone,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { api, type MistLiveClient } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryState } from "@/hooks/use-query-state";

type BandParam = "all" | "24" | "5" | "6";
type QualityParam = "all" | "excellent" | "fair" | "poor";

const BAND_VALUES: readonly BandParam[] = ["all", "24", "5", "6"];
const QUALITY_VALUES: readonly QualityParam[] = ["all", "excellent", "fair", "poor"];

const BAND_LABEL: Record<string, string> = { "24": "2.4 GHz", "5": "5 GHz", "6": "6 GHz" };

function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function QualityDot({ status }: { status: MistLiveClient["status"] }) {
  const color =
    status === "excellent"
      ? "bg-success"
      : status === "fair"
        ? "bg-orange-400"
        : status === "poor"
          ? "bg-critical"
          : "bg-foreground-subtle";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

/** Icon comes from Mist's own `os`/`family` string — nothing is inferred when both are absent. */
function ClientIcon({ client }: { client: MistLiveClient }) {
  const hint = `${client.os ?? ""} ${client.family ?? ""}`.toLowerCase();
  const cls = "h-3.5 w-3.5 shrink-0 text-foreground-subtle";
  if (/android|ios|iphone|ipad|mobile|phone/.test(hint)) return <Smartphone className={cls} />;
  if (/windows|mac|linux|chrome ?os|laptop/.test(hint)) return <Laptop className={cls} />;
  return <Wifi className={cls} />;
}

function ClientsPageInner() {
  const [search, setSearch] = useState("");
  const [band, setBand] = useQueryState<BandParam>("band", "all", BAND_VALUES);
  const [quality, setQuality] = useQueryState<QualityParam>("quality", "all", QUALITY_VALUES);

  const { data, isLoading, error } = useQuery({
    queryKey: ["mist-clients"],
    queryFn: () => api.mistClients({ limit: 2000 }),
    refetchInterval: 60000,
  });

  const clients = data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (band !== "all" && c.band !== band) return false;
      if (quality !== "all" && c.status !== quality) return false;
      if (!term) return true;
      return [c.hostname, c.username, c.mac, c.ip_address, c.ssid, c.ap_name, c.site_name, c.os]
        .some((v) => v?.toLowerCase().includes(term));
    });
  }, [clients, band, quality, search]);

  const stats = useMemo(() => {
    const withRssi = clients.filter((c) => c.rssi !== null);
    const avgRssi = withRssi.length
      ? Math.round(withRssi.reduce((s, c) => s + (c.rssi as number), 0) / withRssi.length)
      : null;
    return {
      total: clients.length,
      sites: new Set(clients.map((c) => c.site_id).filter(Boolean)).size,
      avgRssi,
      guests: clients.filter((c) => c.is_guest).length,
    };
  }, [clients]);

  const bandCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      if (!c.band) continue;
      counts.set(c.band, (counts.get(c.band) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [clients]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}
        <div className="border-b border-border/60 pb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-violet-400">
                <Users className="h-3.5 w-3.5" />
                Wireless Clients
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Client Lookup</h1>
              <p className="mt-1 text-sm text-foreground-muted">
                Currently-associated Mist clients across {stats.sites} sites
              </p>
            </div>
            <div className="flex gap-8">
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">{stats.total}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Connected</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">
                  {stats.avgRssi === null ? "—" : `${stats.avgRssi}`}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Avg RSSI dBm</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-foreground">{stats.guests}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-subtle">Guest</div>
              </div>
            </div>
          </div>
          {bandCounts.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-foreground-muted">
              {bandCounts.map(([b, n]) => (
                <span key={b}>
                  {BAND_LABEL[b] ?? `${b} GHz`} <span className="font-mono text-foreground">{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search hostname, MAC, IP, SSID, AP, site, OS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-foreground-subtle" />
            <select
              value={band}
              onChange={(e) => setBand(e.target.value as BandParam)}
              className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
            >
              <option value="all">All Bands</option>
              <option value="24">2.4 GHz</option>
              <option value="5">5 GHz</option>
              <option value="6">6 GHz</option>
            </select>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityParam)}
              className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
            >
              <option value="all">All Quality</option>
              <option value="excellent">Excellent</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
            {(search || band !== "all" || quality !== "all") && (
              <button
                onClick={() => { setSearch(""); setBand("all"); setQuality("all"); }}
                className="inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <AlertCircle className="mb-2 h-6 w-6" />
            <p className="font-medium">Failed to load clients</p>
            <p className="text-sm text-foreground-muted">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
            <Wifi className="h-6 w-6 text-foreground-subtle" />
            <div>
              <p className="font-semibold text-foreground">No clients found</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {clients.length === 0
                  ? "No clients are currently associated to any Mist AP."
                  : "No clients match your filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/60 bg-surface text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">SSID</th>
                  <th className="px-3 py-2">AP / Site</th>
                  <th className="px-3 py-2">Band / Ch</th>
                  <th className="px-3 py-2 text-center">RSSI / SNR</th>
                  <th className="px-3 py-2">Auth</th>
                  <th className="px-3 py-2 text-right">Uptime / Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-xs">
                {filtered.map((c) => (
                  <tr key={c.mac ?? c.ap_id ?? Math.random()} className="transition-colors hover:bg-surface">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ClientIcon client={c} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {dash(c.hostname ?? c.username)}
                          </div>
                          <div className="font-mono text-[10px] text-foreground-subtle">{dash(c.mac)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-foreground-muted">{dash(c.ip_address)}</td>
                    <td className="px-3 py-2.5 text-foreground-muted">{dash(c.ssid)}</td>
                    <td className="px-3 py-2.5">
                      <div className="truncate text-foreground-muted">{dash(c.ap_name ?? c.ap_mac)}</div>
                      <div className="flex items-center gap-1 truncate text-[10px] text-foreground-subtle">
                        <MapPin className="h-2.5 w-2.5" />
                        {dash(c.site_name)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-foreground-muted">
                      {c.band ? (BAND_LABEL[c.band] ?? `${c.band} GHz`) : "—"}
                      <span className="ml-1 font-mono text-[10px] text-foreground-subtle">
                        {c.channel === null ? "" : `ch ${c.channel}`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono">
                      <span
                        className={
                          c.rssi === null
                            ? "text-foreground-subtle"
                            : c.rssi < -75
                              ? "font-semibold text-critical"
                              : "font-semibold text-success"
                        }
                      >
                        {c.rssi === null ? "—" : `${c.rssi} dBm`}
                      </span>
                      <span className="ml-1 text-[10px] text-foreground-subtle">
                        {c.snr === null ? "" : `(${c.snr} dB)`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="truncate text-foreground-muted">{dash(c.auth_type)}</div>
                      <div className="text-[10px] text-foreground-subtle">
                        {c.proto ? `802.11${c.proto}` : ""}
                        {c.is_guest ? " · guest" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 text-foreground-muted">
                        <QualityDot status={c.status} />
                        {formatUptime(c.uptime)}
                      </div>
                      <div className="font-mono text-[10px] text-foreground-subtle">
                        ↓{formatBytes(c.rx_bytes)} ↑{formatBytes(c.tx_bytes)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="pt-2 text-center text-xs text-foreground-subtle">
            Showing {filtered.length} of {clients.length} clients
          </div>
        )}

      </div>
    </div>
  );
}

function ClientsPageFallback() {
  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-3 border-b border-border/60 pb-8">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<ClientsPageFallback />}>
      <ClientsPageInner />
    </Suspense>
  );
}
