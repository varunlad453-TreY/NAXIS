"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { TopologyNode } from "@/types/topology";

// ─── helpers ───────────────────────────────────────────────────────────────

function healthColor(status: string): string {
  switch (status) {
    case "critical": return "#ef4444";
    case "warning":  return "#f59e0b";
    case "degraded": return "#f97316";
    default:         return "#10b981";
  }
}

function regionFromSite(siteId: string, siteName: string | null): string {
  const name = (siteName ?? siteId ?? "").toLowerCase();
  if (name.includes("delhi") || name.includes("ncr") || name.includes("gurgaon") || name.includes("noida")) return "North India";
  if (name.includes("mumbai") || name.includes("pune") || name.includes("west")) return "West India";
  if (name.includes("bengaluru") || name.includes("bangalore") || name.includes("chennai") || name.includes("hyderabad") || name.includes("south")) return "South India";
  if (name.includes("kolkata") || name.includes("east") || name.includes("north east")) return "East India";
  if (name.includes("central") || name.includes("nagpur") || name.includes("bhopal")) return "Central India";
  if (name.includes("plant") || name.includes("warehouse") || name.includes("factory")) return "Manufacturing";
  return "Other";
}

type SortKey = "name" | "status" | "devices" | "region" | "alerts";

const REGIONS = ["All Regions","North India","West India","South India","East India","Central India","Manufacturing","Other"];
const STATUS_OPTS = ["All Status","healthy","warning","critical","degraded"];

// ─── component ─────────────────────────────────────────────────────────────

export function AllSitesGrid({
  sites,
  onSiteClick,
}: {
  sites: TopologyNode[];
  onSiteClick?: (siteId: string) => void;
}) {
  const [search,       setSearch]  = useState("");
  const [region,       setRegion]  = useState("All Regions");
  const [statusFilter, setStatus]  = useState("All Status");
  const [sortKey,      setSortKey] = useState<SortKey>("status");
  const [sortDir,      setSortDir] = useState<"asc"|"desc">("desc");

  const enriched = useMemo(() =>
    sites.map((s) => ({
      ...s,
      _region:     regionFromSite(s.site_id, s.site_name),
      _alertCount: (s.critical_count ?? 0) + (s.warning_count ?? 0),
    }))
  , [sites]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((s) => {
      if (q && !s.name?.toLowerCase().includes(q) && !s.site_name?.toLowerCase().includes(q) && !s.site_id?.toLowerCase().includes(q)) return false;
      if (region !== "All Regions" && s._region !== region) return false;
      if (statusFilter !== "All Status" && s.health_status !== statusFilter) return false;
      return true;
    });
  }, [enriched, search, region, statusFilter]);

  const sorted = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1;
    const ORDER: Record<string, number> = { critical: 4, degraded: 3, warning: 2, healthy: 1 };
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":    return mul * (a.name ?? "").localeCompare(b.name ?? "");
        case "region":  return mul * a._region.localeCompare(b._region);
        case "devices": return mul * ((a.device_count ?? 0) - (b.device_count ?? 0));
        case "alerts":  return mul * (a._alertCount - b._alertCount);
        case "status":  return mul * ((ORDER[a.health_status] ?? 0) - (ORDER[b.health_status] ?? 0));
        default:        return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const stats = useMemo(() => ({
    critical: enriched.filter((s) => s.health_status === "critical").length,
    warning:  enriched.filter((s) => s.health_status === "warning" || s.health_status === "degraded").length,
    healthy:  enriched.filter((s) => s.health_status === "healthy").length,
    totalAPs: enriched.reduce((a, s) => a + (s.device_count ?? 0), 0),
  }), [enriched]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey !== k
      ? <span className="opacity-25 ml-1">↕</span>
      : <span className="text-indigo-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;

  return (
    <div className="space-y-6">
      {/* ─── Inline Metrics Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Total Sites</span>
          <span className="text-lg font-semibold text-white font-mono">{sites.length}</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Operational</span>
          <span className="text-lg font-semibold text-emerald-400 font-mono">{stats.healthy}</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Alerts</span>
          <span className="text-lg font-semibold text-amber-400 font-mono">{stats.warning}</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Critical</span>
          <span className="text-lg font-semibold text-rose-400 font-mono">{stats.critical}</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Total APs</span>
          <span className="text-lg font-semibold text-white font-mono">{stats.totalAPs.toLocaleString()}</span>
        </div>
      </div>

      {/* ─── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 border-b border-slate-800/60 pb-4">
        {/* Search + region tabs */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, or region..."
              className="w-full bg-transparent border-b border-slate-800/60 pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto">
            <SlidersHorizontal className="w-4 h-4 text-slate-500 mr-2 hidden md:block" />
            {REGIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRegion(r)}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                  region === r
                    ? "text-indigo-400 border-b-2 border-indigo-500"
                    : "text-slate-400 hover:text-slate-200 border-b-2 border-transparent"
                }`}
              >
                {r === "All Regions" ? "All" : r}
              </button>
            ))}
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 w-full overflow-x-auto">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-2 hidden md:block">Status</span>
          {STATUS_OPTS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                statusFilter === s
                  ? "text-indigo-400 border-b-2 border-indigo-500"
                  : "text-slate-400 hover:text-slate-200 border-b-2 border-transparent"
              }`}
            >
              {s === "All Status" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-auto whitespace-nowrap">
            {filtered.length} of {sites.length}
          </span>
        </div>
      </div>

      {/* ─── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800/60 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
              <th className="py-2.5 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("name")}>
                Site <SortArrow k="name" />
              </th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("region")}>
                Region <SortArrow k="region" />
              </th>
              <th className="py-2.5 px-3 cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("status")}>
                Status <SortArrow k="status" />
              </th>
              <th className="py-2.5 px-3 text-center cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("devices")}>
                APs <SortArrow k="devices" />
              </th>
              <th className="py-2.5 px-3 text-center cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("alerts")}>
                Alerts <SortArrow k="alerts" />
              </th>
              <th className="py-2.5 px-3 text-center">Critical</th>
              <th className="py-2.5 px-3 text-center">Warnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 text-xs">
            {sorted.map((site) => {
              const color = healthColor(site.health_status);
              return (
                <tr
                  key={site.node_id}
                  onClick={() => onSiteClick?.(site.site_id)}
                  className="hover:bg-slate-800/30 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-3 font-medium text-white">
                    {site.name || site.site_name || site.site_id}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">{site._region}</td>
                  <td className="py-2.5 px-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="capitalize" style={{ color }}>
                        {site.health_status === "healthy" ? "Operational" : site.health_status}
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                    {site.device_count ?? 0}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={site._alertCount > 0 ? "text-amber-400 font-semibold" : "text-slate-500"}>
                      {site._alertCount}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={site.critical_count ? "text-rose-400 font-semibold" : "text-slate-500"}>
                      {site.critical_count ?? 0}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={site.warning_count ? "text-amber-400 font-semibold" : "text-slate-500"}>
                      {site.warning_count ?? 0}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            No sites match your filters
          </div>
        )}
      </div>
    </div>
  );
}
