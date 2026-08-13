"use client";

import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  Laptop,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  Wifi,
  Zap,
} from "lucide-react";
import { API_BASE } from "@/lib/api";


interface PathHop {
  hop_index: number;
  node_id: string;
  node_name: string;
  node_type: "client" | "ap" | "switch" | "sdwan" | "sase" | "internet";
  vendor?: string;
  ip_address?: string;
  mac_address?: string;
  interface_name?: string;
  health_status: "healthy" | "degraded" | "critical";
  latency_ms?: number;
  packet_loss_pct?: number;
  details?: Record<string, any>;
}

interface PathTraceData {
  client_mac: string;
  client_ip: string;
  username: string;
  site_id: string;
  site_name: string;
  hops: PathHop[];
  first_unhealthy_hop?: PathHop | null;
  traced_at: string;
}

export default function PathTracePage() {
  const [searchMac, setSearchMac] = useState("00:11:22:33:44:55");
  const [loading, setLoading] = useState(false);
  const [traceData, setTraceData] = useState<PathTraceData | null>(null);
  const [activeModalHop, setActiveModalHop] = useState<PathHop | null>(null);
  const [diagnosticType, setDiagnosticType] = useState<"ping" | "traceroute" | "port_stats">("ping");
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagOutput, setDiagOutput] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTrace = async (macToTrace: string) => {
    if (!macToTrace) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      let res = await fetch(`${API_BASE}/path-trace/${encodeURIComponent(macToTrace)}`).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`http://127.0.0.1:8000/path-trace/${encodeURIComponent(macToTrace)}`).catch(() => null);
      }
      if (!res || !res.ok) throw new Error(`Path trace query failed (${res?.status || "network error"})`);
      const data = await res.json();
      setTraceData(data);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to trace path");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    handleTrace("00:11:22:33:44:55");
  }, []);

  const runDiagnosticTest = async () => {
    if (!activeModalHop) return;
    setDiagRunning(true);
    setDiagOutput(null);
    try {
      const endpoint = `${API_BASE}/diagnostics/${diagnosticType}`;
      let res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_device_id: activeModalHop.node_id,
          test_type: diagnosticType,
          destination_ip: activeModalHop.ip_address || "1.1.1.1",
          interface: activeModalHop.interface_name,
        }),
      }).catch(() => null);
      if (!res || !res.ok) {
        const fallbackEndpoint = `http://127.0.0.1:8000/diagnostics/${diagnosticType}`;
        res = await fetch(fallbackEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_device_id: activeModalHop.node_id,
            test_type: diagnosticType,
            destination_ip: activeModalHop.ip_address || "1.1.1.1",
            interface: activeModalHop.interface_name,
          }),
        }).catch(() => null);
      }


      if (!res || !res.ok) {
        const errData = res ? await res.json().catch(() => ({})) : {};
        throw new Error(errData.detail || `Diagnostic failed (${res?.status || "network error"})`);
      }

      const data = await res.json();

      setDiagOutput(data);
    } catch (err: any) {
      setDiagOutput({ error: err.message || "Execution failed" });
    } finally {
      setDiagRunning(false);
    }
  };

  const getHopIcon = (type: string) => {
    switch (type) {
      case "client":
        return <Laptop className="w-5 h-5 text-blue-400" />;
      case "ap":
        return <Wifi className="w-5 h-5 text-indigo-400" />;
      case "switch":
        return <Server className="w-5 h-5 text-emerald-400" />;
      case "sdwan":
        return <Zap className="w-5 h-5 text-amber-400" />;
      case "sase":
        return <Shield className="w-5 h-5 text-purple-400" />;
      case "internet":
        return <Globe className="w-5 h-5 text-cyan-400" />;
      default:
        return <Activity className="w-5 h-5 text-slate-400" />;
    }
  };

  const getHealthText = (status: string) => {
    switch (status) {
      case "healthy":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Healthy
          </span>
        );
      case "degraded":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Degraded
          </span>
        );
      case "critical":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-400" /> Critical
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity className="w-7 h-7 text-indigo-400" />
            Client Path Trace & Live Diagnostics
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            End-to-end multi-vendor hop chain resolution from endpoint to cloud egress.
          </p>
        </div>

        {/* Search Bar */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchMac}
              onChange={(e) => setSearchMac(e.target.value)}
              placeholder="Enter Client MAC / IP / Username..."
              className="bg-transparent border-b border-slate-800/60 pl-9 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-72"
            />
          </div>
          <button
            onClick={() => handleTrace(searchMac)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-sm font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Trace Path"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="py-3 text-red-400 text-sm flex items-center gap-2 border-b border-red-500/20">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {errorMessage}
        </div>
      )}

      {/* Summary Bar */}
      {traceData && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border-b border-slate-800/60 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase font-bold tracking-wider">Client</span>
            <span className="text-white font-semibold">{traceData.username}</span>
            <span className="text-slate-400 font-mono">{traceData.client_mac}</span>
            <span className="text-slate-400">{traceData.client_ip}</span>
          </div>
          <span className="text-slate-700">|</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase font-bold tracking-wider">Site</span>
            <span className="text-white font-semibold">{traceData.site_name}</span>
            <span className="text-slate-400">{traceData.hops.length} hops</span>
          </div>
          <span className="text-slate-700">|</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase font-bold tracking-wider">Status</span>
            {traceData.first_unhealthy_hop ? (
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Degraded
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Healthy
              </span>
            )}
          </div>
          <span className="text-slate-700">|</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 uppercase font-bold tracking-wider">First Issue</span>
            <span className="text-white font-semibold">
              {traceData.first_unhealthy_hop ? traceData.first_unhealthy_hop.node_name : "None"}
            </span>
            <span className="text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {new Date(traceData.traced_at).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Hop Chain Flow Diagram */}
      {traceData && (
        <div className="space-y-0">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
            <h2 className="text-lg font-semibold text-white">End-to-End Network Topology Path</h2>
            <span className="text-xs text-slate-400">Click any hop to launch live edge diagnostics</span>
          </div>

          <div className="divide-y divide-slate-800/80">
            {traceData.hops.map((hop) => (
              <div
                key={hop.node_id}
                className="flex flex-col md:flex-row items-start md:items-center justify-between py-4 gap-4"
              >
                {/* Left Hop Info */}
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-800">
                    {hop.hop_index}
                  </div>
                  <div className="p-1">
                    {getHopIcon(hop.node_type)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{hop.node_name}</span>
                      {hop.vendor && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                          {hop.vendor}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
                      {hop.ip_address && <span>IP: {hop.ip_address}</span>}
                      {hop.interface_name && <span>Interface: {hop.interface_name}</span>}
                    </div>
                  </div>
                </div>

                {/* Right Metrics & Test Trigger */}
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Latency / Loss</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">
                      {hop.latency_ms ? `${hop.latency_ms} ms` : "—"}{" "}
                      {hop.packet_loss_pct !== undefined ? `(${hop.packet_loss_pct}% loss)` : ""}
                    </div>
                  </div>

                  <div>{getHealthText(hop.health_status)}</div>

                  {hop.node_type !== "client" && hop.node_type !== "internet" && (
                    <button
                      onClick={() => {
                        setActiveModalHop(hop);
                        setDiagOutput(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-sm text-xs font-medium transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" /> Run Test
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Diagnostic Test Modal */}
      {activeModalHop && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 max-w-2xl w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Play className="w-5 h-5 text-indigo-400" />
                  Execute Live Edge Diagnostic Test
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Target: {activeModalHop.node_name} ({activeModalHop.ip_address})</p>
              </div>
              <button
                onClick={() => setActiveModalHop(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Test Type Tabs */}
            <div className="flex gap-4 border-b border-slate-800/60">
              {(["ping", "traceroute", "port_stats"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setDiagnosticType(type)}
                  className={`py-2 px-1 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                    diagnosticType === type
                      ? "text-indigo-400 border-indigo-500"
                      : "text-slate-400 hover:text-slate-200 border-transparent"
                  }`}
                >
                  {type.replace("_", " ")}
                </button>
              ))}
            </div>

            {/* Trigger Button */}
            <div className="flex justify-end">
              <button
                onClick={runDiagnosticTest}
                disabled={diagRunning}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-sm text-sm transition-colors disabled:opacity-50"
              >
                {diagRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Run Diagnostic"}
              </button>
            </div>

            {/* Execution Console Output */}
            {diagOutput && (
              <div className="bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-60 space-y-2">
                {diagOutput.error ? (
                  <div className="text-red-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> {diagOutput.error}
                  </div>
                ) : (
                  <>
                    <div className="text-emerald-400">
                      [SUCCESS] Diagnostic Run ID: {diagOutput.run_id} ({diagOutput.duration_ms} ms)
                    </div>
                    <pre className="text-slate-300">
                      {diagOutput.results.raw_output || JSON.stringify(diagOutput.results, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
