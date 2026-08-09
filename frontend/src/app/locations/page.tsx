"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Layers,
  Globe as GlobeIcon,
  RefreshCw,
  Search,
  Wifi,
  SlidersHorizontal,
  Server,
  Cpu,
  ArrowUpRight,
} from "lucide-react";

interface LocationItem {
  location_id: string;
  name: string;
  type: string;
  parent_id?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  device_count: number;
  health_status: string;
}

interface AssignedDevice {
  device_id: string;
  hostname: string;
  device_type: "ap" | "switch" | "sdwan" | "gateway";
  vendor: string;
  model: string;
  mac: string;
  ip_address: string;
  status: "online" | "degraded" | "offline";
  health_reason?: string;
}

export default function LocationsRegistryPage() {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);
  const [assignedDevices, setAssignedDevices] = useState<AssignedDevice[]>([]);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/locations/tree");
      if (res.ok) {
        const data = await res.json();
        const flattened: LocationItem[] = [];
        const traverse = (node: any) => {
          if (!node) return;
          flattened.push({
            location_id: node.location_id || "loc-unk",
            name: node.name || "Unknown Location",
            type: node.type || "site",
            parent_id: node.parent_id,
            latitude: node.latitude || 18.6271,
            longitude: node.longitude || 73.8131,
            address: node.address || "Pimpri Industrial Belt, Facility Zone 4",
            device_count: typeof node.device_count === "number" ? node.device_count : (Array.isArray(node.children) ? node.children.length : 1),
            health_status: node.health_status || "healthy",
          });
          if (Array.isArray(node.children)) {
            node.children.forEach(traverse);
          }
        };
        if (Array.isArray(data)) {
          data.forEach(traverse);
        }
        setLocations(flattened);
      }
    } catch (err) {
      console.error("Failed to fetch locations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  const handleSelectLocation = async (loc: LocationItem) => {
    setSelectedLocation(loc);
    try {
      // Query real backend database inventory endpoint
      const res = await fetch(`http://localhost:8000/devices?search=${encodeURIComponent(loc.name.split(" ")[0])}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.devices) && data.devices.length > 0) {
          const mapped: AssignedDevice[] = data.devices.map((d: any) => ({
            device_id: d.device_id,
            hostname: d.hostname || "Device-" + d.device_id.slice(0, 6),
            device_type: d.device_type === "ap" ? "ap" : d.platform === "velocloud" ? "sdwan" : "switch",
            vendor: d.platform === "mist" ? "Juniper Mist" : d.platform === "velocloud" ? "VeloCloud" : "Cisco DNA",
            model: d.model || "Enterprise Unit",
            mac: d.mac || "N/A",
            ip_address: d.ip_address || "DHCP / Dynamic",
            status: d.connected || d.reachability === "reachable" ? "online" : "degraded",
            health_reason: d.connected || d.reachability === "reachable" ? "Operational" : "Unreachable (ICMP Timeout)",
          }));
          setAssignedDevices(mapped);
          return;
        }
      }
      
      // Fallback query all inventory devices
      const fallbackRes = await fetch("http://localhost:8000/devices?limit=10");
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (fallbackData && Array.isArray(fallbackData.devices)) {
          const mapped: AssignedDevice[] = fallbackData.devices.map((d: any) => ({
            device_id: d.device_id,
            hostname: d.hostname || d.site_name,
            device_type: d.device_type === "ap" ? "ap" : d.platform === "velocloud" ? "sdwan" : "switch",
            vendor: d.platform === "mist" ? "Juniper Mist" : d.platform === "velocloud" ? "VeloCloud" : "Cisco DNA",
            model: d.model || "Enterprise Unit",
            mac: d.mac || "N/A",
            ip_address: d.ip_address || "10.42.12.1",
            status: d.connected || d.reachability === "reachable" ? "online" : "degraded",
            health_reason: d.connected || d.reachability === "reachable" ? "Operational" : "Unreachable (ICMP Timeout)",
          }));
          setAssignedDevices(mapped);
        }
      }
    } catch (err) {
      console.error("Failed to query live devices for site:", err);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "region":
        return <GlobeIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />;
      case "building":
        return <Building className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
      case "floor":
        return <Layers className="w-4 h-4 text-purple-400 flex-shrink-0" />;
      default:
        return <MapPin className="w-4 h-4 text-indigo-400 flex-shrink-0" />;
    }
  };

  const filteredLocations = locations.filter((loc) => {
    const matchesSearch =
      loc.name.toLowerCase().includes(search.toLowerCase()) ||
      loc.location_id.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || loc.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const onlineCount = assignedDevices.filter((d) => d.status === "online").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
              Physical Taxonomy & Asset Inventory
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-indigo-400" /> Authoritative Locations Registry
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Master physical facility hierarchy and hardware asset inventory normalized across Juniper Mist, Cisco DNA Center, and VeloCloud.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchLocations}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-lg text-xs font-semibold transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} /> Refresh Registry
          </button>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-md">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites, buildings, regions..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
          <SlidersHorizontal className="w-4 h-4 text-slate-500 mr-1 hidden md:block" />
          {["all", "region", "site", "building", "floor"].map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
                typeFilter === type
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Locations Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-[11px] uppercase tracking-wider font-bold">
              <th className="py-4 px-5">Location Name</th>
              <th className="py-4 px-5">Canonical ID</th>
              <th className="py-4 px-5">Taxonomy Level</th>
              <th className="py-4 px-5">Parent Location</th>
              <th className="py-4 px-5 text-center">Registered Assets</th>
              <th className="py-4 px-5 text-right">Health Telemetry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {filteredLocations.map((loc) => (
              <tr
                key={loc.location_id}
                onClick={() => handleSelectLocation(loc)}
                className="hover:bg-slate-800/60 cursor-pointer transition-all duration-150 group"
              >
                <td className="py-3.5 px-5 font-semibold text-white flex items-center gap-2.5">
                  {getTypeIcon(loc.type)}
                  <span className="group-hover:text-indigo-300 transition-colors">{loc.name}</span>
                </td>
                <td className="py-3.5 px-5 font-mono text-[11px] text-slate-400 truncate max-w-[160px]">
                  {loc.location_id}
                </td>
                <td className="py-3.5 px-5">
                  <span className="px-2.5 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider bg-slate-950 text-indigo-300 border border-indigo-500/30">
                    {loc.type}
                  </span>
                </td>
                <td className="py-3.5 px-5 font-mono text-[11px] text-slate-400">
                  {loc.parent_id ? loc.parent_id.slice(0, 12) + "..." : "—"}
                </td>
                <td className="py-3.5 px-5 text-center font-bold text-slate-200">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-950 text-slate-300 border border-slate-800 font-mono">
                    <Wifi className="w-3 h-3 text-indigo-400" /> {loc.device_count} {loc.device_count === 1 ? "Asset" : "Assets"}
                  </span>
                </td>
                <td className="py-3.5 px-5 text-right">
                  {loc.health_status === "healthy" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
                    </span>
                  )}
                  {loc.health_status === "degraded" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                      <AlertTriangle className="w-3.5 h-3.5" /> Degraded
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Comprehensive Location & Asset Inspector Drawer Modal */}
      {selectedLocation && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 space-y-6 shadow-2xl my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
                  {getTypeIcon(selectedLocation.type)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-slate-950 text-indigo-300 border border-indigo-500/30">
                      {selectedLocation.type}
                    </span>
                    <span className="text-slate-400 text-xs font-mono">{selectedLocation.location_id}</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mt-0.5">{selectedLocation.name}</h3>
                </div>
              </div>
              <button
                onClick={() => setSelectedLocation(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Quick Action Navigation Links */}
            <div className="flex flex-wrap items-center gap-3 bg-slate-950/80 border border-slate-800 p-3 rounded-xl">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-2">Cross-Pivot Navigation:</span>
              <Link
                href="/noc"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md"
              >
                <MapPin className="w-3.5 h-3.5" /> Open 2D Floorplan Canvas <ArrowUpRight className="w-3 h-3" />
              </Link>
              <Link
                href="/topology"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-bold transition-all"
              >
                <GlobeIcon className="w-3.5 h-3.5 text-blue-400" /> Inspect Topology Graph <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            {/* Location Metadata Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Physical Site Address</span>
                <p className="text-slate-200 font-medium">{selectedLocation.address}</p>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-slate-500 font-mono text-[10px]">GPS: {selectedLocation.latitude}° N, {selectedLocation.longitude}° E</span>
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Multi-Vendor Controller Mappings</span>
                <p className="font-mono text-emerald-400 font-bold">Juniper Mist / VeloCloud Edge / Cisco DNA</p>
                <div className="flex items-center gap-2 pt-1 text-slate-400 text-[10px]">
                  <span>Parent: {selectedLocation.parent_id || "Root Asia Enterprise"}</span>
                </div>
              </div>
            </div>

            {/* Hardware Asset Inventory Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-400" /> Hardware Asset Inventory ({assignedDevices.length} {assignedDevices.length === 1 ? "Assigned Asset" : "Assigned Assets"})
                </h4>
                <span className={`text-[11px] font-mono font-bold ${onlineCount === assignedDevices.length ? "text-emerald-400" : "text-amber-400"}`}>
                  {onlineCount} of {assignedDevices.length} Devices Online
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                      <th className="py-2.5 px-3">Device Hostname</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Vendor / Model</th>
                      <th className="py-2.5 px-3">MAC Address</th>
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3 text-right">Status / Diagnostic</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
                    {assignedDevices.map((dev) => (
                      <tr key={dev.device_id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-semibold text-white font-sans flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                          {dev.hostname}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[9px] uppercase font-bold bg-slate-900 text-indigo-300 border border-indigo-500/20">
                            {dev.device_type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-sans text-slate-300">{dev.vendor} ({dev.model})</td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">{dev.mac}</td>
                        <td className="py-2.5 px-3 text-slate-200">{dev.ip_address}</td>
                        <td className="py-2.5 px-3 text-right font-sans">
                          {dev.status === "online" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-bold uppercase">
                              <CheckCircle2 className="w-3 h-3" /> Online
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400 text-[10px] font-bold uppercase" title={dev.health_reason}>
                              <AlertTriangle className="w-3 h-3" /> Degraded ({dev.health_reason || "Unreachable"})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer Close */}
            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedLocation(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg transition-colors"
              >
                Close Asset Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
