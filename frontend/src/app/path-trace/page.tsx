"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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

function PathTraceFallback() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="h-4 w-32 animate-pulse bg-surface/50 rounded" />
      <div className="h-[500px] animate-pulse bg-surface/20 rounded" />
    </div>
  );
}

function PathTraceContent() {
  const searchParams = useSearchParams();
  const initialTarget = searchParams.get("ip") || searchParams.get("mac") || searchParams.get("device_id") || "00:11:22:33:44:55";

  const [searchMac, setSearchMac] = useState(initialTarget);
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

  useEffect(() => {
    handleTrace(initialTarget);
  }, [initialTarget]);

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
          node_id: activeModalHop.node_id,
          target_ip: activeModalHop.ip_address || "10.0.0.1",
        }),
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`http://127.0.0.1:8000/diagnostics/${diagnosticType}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node_id: activeModalHop.node_id,
            target_ip: activeModalHop.ip_address || "10.0.0.1",
          }),
        }).catch(() => null);
      }

      if (!res || !res.ok) {
        throw new Error("Diagnostic request failed");
      }
      const data = await res.json();
      setDiagOutput(data);
    } catch (err: any) {
      setDiagOutput({
        error: true,
        message: err.message || "Execution error",
      });
    } finally {
      setDiagRunning(false);
    }
  };

  const renderHopIcon = (type: PathHop["node_type"]) => {
    switch (type) {
      case "client":
        return <Laptop className="h-5 w-5 text-indigo-400" />;
      case "ap":
        return <Wifi className="h-5 w-5 text-emerald-400" />;
      case "switch":
        return <Server className="h-5 w-5 text-blue-400" />;
      case "sdwan":
        return <Activity className="h-5 w-5 text-violet-400" />;
      case "sase":
        return <Shield className="h-5 w-5 text-amber-400" />;
      case "internet":
        return <Globe className="h-5 w-5 text-sky-400" />;
      default:
        return <Server className="h-5 w-5 text-slate-400" />;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Path Trace & Diagnostic Runner</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Real-time deterministic path tracing across LAN, WAN, and SASE per-hop network nodes.
        </p>
      </div>

      {/* Input controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-foreground-subtle" />
          <input
            type="text"
            value={searchMac}
            onChange={(e) => setSearchMac(e.target.value)}
            placeholder="Enter Client MAC, IP Address, or Device ID..."
            className="w-full rounded border border-border/60 bg-surface pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={() => handleTrace(searchMac)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
          Run Path Trace
        </button>
      </div>

      {errorMessage && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      {/* Trace Visualization */}
      {traceData && (
        <div className="space-y-6">
          {/* Metadata Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-border/40 bg-surface/50 p-4 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <span className="text-foreground-subtle">Target:</span>{" "}
                <span className="font-mono font-semibold text-foreground">{traceData.client_ip || traceData.client_mac}</span>
              </div>
              <div>
                <span className="text-foreground-subtle">Site:</span>{" "}
                <span className="font-semibold text-foreground">{traceData.site_name}</span>
              </div>
              <div>
                <span className="text-foreground-subtle">Hops Analyzed:</span>{" "}
                <span className="font-semibold text-foreground">{traceData.hops.length}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-foreground-subtle">
              <Clock className="h-3.5 w-3.5" />
              <span>{new Date(traceData.traced_at).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* First Unhealthy Hop Alert */}
          {traceData.first_unhealthy_hop && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <div className="font-bold text-rose-400 text-sm">
                  First Impaired Hop Detected: {traceData.first_unhealthy_hop.node_name}
                </div>
                <div className="mt-1 text-rose-300/90">
                  Latency: {traceData.first_unhealthy_hop.latency_ms}ms · Loss: {traceData.first_unhealthy_hop.packet_loss_pct}% · Interface: {traceData.first_unhealthy_hop.interface_name || "Trunk"}
                </div>
              </div>
            </div>
          )}

          {/* Hop Timeline Sequence */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
              Path Hops Sequence
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {traceData.hops.map((hop) => {
                const isImpaired = hop.health_status !== "healthy";
                return (
                  <div
                    key={hop.hop_index}
                    onClick={() => setActiveModalHop(hop)}
                    className={`group relative rounded border p-4 transition-all cursor-pointer ${
                      isImpaired
                        ? "border-rose-500/50 bg-rose-500/5 hover:border-rose-500"
                        : "border-border/60 bg-surface/50 hover:border-primary/50 hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded bg-surface border border-border/40">
                          {renderHopIcon(hop.node_type)}
                        </div>
                        <div>
                          <div className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                            {hop.node_name}
                          </div>
                          <div className="text-xs text-foreground-muted font-mono">{hop.ip_address || "—"}</div>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-foreground-subtle">#{hop.hop_index}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-border/30">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            hop.health_status === "critical"
                              ? "bg-rose-500"
                              : hop.health_status === "degraded"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                        />
                        <span className="capitalize text-foreground-muted">{hop.health_status}</span>
                      </div>
                      <div className="font-mono text-foreground-subtle">
                        {hop.latency_ms !== undefined ? `${hop.latency_ms}ms` : "—"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Hop Diagnostic Modal */}
      {activeModalHop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h3 className="font-bold text-base text-foreground">{activeModalHop.node_name}</h3>
                <p className="text-xs text-foreground-muted font-mono">{activeModalHop.ip_address}</p>
              </div>
              <button
                onClick={() => setActiveModalHop(null)}
                className="text-foreground-subtle hover:text-foreground text-sm font-semibold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground-subtle block">
                Select Diagnostic Tool
              </label>
              <div className="flex gap-2">
                {(["ping", "traceroute", "port_stats"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDiagnosticType(t)}
                    className={`flex-1 rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      diagnosticType === t
                        ? "bg-primary text-white"
                        : "bg-surface-hover text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {t.replace("_", " ")}
                  </button>
                ))}
              </div>

              <button
                onClick={runDiagnosticTest}
                disabled={diagRunning}
                className="w-full inline-flex items-center justify-center gap-2 rounded bg-primary/90 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                {diagRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run {diagnosticType.replace("_", " ").toUpperCase()} Test
              </button>

              {diagOutput && (
                <div className="rounded border border-border/60 bg-background p-3 text-xs font-mono max-h-48 overflow-auto">
                  <pre className="whitespace-pre-wrap text-foreground-muted">
                    {JSON.stringify(diagOutput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PathTracePage() {
  return (
    <Suspense fallback={<PathTraceFallback />}>
      <PathTraceContent />
    </Suspense>
  );
}
