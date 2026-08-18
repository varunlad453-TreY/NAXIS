"use client";

import { useQuery } from "@tanstack/react-query";
import { Circle, ShieldCheck, Activity, Cpu } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Header() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000,
  });

  const isOnline = health?.status === "healthy";

  const { data: summary } = useQuery({
    queryKey: ["topology-summary", "header"],
    queryFn: () => api.getTopologySummary(),
    refetchInterval: 60000,
  });

  const byType = summary?.by_type;
  const counts = byType
    ? [
        { icon: ShieldCheck, tone: "text-emerald-500", label: `${byType.site ?? 0} Sites` },
        { icon: Activity, tone: "text-slate-500", label: `${byType.ap ?? 0} APs` },
        { icon: Cpu, tone: "text-slate-500", label: `${byType.edge ?? 0} Edges` },
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-slate-800/60 bg-slate-950/90 px-5 backdrop-blur-md">
      <div className="hidden md:flex items-center gap-6 text-xs text-slate-500">
        {counts.map(({ icon: Icon, tone, label }) => (
          <div key={label} className="flex items-center gap-1.5 font-mono text-[11px]">
            <Icon className={cn("w-3.5 h-3.5", tone)} />
            <span className="text-slate-400">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-2 text-xs">
          <Circle className={cn("h-2 w-2 fill-current", isOnline ? "text-emerald-500" : "text-slate-600")} />
          <span className={cn("font-medium", isOnline ? "text-emerald-400" : "text-slate-500")}>
            {isOnline ? "Platform Online" : "Connecting..."}
          </span>
        </div>
      </div>
    </header>
  );
}
