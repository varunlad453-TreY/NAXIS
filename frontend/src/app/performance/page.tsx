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

function StatusDot({ status }: { status: string }) {
  if (status === "healthy") return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />;
  if (status === "degraded") return <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />;
}

export default function PerformancePage() {
  const [metrics] = useState<PerformanceMetric[]>(mockMetrics);
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
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-slate-500" /> Performance
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time bandwidth, CPU, memory, and latency across enterprise assets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0 text-xs">
            {["15m", "1h", "24h", "7d"].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
                  timeRange === range
                    ? "text-white border-indigo-500"
                    : "text-slate-500 border-transparent hover:text-slate-300"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-sm transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Inline Metrics Bar */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Avg Latency</span>
          <span className="text-lg font-semibold text-white font-mono">14.8 ms</span>
          <span className="text-xs text-emerald-400 flex items-center">
            <ArrowDownRight className="w-3 h-3" /> -2.1ms
          </span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">CPU Load</span>
          <span className="text-lg font-semibold text-white font-mono">38.4 %</span>
          <span className="text-xs text-emerald-400">Normal</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Memory</span>
          <span className="text-lg font-semibold text-white font-mono">51.2 %</span>
          <span className="text-xs text-amber-400 flex items-center">
            <ArrowUpRight className="w-3 h-3" /> +4.2%
          </span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Throughput</span>
          <span className="text-lg font-semibold text-white font-mono">43.2 Gbps</span>
          <span className="text-xs text-emerald-400">Peak</span>
        </div>
      </div>

      {/* Chart Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-white">Telemetry Distribution</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Live
          </span>
        </div>

        <div className="h-44 w-full flex items-end gap-1 pt-4 pb-2 border-b border-slate-800/40">
          {[35, 42, 58, 64, 48, 72, 85, 92, 78, 60, 52, 45, 68, 79, 88, 94, 70, 55, 42, 38, 48, 62, 75, 82, 90, 68, 54, 49, 39, 45, 60, 78, 85].map((val, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
              <div
                className={`w-full transition-all duration-300 ${
                  val > 85 ? "bg-rose-500" : val > 65 ? "bg-amber-500" : "bg-indigo-500/70 group-hover:bg-indigo-400"
                }`}
                style={{ height: `${val}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-600">
          <span>T-60m</span>
          <span>T-45m</span>
          <span>T-30m</span>
          <span>T-15m</span>
          <span>Now</span>
        </div>
      </div>

      {/* Device Table */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-white">Device Telemetry</h3>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices or vendors..."
              className="w-full bg-transparent border border-slate-800/60 rounded-sm pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/60 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">Device Name</th>
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Vendor</th>
                <th className="py-2.5 px-3 text-center">CPU</th>
                <th className="py-2.5 px-3 text-center">Memory</th>
                <th className="py-2.5 px-3 text-center">Latency</th>
                <th className="py-2.5 px-3 text-center">Throughput</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-xs">
              {filteredMetrics.map((m) => (
                <tr key={m.device_id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-white">{m.device_name}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">{m.device_id}</td>
                  <td className="py-2.5 px-3 text-slate-400">{m.vendor}</td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={m.cpu_pct > 80 ? "text-rose-400 font-semibold" : "text-slate-300"}>
                      {m.cpu_pct}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-300">{m.memory_pct}%</td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={m.latency_ms > 40 ? "text-amber-400 font-semibold" : "text-slate-300"}>
                      {m.latency_ms} ms
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-emerald-400/80">{m.bandwidth_gbps} Gbps</td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      <StatusDot status={m.status} />
                      <span className={`capitalize ${
                        m.status === "healthy" ? "text-emerald-400" :
                        m.status === "degraded" ? "text-amber-400" : "text-rose-400"
                      }`}>{m.status}</span>
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
