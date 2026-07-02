"use client";

import { Filter, Search, X } from "lucide-react";
import type { DeviceReachability } from "@/types/device";

interface DeviceFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  platformFilter: string;
  onPlatformChange: (value: string) => void;
  reachabilityFilter: DeviceReachability | "all";
  onReachabilityChange: (value: DeviceReachability | "all") => void;
  groupBySite: boolean;
  onGroupToggle: () => void;
  platforms: string[];
}

export function DeviceFilterBar({
  search,
  onSearchChange,
  platformFilter,
  onPlatformChange,
  reachabilityFilter,
  onReachabilityChange,
  groupBySite,
  onGroupToggle,
  platforms,
}: DeviceFilterBarProps) {
  const hasFilters = search || platformFilter !== "all" || reachabilityFilter !== "all";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          type="text"
          placeholder="Search by hostname, MAC, model, site, IP, serial..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full border-b border-border/70 bg-transparent py-2 pl-7 pr-4 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-primary/30"
        />
      </div>

      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-foreground-subtle" />
        <select
          value={platformFilter}
          onChange={(e) => onPlatformChange(e.target.value)}
          className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
        >
          <option value="all">All Platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={reachabilityFilter}
          onChange={(e) => onReachabilityChange(e.target.value as DeviceReachability | "all")}
          className="border-b border-border/70 bg-transparent px-1 py-2 text-sm text-foreground outline-none focus:border-primary/30"
        >
          <option value="all">All Status</option>
          <option value="reachable">Online</option>
          <option value="unreachable">Offline</option>
        </select>

        <button
          onClick={onGroupToggle}
          className={`rounded border px-2 py-1 text-sm transition-colors ${
            groupBySite
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-border/60 text-foreground-muted hover:text-foreground"
          }`}
        >
          Group by site
        </button>

        {hasFilters && (
          <button
            onClick={() => {
              onSearchChange("");
              onPlatformChange("all");
              onReachabilityChange("all");
            }}
            className="inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
