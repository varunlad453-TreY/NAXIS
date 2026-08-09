"use client";

import React, { useState } from "react";
import {
  Globe,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Wifi,
  Shield,
  Layers,
  Activity,
  Zap,
} from "lucide-react";

interface TunnelInfo {
  tunnel_id: string;
  source_edge: string;
  destination_hub: string;
  protocol: "IPsec" | "BGP-Overlay" | "GRE";
  latency_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  status: "up" | "degraded" | "down";
}

const mockTunnels: TunnelInfo[] = [
  { tunnel_id: "tun-sfo-nyc-01", source_edge: "SFO Main Gateway", destination_hub: "NYC Core Data Center", protocol: "IPsec", latency_ms: 42.1, jitter_ms: 1.8, packet_loss_pct: 0.0, status: "up" },
  { tunnel_id: "tun-sfo-lon-02", source_edge: "SFO Main Gateway", destination_hub: "London Hub West", protocol: "BGP-Overlay", latency_ms: 118.4, jitter_ms: 4.2, packet_loss_pct: 0.05, status: "up" },
  { tunnel_id: "tun-tok-sfo-01", source_edge: "Tokyo Branch Edge", destination_hub: "SFO Main Gateway", protocol: "IPsec", latency_ms: 142.8, jitter_ms: 12.4, packet_loss_pct: 1.8, status: "degraded" },
  { tunnel_id: "tun-sgp-fra-03", source_edge: "Singapore Edge", destination_hub: "Frankfurt Hub", protocol: "GRE", latency_ms: 188.2, jitter_ms: 2.1, packet_loss_pct: 0.0, status: "up" },
];

export default function ConnectivityPage() {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>(mockTunnels);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  };

  const filteredTunnels = tunnels.filter(
    (t) =>
      t.tunnel_id.toLowerCase().includes(search.toLowerCase()) ||
      t.source_edge.toLowerCase().includes(search.toLowerCase()) ||
      t.destination_hub.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold uppercase tracking-wider">
              Overlay & SD-WAN
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-400" /> SD-WAN & SASE Connectivity Control
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Real-time IPsec overlays, BGP routing adjacencies, packet loss jitter telemetry, and multi-cloud WAN mesh health.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-400" : ""}`} /> Sync Overlay State
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active SD-WAN Tunnels</span>
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">184 / 184</span>
            <span className="text-xs font-semibold text-emerald-400">100% Up</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Full-mesh IPsec fabric</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">BGP Peering Adjacencies</span>
            <Layers className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">42 Established</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Multi-cloud BGP neighbors</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mean WAN Packet Loss</span>
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">0.002 %</span>
            <span className="text-xs font-semibold text-emerald-400">Optimal</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Forward Error Correction (FEC) active</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">SASE Security Gateways</span>
            <Zap className="w-5 h-5 text-purple-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">12 Operational</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Zero-trust network access (ZTNA)</p>
        </div>
      </div>

      {/* Tunnels Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md p-5 space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Wifi className="w-5 h-5 text-blue-400" /> SD-WAN Overlay Tunnels & Link Diagnostics
          </h3>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tunnels, hubs, edges..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-[11px] uppercase tracking-wider font-bold">
                <th className="py-3 px-4">Tunnel ID</th>
                <th className="py-3 px-4">Source Edge</th>
                <th className="py-3 px-4">Destination Hub</th>
                <th className="py-3 px-4">Protocol</th>
                <th className="py-3 px-4 text-center">RTT Latency</th>
                <th className="py-3 px-4 text-center">Jitter</th>
                <th className="py-3 px-4 text-center">Packet Loss</th>
                <th className="py-3 px-4 text-right">Tunnel State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filteredTunnels.map((t) => (
                <tr key={t.tunnel_id} className="hover:bg-slate-800/60 transition-all">
                  <td className="py-3 px-4 font-mono font-semibold text-white">{t.tunnel_id}</td>
                  <td className="py-3 px-4 text-slate-300">{t.source_edge}</td>
                  <td className="py-3 px-4 text-slate-300">{t.destination_hub}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-950 text-blue-400 border border-blue-500/30">
                      {t.protocol}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-slate-200">{t.latency_ms} ms</td>
                  <td className="py-3 px-4 text-center font-mono text-slate-300">{t.jitter_ms} ms</td>
                  <td className="py-3 px-4 text-center font-mono">
                    <span className={t.packet_loss_pct > 1 ? "text-amber-400 font-bold" : "text-emerald-400 font-semibold"}>
                      {t.packet_loss_pct}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {t.status === "up" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> UP
                      </span>
                    )}
                    {t.status === "degraded" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Degraded
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
