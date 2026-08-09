"use client";

import React, { useState } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Filter,
  RefreshCw,
  Search,
  Server,
  BarChart3,
  TrendingUp,
} from "lucide-react";

interface PerformanceMetric {
  device_id: string;
  device_name: string;
  device_type: "router" | "switch" | "ap" | "sdwan";
  vendor: string;
  cpu_pct: number;
  memory_pct: number;
  latency_ms: number;
  bandwidth_gbps: number;
  status: "healthy" | "degraded" | "critical";
}

const mockMetrics: PerformanceMetric[] = [
  { device_id: "edge-sfo-01", device_name: "SFO Main SD-WAN Gateway", device_type: "sdwan", vendor: "VeloCloud", cpu_pct: 42, memory_pct: 58, latency_ms: 14.2, bandwidth_gbps: 8.4, status: "healthy" },
  { device_id: "sw-core-nyc-01", device_name: "NYC Core Distribution Switch", device_type: "switch", vendor: "Cisco DNA", cpu_pct: 88, memory_pct: 79, latency_ms: 48.6, bandwidth_gbps: 22.1, status: "critical" },
  { device_id: "ap-conf-03", device_name: "Conf Room 3 Access Point", device_type: "ap", vendor: "Juniper Mist", cpu_pct: 64, memory_pct: 52, latency_ms: 28.1, bandwidth_gbps: 1.2, status: "degraded" },
  { device_id: "edge-lon-02", device_name: "London Hub Gateway", device_type: "sdwan", vendor: "VeloCloud", cpu_pct: 29, memory_pct: 44, latency_ms: 18.5, bandwidth_gbps: 6.7, status: "healthy" },
  { device_id: "sw-access-tok-04", device_name: "Tokyo Access Switch Layer 2", device_type: "switch", vendor: "Arista", cpu_pct: 35, memory_pct: 48, latency_ms: 12.1, bandwidth_gbps: 4.8, status: "healthy" },
];

export default function PerformancePage() {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>(mockMetrics);
  const [timeRange, setTimeRange] = useState("1h");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 600);
  };

  const filteredMetrics = metrics.filter(
    (m) =>
      m.device_name.toLowerCase().includes(search.toLowerCase()) ||
      m.device_id.toLowerCase().includes(search.toLowerCase()) ||
      m.vendor.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
              Telemetry & Metrics
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-400" /> Performance Analytics Engine
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Real-time interface bandwidth throughput, CPU utilization, memory pressure, and latency distribution across enterprise assets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
            {["15m", "1h", "24h", "7d"].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  timeRange === range
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} /> Refresh Metrics
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avg Latency</span>
            <Clock className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">14.8 ms</span>
            <span className="text-xs font-semibold text-emerald-400 flex items-center">
              <ArrowDownRight className="w-3.5 h-3.5" /> -2.1ms
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">99th percentile across WAN edge</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">CPU Load</span>
            <Cpu className="w-5 h-5 text-purple-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">38.4 %</span>
            <span className="text-xs font-semibold text-emerald-400 flex items-center">
              <ArrowDownRight className="w-3.5 h-3.5" /> Normal
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Mean across 1,880 devices</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Memory Pressure</span>
            <HardDrive className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">51.2 %</span>
            <span className="text-xs font-semibold text-amber-400 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +4.2%
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Buffer pool allocation</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Aggregate Throughput</span>
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">43.2 Gbps</span>
            <span className="text-xs font-semibold text-emerald-400 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> Peak Load
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Ingress + Egress WAN total</p>
        </div>
      </div>

      {/* Simulated Time-Series Performance Graph */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Live Telemetry Distribution Spectrum</h3>
          </div>
          <span className="text-xs text-indigo-400 font-mono font-semibold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> Live 1-Sec Telemetry Stream
          </span>
        </div>

        {/* Visual Waveform Bar Chart */}
        <div className="h-44 w-full flex items-end gap-1.5 pt-4 pb-2 border-b border-slate-800/80">
          {[35, 42, 58, 64, 48, 72, 85, 92, 78, 60, 52, 45, 68, 79, 88, 94, 70, 55, 42, 38, 48, 62, 75, 82, 90, 68, 54, 49, 39, 45, 60, 78, 85].map((val, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
              <div
                className={`w-full rounded-t transition-all duration-300 ${
                  val > 85
                    ? "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]"
                    : val > 65
                    ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                    : "bg-indigo-500/80 group-hover:bg-indigo-400"
                }`}
                style={{ height: `${val}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-500">
          <span>T-60 Mins</span>
          <span>T-45 Mins</span>
          <span>T-30 Mins</span>
          <span>T-15 Mins</span>
          <span>Now (Live)</span>
        </div>
      </div>

      {/* Device Telemetry Breakdown Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md space-y-4 p-5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Device Telemetry & Resource Utilization</h3>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices or vendors..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-[11px] uppercase tracking-wider font-bold">
                <th className="py-3 px-4">Device Name</th>
                <th className="py-3 px-4">Canonical ID</th>
                <th className="py-3 px-4">Vendor</th>
                <th className="py-3 px-4 text-center">CPU Load</th>
                <th className="py-3 px-4 text-center">Memory</th>
                <th className="py-3 px-4 text-center">Latency</th>
                <th className="py-3 px-4 text-center">Throughput</th>
                <th className="py-3 px-4 text-right">Health State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filteredMetrics.map((m) => (
                <tr key={m.device_id} className="hover:bg-slate-800/60 transition-all">
                  <td className="py-3 px-4 font-semibold text-white">{m.device_name}</td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400">{m.device_id}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-950 text-indigo-300 border border-slate-800">
                      {m.vendor}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono">
                    <span className={m.cpu_pct > 80 ? "text-rose-400 font-bold" : "text-slate-300"}>
                      {m.cpu_pct}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-slate-300">{m.memory_pct}%</td>
                  <td className="py-3 px-4 text-center font-mono">
                    <span className={m.latency_ms > 40 ? "text-amber-400 font-bold" : "text-slate-300"}>
                      {m.latency_ms} ms
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-emerald-400 font-bold">{m.bandwidth_gbps} Gbps</td>
                  <td className="py-3 px-4 text-right">
                    {m.status === "healthy" && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Healthy
                      </span>
                    )}
                    {m.status === "degraded" && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Degraded
                      </span>
                    )}
                    {m.status === "critical" && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        Critical
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
