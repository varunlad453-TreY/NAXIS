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

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientDevice[]>(mockClients);
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-mono font-bold uppercase tracking-wider">
              Client Experience & SLE
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-400" /> Wireless Client Experience Dashboard
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Real-time 802.1X authentication success, Wi-Fi RSSI signal quality, roaming latency, and Service Level Expectations (SLE).
          </p>
        </div>

        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-purple-400" : ""}`} /> Refresh Clients
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Connected Clients</span>
            <Users className="w-5 h-5 text-purple-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">4,892</span>
            <span className="text-xs font-semibold text-emerald-400">+128 Active</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">6 GHz / 5 GHz / 2.4 GHz total</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">802.1X Auth SLE</span>
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">99.4 %</span>
            <span className="text-xs font-semibold text-emerald-400">Pass Rate</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Radius EAP-TLS latency &lt; 85ms</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mean Roaming Latency</span>
            <Zap className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">18 ms</span>
            <span className="text-xs font-semibold text-emerald-400">802.11r Active</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Fast BSS Transition enabled</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Average Signal (RSSI)</span>
            <Wifi className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white font-mono">-62 dBm</span>
            <span className="text-xs font-semibold text-emerald-400">Good Coverage</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">SNR &gt; 25 dB across facility</p>
        </div>
      </div>

      {/* Active Clients Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md p-5 space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Wifi className="w-5 h-5 text-purple-400" /> Active Connected Client Devices
          </h3>
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hostname, MAC, AP name..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-[11px] uppercase tracking-wider font-bold">
                <th className="py-3 px-4">Host Name</th>
                <th className="py-3 px-4">MAC Address</th>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4">SSID</th>
                <th className="py-3 px-4">Associated AP</th>
                <th className="py-3 px-4 text-center">RSSI / SNR</th>
                <th className="py-3 px-4 text-center">Roaming RTT</th>
                <th className="py-3 px-4 text-right">SLE Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filteredClients.map((c) => (
                <tr key={c.mac_address} className="hover:bg-slate-800/60 transition-all">
                  <td className="py-3 px-4 font-semibold text-white flex items-center gap-2">
                    {c.device_type === "laptop" ? (
                      <Laptop className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    ) : (
                      <Smartphone className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    )}
                    {c.host_name}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400">{c.mac_address}</td>
                  <td className="py-3 px-4 font-mono text-slate-300">{c.ip_address}</td>
                  <td className="py-3 px-4 text-slate-300">{c.ssid}</td>
                  <td className="py-3 px-4 font-semibold text-indigo-300">{c.ap_name}</td>
                  <td className="py-3 px-4 text-center font-mono">
                    <span className={c.rssi_dbm < -75 ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                      {c.rssi_dbm} dBm
                    </span>
                    <span className="text-slate-500 text-[10px] ml-1">({c.snr_db}dB)</span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-slate-300">{c.roaming_latency_ms} ms</td>
                  <td className="py-3 px-4 text-right">
                    {c.status === "excellent" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Excellent
                      </span>
                    )}
                    {c.status === "fair" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" /> Fair
                      </span>
                    )}
                    {c.status === "poor" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <AlertTriangle className="w-3 h-3" /> Poor
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
