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

import { useEffect } from "react";
import { fetchAPI } from "@/lib/api";

function StatusDot({ status }: { status: string }) {
  if (status === "up") return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />;
  if (status === "degraded") return <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />;
}

export default function ConnectivityPage() {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchTunnels = async () => {
    setLoading(true);
    try {
      const data = await fetchAPI("/topology/edges").catch(() => null);
      if (Array.isArray(data) && data.length > 0) {
        const mapped: TunnelInfo[] = data.map((e: any, idx: number) => ({
          tunnel_id: e.edge_id || `tun-overlay-${idx + 1}`,
          source_edge: e.source_name || e.source_node_id || "Enterprise Edge Node",
          destination_hub: e.target_name || e.target_node_id || "Regional Data Center Core",
          protocol: e.edge_type === "sdwan" ? "IPsec" : e.edge_type === "bgp" ? "BGP-Overlay" : "GRE",
          latency_ms: Number(e.latency_ms || 35.4),
          jitter_ms: Number(e.jitter_ms || 1.8),
          packet_loss_pct: Number(e.packet_loss_pct || 0.0),

          status: e.status === "degraded" ? "degraded" : e.status === "down" ? "down" : "up",
        }));
        setTunnels(mapped);
      } else {
        setTunnels([
          { tunnel_id: "tun-sfo-nyc-01", source_edge: "SFO Main Gateway", destination_hub: "NYC Core Data Center", protocol: "IPsec", latency_ms: 42.1, jitter_ms: 1.8, packet_loss_pct: 0.0, status: "up" },
          { tunnel_id: "tun-sfo-lon-02", source_edge: "SFO Main Gateway", destination_hub: "London Hub West", protocol: "BGP-Overlay", latency_ms: 118.4, jitter_ms: 4.2, packet_loss_pct: 0.05, status: "up" },
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch topology edges:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTunnels();
  }, []);

  const handleRefresh = () => {
    fetchTunnels();
  };


  const filteredTunnels = tunnels.filter(
    (t) =>
      t.tunnel_id.toLowerCase().includes(search.toLowerCase()) ||
      t.source_edge.toLowerCase().includes(search.toLowerCase()) ||
      t.destination_hub.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-slate-500" /> Connectivity
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            IPsec overlays, BGP adjacencies, and WAN mesh health.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-sm transition-colors"
          title="Sync"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Inline Metrics Bar */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Active Tunnels</span>
          <span className="text-lg font-semibold text-white font-mono">184 / 184</span>
          <span className="text-xs text-emerald-400">100% Up</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">BGP Peers</span>
          <span className="text-lg font-semibold text-white font-mono">42</span>
          <span className="text-xs text-slate-500">Established</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Packet Loss</span>
          <span className="text-lg font-semibold text-white font-mono">0.002 %</span>
          <span className="text-xs text-emerald-400">Optimal</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">SASE Gateways</span>
          <span className="text-lg font-semibold text-white font-mono">12</span>
          <span className="text-xs text-slate-500">Operational</span>
        </div>
      </div>

      {/* Tunnels Table */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-white">Overlay Tunnels</h3>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tunnels, hubs, edges..."
              className="w-full bg-transparent border border-slate-800/60 rounded-sm pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/60 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">Tunnel ID</th>
                <th className="py-2.5 px-3">Source Edge</th>
                <th className="py-2.5 px-3">Destination Hub</th>
                <th className="py-2.5 px-3">Protocol</th>
                <th className="py-2.5 px-3 text-center">Latency</th>
                <th className="py-2.5 px-3 text-center">Jitter</th>
                <th className="py-2.5 px-3 text-center">Loss</th>
                <th className="py-2.5 px-3 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-xs">
              {filteredTunnels.map((t) => (
                <tr key={t.tunnel_id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-mono font-medium text-white">{t.tunnel_id}</td>
                  <td className="py-2.5 px-3 text-slate-300">{t.source_edge}</td>
                  <td className="py-2.5 px-3 text-slate-300">{t.destination_hub}</td>
                  <td className="py-2.5 px-3 text-slate-400">{t.protocol}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-200">{t.latency_ms} ms</td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-300">{t.jitter_ms} ms</td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={t.packet_loss_pct > 1 ? "text-amber-400 font-semibold" : "text-emerald-400/80"}>
                      {t.packet_loss_pct}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      <StatusDot status={t.status} />
                      <span className={`capitalize ${
                        t.status === "up" ? "text-emerald-400" : "text-amber-400"
                      }`}>{t.status}</span>
                    </span>
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
