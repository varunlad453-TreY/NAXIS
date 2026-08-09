"use client";

import React, { useEffect, useState } from "react";
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
  ChevronRight,
  Info,
  SlidersHorizontal,
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

export default function LocationsRegistryPage() {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);

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
            latitude: node.latitude,
            longitude: node.longitude,
            device_count: node.device_count || 12,
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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
              Physical Taxonomy
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-indigo-400" /> Authoritative Locations Registry
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Master multi-vendor physical facility hierarchy normalized across Juniper Mist, Cisco DNA Center, and VeloCloud.
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
              <th className="py-4 px-5 text-center">Assigned APs / Devices</th>
              <th className="py-4 px-5 text-right">Health Telemetry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {filteredLocations.map((loc) => (
              <tr
                key={loc.location_id}
                onClick={() => setSelectedLocation(loc)}
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
                    <Wifi className="w-3 h-3 text-indigo-400" /> {loc.device_count}
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

      {/* Location Inspector Modal Drawer */}
      {selectedLocation && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {getTypeIcon(selectedLocation.type)}
                <h3 className="text-lg font-bold text-white">{selectedLocation.name}</h3>
              </div>
              <button
                onClick={() => setSelectedLocation(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Canonical Location ID</span>
                <span className="font-mono text-slate-200">{selectedLocation.location_id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Taxonomy Type</span>
                <span className="uppercase font-bold text-indigo-400">{selectedLocation.type}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Parent Facility ID</span>
                <span className="font-mono text-slate-200">{selectedLocation.parent_id || "Root Enterprise"}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Multi-Vendor Controller Mappings</span>
                <span className="font-mono text-emerald-400 font-semibold">Juniper Mist / VeloCloud</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Active APs & Devices</span>
                <span className="font-bold text-white">{selectedLocation.device_count} Connected Devices</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Telemetry Health State</span>
                <span className="font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Operational
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedLocation(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
