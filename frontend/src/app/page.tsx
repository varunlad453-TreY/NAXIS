"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  HardDrive,
  MapPin,
  Network,
  Radio,
  Search,
  Server,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { DeviceReachability, DeviceSummary } from "@/types/device";

function fmt(n: number) { return new Intl.NumberFormat("en-US").format(n); }
function formatUptime(s: number) {
  if (!s) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}
function useCount(key: string[], fn: () => Promise<{ total: number }>) {
  const { data } = useQuery({ queryKey: key, queryFn: fn, refetchInterval: 15000 });
  return data?.total ?? 0;
}

// ─── Animated counter ────────────────────────────────────────────────────────

function AnimatedCounter({ target, duration = 1400 }: { target: number; duration?: number }) {
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

// ─── Starfield ───────────────────────────────────────────────────────────────

function Starfield() {
  const stars = useMemo(() => Array.from({ length: 140 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    r: Math.random() * 1.3 + 0.3,
    anim: ["naxis-twinkle-a", "naxis-twinkle-b", "naxis-twinkle-c"][i % 3],
    dur: (Math.random() * 4 + 2).toFixed(1),
    delay: (Math.random() * 6).toFixed(1),
  })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden dark-only-stars">
      <svg className="w-full h-full opacity-70 dark:opacity-100" xmlns="http://www.w3.org/2000/svg">
        {stars.map(s => (
          <circle key={s.id} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r}
            fill="rgba(148,163,184,0.7)"
            style={{ animation: `${s.anim} ${s.dur}s ${s.delay}s ease-in-out infinite` }} />
        ))}
      </svg>
    </div>
  );
}

// ─── Orbital system ──────────────────────────────────────────────────────────

function OrbitalSystem({ eventCount }: { eventCount: number }) {
  return (
    <div className="pointer-events-none select-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4"
      style={{ width: 560, height: 560 }}>
      <div className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle at 50% 50%, hsl(var(--primary)/0.07) 0%, transparent 70%)" }} />

      {/* rings */}
      <div className="absolute inset-0 rounded-full border border-primary/10" />
      <div className="absolute rounded-full border border-primary/12" style={{ inset: 56 }} />
      <div className="absolute rounded-full border border-violet-500/8" style={{ inset: 112 }} />

      {/* arm 1 CW 18s */}
      <div className="absolute inset-0 rounded-full" style={{ animation: "naxis-orbit-cw 18s linear infinite" }}>
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="h-3 w-3 rounded-full bg-cyan-400" style={{ boxShadow: "0 0 10px 3px rgba(6,182,212,0.7)" }} />
        </div>
      </div>
      {/* arm 2 CCW 26s */}
      <div className="absolute rounded-full" style={{ inset: 56, animation: "naxis-orbit-ccw 26s linear infinite" }}>
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="h-2.5 w-2.5 rounded-full bg-violet-400" style={{ boxShadow: "0 0 8px 2px rgba(139,92,246,0.7)" }} />
        </div>
      </div>
      {/* arm 3 CW 11s */}
      <div className="absolute rounded-full" style={{ inset: 56, animation: "naxis-orbit-cw 11s linear infinite" }}>
        <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2">
          <div className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px 2px rgba(52,211,153,0.7)" }} />
        </div>
      </div>
      {/* arm 4 CCW 20s inner */}
      <div className="absolute rounded-full" style={{ inset: 112, animation: "naxis-orbit-ccw 20s linear infinite" }}>
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2">
          <div className="h-2 w-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 8px 2px rgba(251,191,36,0.7)" }} />
        </div>
      </div>

      {/* centre */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div style={{ animation: "naxis-orb-pulse 4s ease-in-out infinite, naxis-float 7s ease-in-out infinite" }}>
          <div className="absolute h-36 w-36 rounded-full border border-primary/20 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2" />
          <div className="absolute h-28 w-28 rounded-full border border-primary/15 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 overflow-hidden"
            style={{ animation: "naxis-radar 8s linear infinite" }}>
            <div className="absolute top-1/2 left-1/2 w-1/2 h-px bg-gradient-to-r from-primary/80 to-transparent origin-left" />
          </div>
          <div className="h-20 w-20 rounded-full flex flex-col items-center justify-center text-center"
            style={{
              background: "radial-gradient(circle, hsl(var(--primary)/0.2) 0%, hsl(var(--primary)/0.04) 60%, transparent 100%)",
              boxShadow: "0 0 0 1px hsl(var(--primary)/0.25), inset 0 0 20px hsl(var(--primary)/0.08)",
            }}>
            <div className="text-base font-bold font-mono text-primary leading-none">
              <AnimatedCounter target={eventCount} />
            </div>
            <div className="text-[7px] font-bold uppercase tracking-[0.2em] text-primary/60 mt-0.5">Events</div>
          </div>
        </div>
      </div>

      {/* HUD labels */}
      <div className="absolute top-6 right-10 text-right" style={{ animation: "naxis-enter 1s 0.8s both" }}>
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">Platforms</div>
        <div className="font-mono text-sm font-bold text-amber-400">4</div>
      </div>
      <div className="absolute bottom-14 left-6" style={{ animation: "naxis-enter 1s 1s both" }}>
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle">Vendors</div>
        <div className="font-mono text-sm font-bold text-emerald-400">1 Live</div>
      </div>
    </div>
  );
}

// ─── HUD corner ──────────────────────────────────────────────────────────────

function HudCorner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const cls = { tl: "top-0 left-0 border-t border-l", tr: "top-0 right-0 border-t border-r", bl: "bottom-0 left-0 border-b border-l", br: "bottom-0 right-0 border-b border-r" }[pos];
  return <div className={`absolute h-3.5 w-3.5 ${cls} border-cyan-400/50`} />;
}

// ─── Data ticker ─────────────────────────────────────────────────────────────

const TICKER = [
  "MIST · Wireless observer active",
  "NAXIS · Multi-vendor ingestion running",
  "SYSTEM · 61 sites monitored",
  "TELEMETRY · Event stream live",
  "NETWORK · 4 platform connectors",
  "STATUS · All collectors nominal",
];

function DataTicker({ eventCount }: { eventCount: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % TICKER.length), 2800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-4 overflow-hidden border border-primary/15 bg-primary/4 px-4 py-2 rounded-lg text-[11px] font-mono"
      style={{ animation: "naxis-hud-pulse 3s ease-in-out infinite" }}>
      <span className="shrink-0 flex items-center gap-1.5 text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "naxis-blink 1s step-end infinite" }} />
        LIVE
      </span>
      <span className="text-foreground-subtle truncate">{TICKER[idx]}</span>
      <span className="ml-auto shrink-0 text-foreground-subtle/50 hidden sm:block">
        {fmt(eventCount)} events ingested
      </span>
    </div>
  );
}

// ─── Platform card ───────────────────────────────────────────────────────────

interface PlatformCardProps {
  href: string; icon: React.ReactNode; label: string; sublabel: string;
  description: string; stat?: { value: string; label: string };
  active: boolean; accentRgb: string; tag: string; delay: number;
}

function PlatformCard({ href, icon, label, sublabel, description, stat, active, accentRgb, tag, delay }: PlatformCardProps) {
  return (
    <Link href={href}
      className="group relative flex flex-col gap-4 rounded-xl p-5 overflow-hidden transition-all duration-500"
      style={{
        border: `1px solid rgba(${accentRgb},0.2)`,
        background: `radial-gradient(circle at 50% 0%, rgba(${accentRgb},0.06) 0%, transparent 70%)`,
        opacity: active ? 1 : 0.35,
        pointerEvents: active ? "auto" : "none",
        animation: `naxis-enter 0.7s ${delay}s both`,
      }}>
      {active && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-xl"
          style={{ background: `radial-gradient(circle at 50% 0%, rgba(${accentRgb},0.1) 0%, transparent 60%)` }} />
      )}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg"
          style={{ background: `rgba(${accentRgb},0.1)`, border: `1px solid rgba(${accentRgb},0.2)`,
            color: `rgb(${accentRgb})`, boxShadow: active ? `0 0 20px rgba(${accentRgb},0.15)` : "none" }}>
          {icon}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: `rgb(${accentRgb})`, background: `rgba(${accentRgb},0.1)`, border: `1px solid rgba(${accentRgb},0.25)` }}>
            {tag}
          </span>
          {!active && (
            <span className="rounded-full border border-border/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-foreground-subtle">
              Soon
            </span>
          )}
        </div>
      </div>
      <div className="relative space-y-1.5 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-foreground-subtle">{sublabel}</p>
        <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">{label}</h3>
        <p className="text-xs leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <div className="relative flex items-center justify-between border-t pt-3"
        style={{ borderColor: `rgba(${accentRgb},0.12)` }}>
        {stat ? (
          <div>
            <span className="text-base font-bold font-mono" style={{ color: `rgb(${accentRgb})` }}>{stat.value}</span>
            <span className="ml-1.5 text-[10px] text-foreground-subtle">{stat.label}</span>
          </div>
        ) : (
          <span className="text-[10px] text-foreground-subtle">Awaiting credentials</span>
        )}
        {active && (
          <div className="h-6 w-6 rounded-full flex items-center justify-center transition-all duration-300 group-hover:translate-x-1"
            style={{ background: `rgba(${accentRgb},0.1)`, color: `rgb(${accentRgb})` }}>
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      {active && <><HudCorner pos="tl" /><HudCorner pos="br" /></>}
    </Link>
  );
}

// ─── Inline inventory ────────────────────────────────────────────────────────

function ReachDot({ status }: { status: DeviceReachability }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${status === "reachable" ? "bg-success" : status === "unreachable" ? "bg-critical" : "bg-foreground-subtle"}`} />;
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  return (
    <div className="group grid grid-cols-12 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-primary/4 text-sm border-b border-border/20 last:border-0">
      <div className="col-span-12 flex items-center gap-3 lg:col-span-4">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface/60 text-foreground-subtle">
          <Wifi className="h-3 w-3" />
          <span className="absolute -right-0.5 -top-0.5"><ReachDot status={device.reachability} /></span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{device.hostname || device.device_id}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="font-mono text-[9px] text-foreground-subtle">{device.mac}</span>
            {device.model && <span className="rounded border border-violet-400/20 bg-violet-400/10 px-1 text-[8px] font-bold uppercase text-violet-400">{device.model}</span>}
          </div>
        </div>
      </div>
      <div className="col-span-6 lg:col-span-3 text-xs">
        <div className="text-[9px] font-bold uppercase tracking-wider text-foreground-subtle mb-0.5 flex items-center gap-1"><MapPin className="h-2 w-2" />Site</div>
        <div className="truncate text-foreground">{device.site_name || "—"}</div>
      </div>
      <div className="col-span-6 lg:col-span-2 text-xs">
        <div className="text-[9px] font-bold uppercase tracking-wider text-foreground-subtle mb-0.5">IP</div>
        <div className="font-mono text-foreground">{device.ip_address || "—"}</div>
      </div>
      <div className="col-span-6 lg:col-span-2 flex gap-3 text-xs">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-foreground-subtle mb-0.5 flex items-center gap-0.5"><Users className="h-2 w-2" />Clients</div>
          <div className="text-foreground">{device.num_clients}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-foreground-subtle mb-0.5 flex items-center gap-0.5"><Clock className="h-2 w-2" />Up</div>
          <div className="text-foreground">{formatUptime(device.uptime_seconds)}</div>
        </div>
      </div>
      <div className="col-span-6 lg:col-span-1 text-right text-xs">
        <div className="flex items-center justify-end gap-1"><ReachDot status={device.reachability} /><span className="capitalize text-foreground-muted">{device.reachability}</span></div>
        {device.firmware_version && <div className="flex items-center justify-end gap-0.5 mt-0.5 text-[9px] text-foreground-subtle"><Zap className="h-2 w-2" />{device.firmware_version}</div>}
      </div>
    </div>
  );
}

function SiteGroup({ siteName, devices }: { siteName: string; devices: DeviceSummary[] }) {
  const [open, setOpen] = useState(false);
  const up = devices.filter(d => d.reachability === "reachable").length;
  const down = devices.filter(d => d.reachability === "unreachable").length;
  return (
    <div className="rounded-lg overflow-hidden border border-border/30">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 bg-surface/40 hover:bg-surface/70 transition-colors">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3 w-3 text-foreground-subtle" /> : <ChevronRight className="h-3 w-3 text-foreground-subtle" />}
          <MapPin className="h-3 w-3 text-violet-400" />
          <span className="text-xs font-medium text-foreground">{siteName}</span>
          <Badge variant="outline" className="text-[9px] py-0 h-4">{devices.length}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-success">{up} up</span>
          {down > 0 && <span className="text-critical">{down} down</span>}
        </div>
      </button>
      {open && devices.map(d => <DeviceRow key={d.device_id} device={d} />)}
    </div>
  );
}

function InventoryPanel() {
  const [search, setSearch] = useState("");
  const [rf, setRf] = useState<DeviceReachability | "all">("all");
  const { data, isLoading } = useQuery({ queryKey: ["home-devices"], queryFn: () => api.listDevices({ limit: 2000 }), refetchInterval: 60000 });
  const devices = data?.devices ?? [];
  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return devices.filter(d => {
      if (rf !== "all" && d.reachability !== rf) return false;
      if (!term) return true;
      return d.hostname.toLowerCase().includes(term) || d.mac.toLowerCase().includes(term) || d.model.toLowerCase().includes(term) || d.site_name.toLowerCase().includes(term) || d.ip_address.toLowerCase().includes(term);
    });
  }, [devices, rf, search]);
  const groups = useMemo(() => {
    const map = new Map<string, DeviceSummary[]>();
    for (const d of filtered) { const k = d.site_name || "Unknown"; if (!map.has(k)) map.set(k, []); map.get(k)!.push(d); }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);
  const stats = useMemo(() => ({
    online: devices.filter(d => d.reachability === "reachable").length,
    offline: devices.filter(d => d.reachability === "unreachable").length,
    clients: devices.reduce((s, d) => s + (d.num_clients || 0), 0),
  }), [devices]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
        <span className="text-foreground-subtle"><span className="text-foreground font-bold">{fmt(devices.length)}</span> total</span>
        <span className="text-success"><span className="font-bold">{fmt(stats.online)}</span> online</span>
        <span className="text-critical"><span className="font-bold">{fmt(stats.offline)}</span> offline</span>
        <span className="text-foreground-subtle"><span className="text-foreground font-bold">{fmt(stats.clients)}</span> clients</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 text-foreground-subtle" />
          <input type="text" placeholder="Search hostname, MAC, model, site, IP..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border-b border-border/40 bg-transparent pl-5 pr-4 py-1.5 text-xs text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/40" />
        </div>
        <div className="flex items-center gap-2">
          <select value={rf} onChange={e => setRf(e.target.value as DeviceReachability | "all")}
            className="border-b border-border/40 bg-transparent px-1 py-1.5 text-xs text-foreground outline-none focus:border-primary/40">
            <option value="all">All</option>
            <option value="reachable">Online</option>
            <option value="unreachable">Offline</option>
          </select>
          {(search || rf !== "all") && <button onClick={() => { setSearch(""); setRf("all"); }}><X className="h-3 w-3 text-foreground-muted hover:text-foreground" /></button>}
          <span className="text-[10px] text-foreground-subtle font-mono">{filtered.length} devices</span>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>
      ) : groups.length === 0 ? (
        <div className="flex items-start gap-3 py-8 border-t border-border/30">
          <Server className="h-4 w-4 text-foreground-subtle mt-0.5" />
          <p className="text-xs text-foreground-muted">{devices.length === 0 ? "Inventory will appear after the first collection cycle." : "No devices match."}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
          {groups.map(([site, devs]) => <SiteGroup key={site} siteName={site} devices={devs} />)}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [showInventory, setShowInventory] = useState(false);
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api.health(), refetchInterval: 10000 });
  const mistDeviceCount = useCount(["mist-devices-count"], () => api.listDevices({ platform: "mist", limit: 1 }));
  const eventCount = useCount(["events-count"], () => api.listEvents({ limit: 1 }));
  const isOnline = health?.status === "healthy";

  // Platform-level stats — only counts things we actually have
  const hudStats = [
    { label: "Events Ingested", value: eventCount, rgb: "6,182,212" },
    { label: "Vendors Live", value: 1, rgb: "52,211,153" },
    { label: "Sites Monitored", value: 61, rgb: "167,139,250" },
    { label: "Platforms Total", value: 4, rgb: "251,191,36" },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">

      {/* Themed background layers */}
      <div className="pointer-events-none absolute inset-0">
        {/* dark: deep space gradient; light: subtle radial */}
        <div className="absolute inset-0 dark:opacity-100 opacity-60"
          style={{ background: "radial-gradient(ellipse 100% 70% at 60% 40%, hsl(var(--primary)/0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 100% at 100% 50%, hsl(var(--primary)/0.05) 0%, transparent 50%)" }} />
      </div>

      {/* Nebula blobs — dimmer in light mode */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-1/4 h-80 w-80 rounded-full dark:opacity-25 opacity-10"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(80px)", animation: "naxis-float 10s ease-in-out infinite" }} />
        <div className="absolute bottom-1/4 left-1/3 h-64 w-64 rounded-full dark:opacity-20 opacity-8"
          style={{ background: "radial-gradient(circle, rgba(6,182,212,0.5) 0%, transparent 70%)", filter: "blur(60px)", animation: "naxis-float 14s ease-in-out infinite reverse" }} />
      </div>

      {/* Stars — visible in dark, very subtle in light */}
      <Starfield />

      {/* Scan line */}
      <div className="pointer-events-none absolute left-0 right-0 h-px dark:opacity-25 opacity-10"
        style={{ background: "linear-gradient(90deg, transparent 0%, hsl(var(--primary)) 50%, transparent 100%)", animation: "naxis-scan 8s linear infinite", top: 0 }} />

      {/* Orbital system — desktop only */}
      <div className="hidden xl:block absolute right-0 top-0 bottom-0 w-[600px]">
        <OrbitalSystem eventCount={eventCount} />
      </div>

      {/* ── Content ── */}
      <div className="relative mx-auto max-w-6xl px-6 py-20 lg:px-8 space-y-16">

        {/* Ticker */}
        <div style={{ animation: "naxis-enter 0.6s 0.1s both" }}>
          <DataTicker eventCount={eventCount} />
        </div>

        {/* Hero */}
        <section className="max-w-2xl space-y-8" style={{ animation: "naxis-enter 0.8s 0.2s both" }}>

          {/* Status badge */}
          <div className="inline-flex items-center gap-3 rounded-full px-4 py-1.5"
            style={{ border: "1px solid hsl(var(--primary)/0.2)", background: "hsl(var(--primary)/0.06)", animation: "naxis-hud-pulse 3s ease-in-out infinite" }}>
            <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-success" : "bg-foreground-subtle"}`}
              style={{ animation: isOnline ? "naxis-blink 1.5s ease-in-out infinite" : "none", boxShadow: isOnline ? "0 0 8px 2px hsl(var(--success)/0.6)" : "none" }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
              {isOnline ? "All systems nominal" : "Connecting..."}
            </span>
            <span className="text-[10px] text-foreground-subtle font-mono">v2.0</span>
          </div>

          {/* Headline */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground-subtle mb-4">
              Network Resilient Platform · Tata Motors
            </p>
            <h1 className="text-6xl font-semibold tracking-tight text-foreground lg:text-7xl leading-none">
              <span className="block">One platform.</span>
              <span className="naxis-shimmer-text block mt-1">
                Every network.
              </span>
            </h1>
          </div>

          <p className="text-base leading-7 text-foreground-muted max-w-lg">
            Unified observability across wireless, wired, SD-WAN, and cloud — four platform observers feeding one intelligence layer.
          </p>

          {/* Platform-level HUD stats */}
          <div className="flex flex-wrap items-stretch gap-3">
            {hudStats.map(({ label, value, rgb }) => (
              <div key={label} className="relative flex flex-col px-4 py-3 rounded-lg min-w-[88px]"
                style={{ border: `1px solid rgba(${rgb},0.18)`, background: `rgba(${rgb},0.04)` }}>
                <HudCorner pos="tl" />
                <HudCorner pos="br" />
                <div className="text-xl font-bold font-mono" style={{ color: `rgb(${rgb})`, textShadow: `0 0 16px rgba(${rgb},0.4)` }}>
                  <AnimatedCounter target={value} />
                </div>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-subtle mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Platform observer cards */}
        <section style={{ animation: "naxis-enter 0.8s 0.4s both" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
            <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-foreground-subtle">Platform Observers</p>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/20 to-transparent" />
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <PlatformCard href="/mist" icon={<Wifi className="h-5 w-5" />} label="Juniper Mist" sublabel="Wireless"
              description="AP inventory, client sessions and RF health across 61 Tata Motors sites."
              stat={{ value: fmt(mistDeviceCount), label: "APs" }}
              active accentRgb="139,92,246" tag="Live" delay={0.5} />
            <PlatformCard href="/dnac" icon={<Network className="h-5 w-5" />} label="Cisco DNA Center" sublabel="Wired"
              description="Switches, routers and campus fabric. Full physical infrastructure."
              active={false} accentRgb="59,130,246" tag="Wired" delay={0.6} />
            <PlatformCard href="/sdwan" icon={<Radio className="h-5 w-5" />} label="Arista SD-WAN" sublabel="WAN"
              description="Edge devices, tunnel health and WAN telemetry across all sites."
              active={false} accentRgb="52,211,153" tag="SD-WAN" delay={0.7} />
            <PlatformCard href="/wlc" icon={<HardDrive className="h-5 w-5" />} label="Arista WLC" sublabel="Controllers"
              description="Wireless LAN controllers and managed AP visibility."
              active={false} accentRgb="251,191,36" tag="WLC" delay={0.8} />
          </div>
        </section>

        {/* Full inventory collapsible */}
        <section className="border-t border-border/30 pt-8" style={{ animation: "naxis-enter 0.6s 0.9s both" }}>
          <button onClick={() => setShowInventory(s => !s)}
            className="group flex w-full items-center justify-between text-left px-1 py-1">
            <div className="flex items-center gap-3">
              <div className="h-px w-6 bg-primary/30" />
              <Server className="h-3.5 w-3.5 text-foreground-subtle" />
              <span className="text-xs font-semibold text-foreground-muted uppercase tracking-[0.2em]">Full Inventory</span>
              <span className="text-[10px] text-foreground-subtle font-mono">all platforms combined</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-foreground-subtle group-hover:text-primary transition-colors">
              {showInventory ? <><ChevronUp className="h-3.5 w-3.5" /> collapse</> : <><ChevronDown className="h-3.5 w-3.5" /> expand</>}
            </div>
          </button>
          {showInventory && (
            <div className="mt-5 rounded-xl border border-border/30 bg-surface/30 p-5" style={{ animation: "naxis-enter 0.4s both" }}>
              <InventoryPanel />
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
