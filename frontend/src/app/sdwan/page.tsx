"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  MapPin,
  Radio,
  Search,
  Send,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary, VeloBrainLink } from "@/types/device";

function fmt(n: number) { return new Intl.NumberFormat("en-US").format(n); }
function fmtMbps(bps: number) {
  if (!bps) return "—";
  const mbps = bps / 1_000_000;
  return mbps >= 1 ? `${mbps.toFixed(0)} Mbps` : `${(bps / 1000).toFixed(0)} Kbps`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NavTab = "overview" | "edges" | "linkhealth" | "chat";

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 4) return "text-success";
  if (score >= 3) return "text-major";
  return "text-critical";
}
function scoreBg(score: number) {
  if (score >= 4) return "bg-success";
  if (score >= 3) return "bg-major";
  return "bg-critical";
}
function scoreLabel(score: number) {
  if (score >= 4.5) return "Excellent";
  if (score >= 4) return "Good";
  if (score >= 3) return "Fair";
  if (score >= 2) return "Poor";
  return "Critical";
}

function ScoreBar({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const pct = Math.min(100, (score / 5) * 100);
  const h = size === "sm" ? "h-1" : "h-1.5";
  const w = size === "sm" ? "w-16" : "w-24";
  return (
    <div className="flex items-center gap-2">
      <div className={`${h} ${w} rounded-full bg-surface-subtle overflow-hidden`}>
        <div className={`h-full rounded-full ${scoreBg(score)}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold ${scoreColor(score)}`}>{score.toFixed(1)}</span>
      <span className={`text-[10px] ${scoreColor(score)}`}>{scoreLabel(score)}</span>
    </div>
  );
}

function UtilBar({ avgMbps, provisionedMbps, dir }: { avgMbps: number; provisionedMbps: number | null; dir: string }) {
  const pct = provisionedMbps && provisionedMbps > 0 ? Math.min(100, (avgMbps / provisionedMbps) * 100) : null;
  const barColor = pct == null ? "bg-foreground-subtle" : pct > 90 ? "bg-critical" : pct > 70 ? "bg-major" : "bg-success";
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <span className="text-foreground-subtle text-[10px] w-3">{dir}</span>
      <div className="h-1 w-16 rounded-full bg-surface-subtle overflow-hidden">
        {pct != null && <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />}
      </div>
      <span className="font-mono text-[11px] text-foreground">
        {avgMbps >= 1 ? `${avgMbps.toFixed(1)}` : avgMbps > 0 ? `${(avgMbps * 1000).toFixed(0)}k` : "—"}
        {provisionedMbps ? `/${provisionedMbps}` : ""} Mbps
        {pct != null && <span className="text-foreground-subtle ml-0.5">({pct.toFixed(0)}%)</span>}
      </span>
    </div>
  );
}

function StateChip({ reachability }: { reachability: DeviceReachability }) {
  if (reachability === "reachable")
    return <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">Connected</span>;
  if (reachability === "degraded")
    return <span className="inline-flex items-center gap-1 rounded-full border border-major/25 bg-major/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-major">Degraded</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-critical/25 bg-critical/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-critical">Offline</span>;
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ devices }: { devices: DeviceSummary[] }) {
  const stats = useMemo(() => {
    const connected = devices.filter(d => d.reachability === "reachable").length;
    const degraded = devices.filter(d => d.reachability === "degraded").length;
    const offline = devices.filter(d => d.reachability === "unreachable").length;
    const withScore = devices.filter(d => d.props?.velobrain_score !== undefined);
    const avgScore = withScore.length
      ? withScore.reduce((s, d) => s + (d.props?.velobrain_score ?? 0), 0) / withScore.length
      : 0;
    const criticalLinks = devices.filter(d => (d.props?.velobrain_score ?? 5) < 2);
    const sites = new Set(devices.map(d => d.site_name)).size;
    return { connected, degraded, offline, avgScore, criticalLinks, sites };
  }, [devices]);

  const recentIssues = useMemo(() =>
    devices
      .filter(d => d.reachability !== "reachable")
      .slice(0, 8),
    [devices]
  );

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Total Edges", value: devices.length, color: "text-foreground" },
          { label: "Connected", value: stats.connected, color: "text-success" },
          { label: "Degraded", value: stats.degraded, color: "text-major" },
          { label: "Offline", value: stats.offline, color: "text-critical" },
          { label: "Sites", value: stats.sites, color: "text-foreground" },
        ].map(k => (
          <div key={k.label} className="rounded-lg border border-border/50 bg-surface/40 px-4 py-3">
            <div className={`text-xl font-bold font-mono ${k.color}`}>{k.value}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mt-0.5">{k.label}</div>
          </div>
        ))}
        <div className="rounded-lg border border-border/50 bg-surface/40 px-4 py-3">
          <div className={`text-xl font-bold font-mono ${scoreColor(stats.avgScore)}`}>{stats.avgScore.toFixed(1)}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mt-0.5">Avg VeloBrain</div>
        </div>
      </div>

      {/* Issue list */}
      {recentIssues.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-foreground-subtle mb-3 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-major" /> Edges with issues
          </h3>
          <div className="space-y-2">
            {recentIssues.map(d => (
              <div key={d.device_id} className="flex items-center justify-between rounded-lg border border-border/40 bg-surface/30 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Radio className="h-4 w-4 text-foreground-subtle" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{d.hostname}</div>
                    <div className="text-[11px] text-foreground-muted">{d.site_name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {d.props?.velobrain_score !== undefined && (
                    <ScoreBar score={d.props.velobrain_score} size="sm" />
                  )}
                  <StateChip reachability={d.reachability} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentIssues.length === 0 && devices.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div>
            <p className="font-medium text-foreground">All edges connected</p>
            <p className="text-sm text-foreground-muted">No faults detected across {devices.length} edges and {stats.sites} sites.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edges tab ─────────────────────────────────────────────────────────────────

function EdgeRow({ device }: { device: DeviceSummary }) {
  const score = device.props?.velobrain_score;
  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-3 hover:bg-surface transition-colors text-sm">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle/40">
          <Radio className="h-4 w-4 text-emerald-400" />
          <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${device.reachability === "reachable" ? "bg-success" : device.reachability === "degraded" ? "bg-major" : "bg-critical"}`} />
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground group-hover:text-primary text-xs">{device.hostname}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {device.serial && <span className="font-mono text-[10px] text-foreground-subtle">{device.serial}</span>}
            {device.model && <span className="rounded border border-emerald-400/20 bg-emerald-400/8 px-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">{device.model}</span>}
          </div>
        </div>
      </div>
      <div className="col-span-6 lg:col-span-2 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5 flex items-center gap-1"><MapPin className="h-3 w-3" />Site</div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>
      <div className="col-span-6 lg:col-span-2 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">WAN IP</div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>
      <div className="col-span-6 lg:col-span-2 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle mb-0.5">VeloBrain Score</div>
        {score !== undefined ? <ScoreBar score={score} size="sm" /> : <span className="text-foreground-subtle">—</span>}
      </div>
      <div className="col-span-6 lg:col-span-2 text-right">
        <StateChip reachability={device.reachability} />
        {device.firmware_version && (
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-foreground-subtle">
            <Zap className="h-3 w-3" />{device.firmware_version}
          </div>
        )}
      </div>
    </div>
  );
}

function EdgesTab({ devices }: { devices: DeviceSummary[] }) {
  const [search, setSearch] = useState("");
  const [rf, setRf] = useState<DeviceReachability | "all">("all");
  const [groupBySite, setGroupBySite] = useState(true);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return devices.filter(d => {
      if (rf !== "all" && d.reachability !== rf) return false;
      if (!term) return true;
      return d.hostname.toLowerCase().includes(term) || d.serial.toLowerCase().includes(term) ||
        d.model.toLowerCase().includes(term) || d.site_name.toLowerCase().includes(term) ||
        d.ip_address.toLowerCase().includes(term);
    });
  }, [devices, rf, search]);

  const siteGroups = useMemo(() => {
    const map = new Map<string, DeviceSummary[]>();
    for (const d of filtered) {
      const k = d.site_name || "Unknown";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
          <input type="text" placeholder="Search edge, serial, model, site, WAN IP..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border-b border-border/70 bg-transparent pl-7 pr-4 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30" />
        </div>
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-foreground-subtle" />
          <select value={rf} onChange={e => setRf(e.target.value as DeviceReachability | "all")}
            className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none">
            <option value="all">All Status</option>
            <option value="reachable">Connected</option>
            <option value="degraded">Degraded</option>
            <option value="unreachable">Offline</option>
          </select>
          <button onClick={() => setGroupBySite(g => !g)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${groupBySite ? "border-primary/40 text-primary bg-primary/5" : "border-border/60 text-foreground-muted"}`}>
            Group by site
          </button>
          {(search || rf !== "all") && (
            <button onClick={() => { setSearch(""); setRf("all"); }} className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {groupBySite ? (
        <div className="space-y-2">
          {siteGroups.map(([site, devs]) => {
            const [open, setOpen] = useState(true);
            const up = devs.filter(d => d.reachability === "reachable").length;
            const down = devs.filter(d => d.reachability !== "reachable").length;
            return (
              <div key={site} className="border border-border/50 rounded-lg overflow-hidden">
                <button onClick={() => setOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface/80 transition-colors">
                  <div className="flex items-center gap-3">
                    {open ? <ChevronDown className="h-4 w-4 text-foreground-subtle" /> : <ChevronRight className="h-4 w-4 text-foreground-subtle" />}
                    <MapPin className="h-4 w-4 text-emerald-400" />
                    <span className="font-medium text-foreground text-sm">{site}</span>
                    <Badge variant="outline" className="text-[10px]">{devs.length} edges</Badge>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-success">{up} up</span>
                    {down > 0 && <span className="text-critical">{down} down</span>}
                  </div>
                </button>
                {open && <div className="divide-y divide-border/40">{devs.map(d => <EdgeRow key={d.device_id} device={d} />)}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <div className="hidden grid-cols-12 gap-3 border-b border-border/60 bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid">
            <div className="col-span-4">Edge</div><div className="col-span-2">Site</div>
            <div className="col-span-2">WAN IP</div><div className="col-span-2">VeloBrain</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          <div className="divide-y divide-border/40">
            {filtered.map(d => <EdgeRow key={d.device_id} device={d} />)}
          </div>
        </div>
      )}
      <div className="text-center text-xs text-foreground-subtle">{filtered.length} of {devices.length} edges</div>
    </div>
  );
}

// ── Link Health tab ───────────────────────────────────────────────────────────

function LinkHealthRow({ device }: { device: DeviceSummary }) {
  const [open, setOpen] = useState(false);
  const links: VeloBrainLink[] = device.props?.links ?? [];
  const score = device.props?.velobrain_score;

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface/40 hover:bg-surface/70 transition-colors">
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-foreground-subtle" /> : <ChevronRight className="h-3.5 w-3.5 text-foreground-subtle" />}
          <Radio className="h-4 w-4 text-emerald-400" />
          <span className="font-medium text-foreground text-sm">{device.hostname}</span>
          <span className="text-xs text-foreground-muted">{device.site_name}</span>
          <Badge variant="outline" className="text-[10px]">{links.length} WAN links</Badge>
        </div>
        <div className="flex items-center gap-4">
          {score !== undefined ? <ScoreBar score={score} size="sm" /> : <span className="text-xs text-foreground-subtle">No data</span>}
          <StateChip reachability={device.reachability} />
        </div>
      </button>
      {open && (
        <div className="divide-y divide-border/30 bg-background/50">
          {links.length === 0 ? (
            <div className="px-6 py-4 text-sm text-foreground-muted">No link metrics collected yet.</div>
          ) : links.map((link, i) => (
            <div key={i} className="px-6 py-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">Link</div>
                <div className="font-medium text-foreground">{link.name || `Link ${i + 1}`}</div>
                <div className={`text-[10px] font-bold mt-0.5 ${link.state === "STABLE" ? "text-success" : link.state === "UNSTABLE" ? "text-major" : "text-critical"}`}>{link.state}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">VeloBrain Score</div>
                <ScoreBar score={Math.min(link.score_tx, link.score_rx)} size="sm" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">Latency</div>
                <div className="font-mono text-foreground">↓ {link.latency_ms_rx.toFixed(1)} ms</div>
                <div className="font-mono text-foreground-muted text-[11px]">↑ {link.latency_ms_tx.toFixed(1)} ms</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">Jitter</div>
                <div className="font-mono text-foreground">↓ {link.jitter_ms_rx.toFixed(1)} ms</div>
                <div className="font-mono text-foreground-muted text-[11px]">↑ {link.jitter_ms_tx.toFixed(1)} ms</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">Packet Loss</div>
                <div className={`font-mono ${link.loss_pct_rx > 1 ? "text-critical" : link.loss_pct_rx > 0.1 ? "text-major" : "text-success"}`}>↓ {link.loss_pct_rx.toFixed(2)}%</div>
                <div className="font-mono text-foreground-muted text-[11px]">↑ {link.loss_pct_tx.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-subtle mb-1">
                  Throughput{link.downstream_mbps ? " / Capacity" : ""}
                </div>
                <UtilBar avgMbps={link.avg_mbps_rx ?? (link.bps_rx / 1_000_000)} provisionedMbps={link.downstream_mbps ?? null} dir="↓" />
                <UtilBar avgMbps={link.avg_mbps_tx ?? (link.bps_tx / 1_000_000)} provisionedMbps={link.upstream_mbps ?? null} dir="↑" />
                {link.isp && (
                  <div className="text-[10px] text-foreground-subtle mt-1 truncate">{link.isp}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkHealthTab({ devices }: { devices: DeviceSummary[] }) {
  const sorted = useMemo(() =>
    [...devices]
      .filter(d => d.props?.links?.length)
      .sort((a, b) => (a.props?.velobrain_score ?? 5) - (b.props?.velobrain_score ?? 5)),
    [devices]
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 border-t border-border/60 py-12">
        <Activity className="h-6 w-6 text-foreground-subtle" />
        <div>
          <p className="font-semibold text-foreground">VeloBrain metrics not yet collected</p>
          <p className="mt-1 text-sm text-foreground-muted">Link quality data will appear after the next worker collection cycle (runs every 60 seconds).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">Sorted worst-first by VeloBrain score. Expand any edge to see per-link latency, jitter, loss and bandwidth.</p>
      {sorted.map(d => <LinkHealthRow key={d.device_id} device={d} />)}
    </div>
  );
}

// ── Chat tab ──────────────────────────────────────────────────────────────────

interface Message { role: "user" | "assistant"; content: string; }

const SUGGESTIONS = [
  "Show me a network health summary",
  "Which edges have the worst WAN quality?",
  "Are there any offline edges?",
  "Show all unstable WAN links",
  "Which sites are performing best?",
];

function MarkdownLine({ text }: { text: string }) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
}

function AssistantBubble({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1 text-sm text-foreground leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (line.startsWith("- ") || line.startsWith("· "))
          return <div key={i} className="flex gap-2"><span className="text-foreground-subtle mt-0.5 shrink-0">·</span><MarkdownLine text={line.slice(2)} /></div>;
        if (/^\d+\./.test(line))
          return <div key={i} className="flex gap-2"><span className="text-foreground-subtle shrink-0">{line.match(/^\d+/)?.[0]}.</span><MarkdownLine text={line.replace(/^\d+\.\s*/, "")} /></div>;
        return <div key={i}><MarkdownLine text={line} /></div>;
      })}
    </div>
  );
}

function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "**VeloBrain Intelligence** — ask me anything about your SD-WAN.\n\nI have live access to VeloBrain scores, link quality metrics (latency, jitter, loss), and edge status across all Tata Motors sites." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const data = await api.sdwanChat(text, history);
      setMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Failed to reach the intelligence engine. Please try again." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-[640px] rounded-xl border border-border/50 overflow-hidden bg-background">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="h-7 w-7 shrink-0 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center mt-0.5">
                <Bot className="h-3.5 w-3.5 text-emerald-400" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
              m.role === "user"
                ? "bg-primary/10 border border-primary/20 text-foreground text-sm"
                : "bg-surface border border-border/50"
            }`}>
              {m.role === "assistant"
                ? <AssistantBubble content={m.content} />
                : <span className="text-sm">{m.content}</span>}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="h-7 w-7 shrink-0 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="rounded-xl px-4 py-3 bg-surface border border-border/50">
              <div className="flex gap-1 items-center h-5">
                {[0, 1, 2].map(i => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-emerald-400/60"
                    style={{ animation: `naxis-blink 1.2s ${i * 0.2}s ease-in-out infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => send(s)}
              className="text-xs rounded-full border border-emerald-400/25 bg-emerald-400/8 px-3 py-1.5 text-emerald-400 hover:bg-emerald-400/15 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/50 px-4 py-3 flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send(input)}
          placeholder="Ask about link quality, offline edges, worst sites..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
          disabled={loading}
        />
        <button onClick={() => send(input)} disabled={!input.trim() || loading}
          className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-400/15 border border-emerald-400/25 text-emerald-400 hover:bg-emerald-400/25 disabled:opacity-30 transition-colors">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: Array<{ id: NavTab; label: string; icon: React.ElementType }> = [
  { id: "overview",   label: "Overview",    icon: Activity },
  { id: "edges",      label: "Edges",       icon: Radio },
  { id: "linkhealth", label: "Link Health", icon: Wifi },
  { id: "chat",       label: "VeloBrain AI", icon: Bot },
];

export default function SdwanObserverPage() {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sdwan-devices"],
    queryFn: () => api.listDevices({ platform: "velocloud", limit: 2000 }),
    refetchInterval: 60000,
  });

  const devices = data?.devices ?? [];

  const tabStats = useMemo(() => ({
    issues: devices.filter(d => d.reachability !== "reachable").length,
    degraded: devices.filter(d => (d.props?.velobrain_score ?? 5) < 3.5).length,
  }), [devices]);

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}
        <div className="border-b border-border/60 pb-6">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
            <Radio className="h-3.5 w-3.5" /> Platform Observer
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">VeloCloud SD-WAN</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {devices.length} edges · VeloBrain link intelligence · Real-time WAN health
          </p>
        </div>

        {/* Tab nav */}
        <div className="flex items-center gap-1 border-b border-border/40">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground-muted hover:text-foreground hover:border-border"
              }`}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.id === "overview" && tabStats.issues > 0 && (
                <span className="ml-1 rounded-full bg-critical/15 px-1.5 py-0.5 text-[10px] font-bold text-critical">{tabStats.issues}</span>
              )}
              {tab.id === "linkhealth" && tabStats.degraded > 0 && (
                <span className="ml-1 rounded-full bg-major/15 px-1.5 py-0.5 text-[10px] font-bold text-major">{tabStats.degraded}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : error ? (
          <div className="border-l-2 border-l-critical-border pl-4 py-3 text-critical">
            <p className="font-medium">Failed to load SD-WAN inventory</p>
            <p className="text-sm text-foreground-muted">{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        ) : (
          <>
            {activeTab === "overview"   && <OverviewTab devices={devices} />}
            {activeTab === "edges"      && <EdgesTab devices={devices} />}
            {activeTab === "linkhealth" && <LinkHealthTab devices={devices} />}
            {activeTab === "chat"       && <ChatTab />}
          </>
        )}

      </div>
    </div>
  );
}
