"use client";

import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
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
      const res = await fetch(`http://localhost:8000/path-trace/${encodeURIComponent(macToTrace)}`);
      if (!res.ok) throw new Error(`Path trace query failed (${res.status})`);
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
      const endpoint = `http://localhost:8000/diagnostics/${diagnosticType}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_device_id: activeModalHop.node_id,
          test_type: diagnosticType,
          destination_ip: activeModalHop.ip_address || "1.1.1.1",
          interface: activeModalHop.interface_name,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Diagnostic failed (${res.status})`);
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

  const getHealthBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
          </span>
        );
      case "degraded":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Degraded
          </span>
        );
      case "critical":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Critical
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
              className="bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-72"
            />
          </div>
          <button
            onClick={() => handleTrace(searchMac)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Trace Path"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {errorMessage}
        </div>
      )}

      {/* Summary Card */}
      {traceData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-xs font-medium">Target Client</div>
            <div className="text-lg font-bold text-white mt-1">{traceData.username}</div>
            <div className="text-xs text-slate-500 mt-0.5">{traceData.client_mac} • {traceData.client_ip}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-xs font-medium">Associated Site</div>
            <div className="text-lg font-bold text-white mt-1 truncate">{traceData.site_name}</div>
            <div className="text-xs text-slate-500 mt-0.5">Total Hops: {traceData.hops.length}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-xs font-medium">Overall Path Status</div>
            <div className="mt-1.5">
              {traceData.first_unhealthy_hop ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4" /> Degraded Segment Flagged
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-4 h-4" /> All Hops Operational
                </span>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-xs font-medium">First Unhealthy Hop</div>
            <div className="text-sm font-bold text-slate-200 mt-1">
              {traceData.first_unhealthy_hop ? traceData.first_unhealthy_hop.node_name : "None (Optimal Path)"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Traced at {new Date(traceData.traced_at).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {/* Hop Chain Flow Diagram */}
      {traceData && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">End-to-End Network Topology Path</h2>
            <span className="text-xs text-slate-400">Click any hop to launch live edge diagnostics</span>
          </div>

          <div className="space-y-4">
            {traceData.hops.map((hop, idx) => (
              <div key={hop.node_id} className="relative">
                <div
                  className={`flex flex-col md:flex-row items-start md:items-center justify-between p-4 rounded-xl border transition-all ${
                    hop.health_status === "critical"
                      ? "bg-red-500/10 border-red-500/30"
                      : hop.health_status === "degraded"
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {/* Left Hop Info */}
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">
                      {hop.hop_index}
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      {getHopIcon(hop.node_type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{hop.node_name}</span>
                        {hop.vendor && (
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-slate-800 text-slate-400">
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
                  <div className="mt-4 md:mt-0 flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Latency / Loss</div>
                      <div className="text-sm font-semibold text-slate-200 mt-0.5">
                        {hop.latency_ms ? `${hop.latency_ms} ms` : "—"}{" "}
                        {hop.packet_loss_pct !== undefined ? `(${hop.packet_loss_pct}% loss)` : ""}
                      </div>
                    </div>

                    <div>{getHealthBadge(hop.health_status)}</div>

                    {hop.node_type !== "client" && hop.node_type !== "internet" && (
                      <button
                        onClick={() => {
                          setActiveModalHop(hop);
                          setDiagOutput(null);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" /> Run Test
                      </button>
                    )}
                  </div>
                </div>

                {/* Connector Arrow */}
                {idx < traceData.hops.length - 1 && (
                  <div className="flex justify-center my-1">
                    <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Diagnostic Test Modal */}
      {activeModalHop && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-5">
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
            <div className="flex gap-2">
              {(["ping", "traceroute", "port_stats"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setDiagnosticType(type)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                    diagnosticType === type
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
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
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {diagRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Run Diagnostic"}
              </button>
            </div>

            {/* Execution Console Output */}
            {diagOutput && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-60 space-y-2">
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
