"use client";

import { useMemo, useState } from "react";
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

function healthBg(status: string): string {
  switch (status) {
    case "critical": return "rgba(239,68,68,0.08)";
    case "warning":  return "rgba(245,158,11,0.08)";
    case "degraded": return "rgba(249,115,22,0.08)";
    default:         return "rgba(16,185,129,0.06)";
  }
}

function badgeForStatus(status: string) {
  const label =
    status === "healthy" ? "Operational"
    : status.charAt(0).toUpperCase() + status.slice(1);
  return { label, color: healthColor(status), bg: healthBg(status) };
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
  const [page,         setPage]    = useState(0);
  const PER_PAGE = 24;

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

  const totalPages = Math.ceil(sorted.length / PER_PAGE);
  const paginated  = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const stats = useMemo(() => ({
    critical: enriched.filter((s) => s.health_status === "critical").length,
    warning:  enriched.filter((s) => s.health_status === "warning" || s.health_status === "degraded").length,
    healthy:  enriched.filter((s) => s.health_status === "healthy").length,
    totalAPs: enriched.reduce((a, s) => a + (s.device_count ?? 0), 0),
  }), [enriched]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(0);
  }

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey !== k
      ? <span style={{ opacity: 0.25 }}>↕</span>
      : <span style={{ color: "#818cf8" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;

  const sel: React.CSSProperties = {
    height: 32, padding: "0 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
    border: "1px solid hsl(var(--border)/0.6)", background: "hsl(var(--surface))",
    color: "hsl(var(--foreground))",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", minHeight: 640,
      background: "hsl(var(--surface)/0.2)", borderRadius: 12,
      border: "1px solid hsl(var(--border)/0.4)", overflow: "hidden",
    }}>

      {/* ─── Stats bar ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid hsl(var(--border)/0.4)" }}>
        {([
          { label: "Total Sites",  value: sites.length,                    color: "#6366f1", icon: "🏢" },
          { label: "Operational",  value: stats.healthy,                   color: "#10b981", icon: "✅" },
          { label: "Alerts",       value: stats.warning,                   color: "#f59e0b", icon: "⚠️" },
          { label: "Critical",     value: stats.critical,                  color: "#ef4444", icon: "🔴" },
          { label: "Total APs",    value: stats.totalAPs.toLocaleString(), color: "#8b5cf6", icon: "📡" },
        ] as const).map(({ label, value, color, icon }) => (
          <div key={label} style={{ flex: 1, padding: "14px 20px", borderRight: "1px solid hsl(var(--border)/0.3)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--foreground-muted))", marginTop: 2 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Filter bar ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderBottom: "1px solid hsl(var(--border)/0.4)", alignItems: "center", flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.4, fontSize: 13, pointerEvents: "none" }}>🔍</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by name, ID…"
            style={{
              width: "100%", paddingLeft: 30, paddingRight: 10, height: 32, borderRadius: 6, boxSizing: "border-box",
              border: "1px solid hsl(var(--border)/0.6)", background: "hsl(var(--surface)/0.6)",
              color: "hsl(var(--foreground))", fontSize: 12, outline: "none",
            }}
          />
        </div>

        <select value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} style={sel}>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <select value={statusFilter} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={sel}>
          {STATUS_OPTS.map((s) => (
            <option key={s} value={s}>{s === "All Status" ? "All Status" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        {/* Sort pills */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
          {(["name","status","alerts","devices","region"] as SortKey[]).map((k) => (
            <button key={k} onClick={() => toggleSort(k)} style={{
              height: 28, padding: "0 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
              border: `1px solid ${sortKey === k ? "#6366f1" : "hsl(var(--border)/0.5)"}`,
              background: sortKey === k ? "rgba(99,102,241,0.12)" : "transparent",
              color: sortKey === k ? "#818cf8" : "hsl(var(--foreground-muted))",
              display: "flex", alignItems: "center", gap: 3, transition: "all 0.15s",
            }}>
              {k.charAt(0).toUpperCase() + k.slice(1)} <SortArrow k={k} />
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, color: "hsl(var(--foreground-muted))", whiteSpace: "nowrap" }}>
          {filtered.length} of {sites.length}
        </div>
      </div>

      {/* ─── Grid ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
        {paginated.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "hsl(var(--foreground-muted))", fontSize: 14 }}>
            No sites match your filters
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
            {paginated.map((site) => {
              const badge    = badgeForStatus(site.health_status);
              const hasAlert = site._alertCount > 0;

              return (
                <button
                  key={site.node_id}
                  onClick={() => onSiteClick?.(site.site_id)}
                  style={{
                    display: "flex", flexDirection: "column", textAlign: "left", cursor: "pointer",
                    border: `1px solid ${hasAlert ? badge.color : "hsl(var(--border)/0.4)"}`,
                    borderLeft: `3px solid ${badge.color}`,
                    borderRadius: 8,
                    background: hasAlert ? healthBg(site.health_status) : "hsl(var(--surface)/0.6)",
                    padding: "12px 14px",
                    transition: "transform 0.15s, box-shadow 0.15s",
                    gap: 0,
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = `0 4px 20px ${badge.color}28`;
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.transform = "";
                    el.style.boxShadow = "";
                  }}
                >
                  {/* Name + status dot */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {site.name || site.site_name || site.site_id}
                    </span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: badge.color, flexShrink: 0, marginTop: 4, boxShadow: hasAlert ? `0 0 6px ${badge.color}` : "none" }} />
                  </div>

                  {/* Region */}
                  <div style={{ fontSize: 10, color: "hsl(var(--foreground-muted))", marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📍 {site._region}
                  </div>

                  {/* Metrics */}
                  <div style={{ display: "flex", gap: 0, border: "1px solid hsl(var(--border)/0.3)", borderRadius: 6, overflow: "hidden", marginBottom: hasAlert ? 8 : 0 }}>
                    {([
                      { val: site.device_count ?? 0,   label: "APs",    color: "#8b5cf6" },
                      { val: site._alertCount,          label: "Alerts", color: site._alertCount > 0 ? badge.color : "#10b981" },
                    ] as const).map(({ val, label, color }, i) => (
                      <div key={label} style={{ flex: 1, padding: "6px 4px", textAlign: "center", borderRight: i === 0 ? "1px solid hsl(var(--border)/0.3)" : "none" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color }}>{val}</div>
                        <div style={{ fontSize: 9, color: "hsl(var(--foreground-muted))", marginTop: 1 }}>{label}</div>
                      </div>
                    ))}
                    <div style={{ flex: 1, padding: "5px 4px", textAlign: "center", borderLeft: "1px solid hsl(var(--border)/0.3)" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: badge.color, paddingTop: 2 }}>{badge.label}</div>
                      <div style={{ fontSize: 9, color: "hsl(var(--foreground-muted))", marginTop: 1 }}>Status</div>
                    </div>
                  </div>

                  {/* Alert chips */}
                  {hasAlert && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(site.critical_count ?? 0) > 0 && (
                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: "rgba(239,68,68,0.15)", color: "#ef4444", fontWeight: 600 }}>
                          {site.critical_count} Critical
                        </span>
                      )}
                      {(site.warning_count ?? 0) > 0 && (
                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 600 }}>
                          {site.warning_count} Warning
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Pagination ─────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 16px", borderTop: "1px solid hsl(var(--border)/0.4)" }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid hsl(var(--border)/0.5)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 12, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>
            ← Prev
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => (
            <button key={i} onClick={() => setPage(i)} style={{
              width: 28, height: 28, borderRadius: 6, fontSize: 11, cursor: "pointer",
              border: `1px solid ${i === page ? "#6366f1" : "hsl(var(--border)/0.4)"}`,
              background: i === page ? "rgba(99,102,241,0.15)" : "transparent",
              color: i === page ? "#818cf8" : "hsl(var(--foreground-muted))",
              fontWeight: i === page ? 700 : 400,
            }}>{i + 1}</button>
          ))}
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid hsl(var(--border)/0.5)", background: "transparent", color: "hsl(var(--foreground))", fontSize: 12, cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
            Next →
          </button>
          <span style={{ fontSize: 11, color: "hsl(var(--foreground-muted))", marginLeft: 4 }}>
            Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, sorted.length)} of {sorted.length}
          </span>
        </div>
      )}
    </div>
  );
}
