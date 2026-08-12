"use client";

import React, { useState } from "react";
import {
  Users,
  Wifi,
  ShieldCheck,
  Zap,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Laptop,
} from "lucide-react";

interface ClientDevice {
  mac_address: string;
  host_name: string;
  ip_address: string;
  ssid: string;
  ap_name: string;
  rssi_dbm: number;
  snr_db: number;
  auth_type: string;
  roaming_latency_ms: number;
  device_type: "laptop" | "mobile" | "iot";
  status: "excellent" | "fair" | "poor";
}

const mockClients: ClientDevice[] = [
  { mac_address: "a4:83:e7:91:02:11", host_name: "Varun-MacBook-Pro", ip_address: "10.42.12.88", ssid: "Corporate-Enterprise-5G", ap_name: "Conf Room 3 Access Point", rssi_dbm: -58, snr_db: 34, auth_type: "802.1X EAP-TLS", roaming_latency_ms: 14, device_type: "laptop", status: "excellent" },
  { mac_address: "bc:d1:d3:44:89:a0", host_name: "Exec-iPad-Pro", ip_address: "10.42.12.104", ssid: "Corporate-Enterprise-5G", ap_name: "Exec Boardroom AP", rssi_dbm: -64, snr_db: 28, auth_type: "802.1X EAP-TLS", roaming_latency_ms: 19, device_type: "mobile", status: "excellent" },
  { mac_address: "dc:a6:32:00:19:f2", host_name: "NOC-Display-Tablet", ip_address: "10.42.14.22", ssid: "NOC-Secure-IoT", ap_name: "NOC Ops Access Point", rssi_dbm: -78, snr_db: 14, auth_type: "WPA3-Enterprise", roaming_latency_ms: 48, device_type: "iot", status: "poor" },
  { mac_address: "00:50:56:c0:00:08", host_name: "Eng-Dell-XPS15", ip_address: "10.42.12.195", ssid: "Corporate-Enterprise-5G", ap_name: "Engineering West AP", rssi_dbm: -69, snr_db: 22, auth_type: "802.1X EAP-TLS", roaming_latency_ms: 22, device_type: "laptop", status: "fair" },
];

function StatusDot({ status }: { status: string }) {
  if (status === "excellent") return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />;
  if (status === "fair") return <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />;
}

export default function ClientsPage() {
  const [clients] = useState<ClientDevice[]>(mockClients);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  };

  const filteredClients = clients.filter(
    (c) =>
      c.host_name.toLowerCase().includes(search.toLowerCase()) ||
      c.mac_address.toLowerCase().includes(search.toLowerCase()) ||
      c.ap_name.toLowerCase().includes(search.toLowerCase()) ||
      c.ip_address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/60 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-500" /> Clients
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            802.1X authentication, Wi-Fi quality, roaming latency, and SLE metrics.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-sm transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Inline Metrics Bar */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Connected</span>
          <span className="text-lg font-semibold text-white font-mono">4,892</span>
          <span className="text-xs text-emerald-400">+128</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">802.1X SLE</span>
          <span className="text-lg font-semibold text-white font-mono">99.4 %</span>
          <span className="text-xs text-emerald-400">Pass</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Roaming</span>
          <span className="text-lg font-semibold text-white font-mono">18 ms</span>
          <span className="text-xs text-emerald-400">802.11r</span>
        </div>
        <span className="hidden sm:block text-slate-700">|</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Avg RSSI</span>
          <span className="text-lg font-semibold text-white font-mono">-62 dBm</span>
          <span className="text-xs text-emerald-400">Good</span>
        </div>
      </div>

      {/* Clients Table */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-white">Active Client Devices</h3>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-600" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hostname, MAC, AP..."
              className="w-full bg-transparent border border-slate-800/60 rounded-sm pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/60 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">Host</th>
                <th className="py-2.5 px-3">MAC</th>
                <th className="py-2.5 px-3">IP</th>
                <th className="py-2.5 px-3">SSID</th>
                <th className="py-2.5 px-3">AP</th>
                <th className="py-2.5 px-3 text-center">RSSI / SNR</th>
                <th className="py-2.5 px-3 text-center">Roaming</th>
                <th className="py-2.5 px-3 text-right">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-xs">
              {filteredClients.map((c) => (
                <tr key={c.mac_address} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-white flex items-center gap-2">
                    {c.device_type === "laptop" ? (
                      <Laptop className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    ) : c.device_type === "mobile" ? (
                      <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    )}
                    {c.host_name}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">{c.mac_address}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">{c.ip_address}</td>
                  <td className="py-2.5 px-3 text-slate-300">{c.ssid}</td>
                  <td className="py-2.5 px-3 text-slate-400">{c.ap_name}</td>
                  <td className="py-2.5 px-3 text-center font-mono">
                    <span className={c.rssi_dbm < -75 ? "text-rose-400 font-semibold" : "text-emerald-400/80 font-semibold"}>
                      {c.rssi_dbm} dBm
                    </span>
                    <span className="text-slate-600 text-[10px] ml-1">({c.snr_db}dB)</span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-300">{c.roaming_latency_ms} ms</td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      <StatusDot status={c.status} />
                      <span className={`capitalize ${
                        c.status === "excellent" ? "text-emerald-400" :
                        c.status === "fair" ? "text-amber-400" : "text-rose-400"
                      }`}>{c.status}</span>
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
