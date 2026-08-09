"use client";

import React, { useEffect, useState } from "react";
import {
  Building,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Layers,
  Globe,
  Plus,
  RefreshCw,
  Search,
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

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/locations/tree");
      if (res.ok) {
        const data = await res.json();
        const flattened: LocationItem[] = [];
        const traverse = (node: any) => {
          flattened.push({
            location_id: node.location_id,
            name: node.name,
            type: node.type,
            parent_id: node.parent_id,
            latitude: node.latitude,
            longitude: node.longitude,
            device_count: node.device_count || 0,
            health_status: node.health_status || "healthy",
          });
          if (node.children) {
            node.children.forEach(traverse);
          }
        };
        data.forEach(traverse);
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

  const filteredLocations = locations.filter((loc) => {
    const matchesSearch =
      loc.name.toLowerCase().includes(search.toLowerCase()) ||
      loc.location_id.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || loc.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "region":
        return <Globe className="w-4 h-4 text-blue-400" />;
      case "site":
        return <MapPin className="w-4 h-4 text-indigo-400" />;
      case "building":
        return <Building className="w-4 h-4 text-emerald-400" />;
      case "floor":
        return <Layers className="w-4 h-4 text-purple-400" />;
      default:
        return <MapPin className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Building className="w-7 h-7 text-indigo-400" />
            Authoritative Physical Locations Registry
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Master multi-vendor facility taxonomy owned and normalized by Naxis.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchLocations}
            className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter locations..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
          {["all", "region", "site", "building", "floor"].map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                typeFilter === type
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Locations Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
              <th className="py-3.5 px-4">Location Name</th>
              <th className="py-3.5 px-4">Location ID</th>
              <th className="py-3.5 px-4">Taxonomy Level</th>
              <th className="py-3.5 px-4">Parent Location</th>
              <th className="py-3.5 px-4 text-center">Assigned Devices</th>
              <th className="py-3.5 px-4 text-right">Health Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {filteredLocations.map((loc) => (
              <tr key={loc.location_id} className="hover:bg-slate-800/50 transition-colors">
                <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2">
                  {getTypeIcon(loc.type)}
                  {loc.name}
                </td>
                <td className="py-3.5 px-4 font-mono text-xs text-slate-400">{loc.location_id}</td>
                <td className="py-3.5 px-4">
                  <span className="px-2.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-slate-800 text-indigo-300 border border-slate-700">
                    {loc.type}
                  </span>
                </td>
                <td className="py-3.5 px-4 font-mono text-xs text-slate-400">
                  {loc.parent_id || "—"}
                </td>
                <td className="py-3.5 px-4 text-center font-bold text-slate-200">
                  {loc.device_count}
                </td>
                <td className="py-3.5 px-4 text-right">
                  {loc.health_status === "healthy" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
                    </span>
                  )}
                  {loc.health_status === "degraded" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5" /> Degraded
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Globe(props: any) {
  return <Building {...props} />;
}
