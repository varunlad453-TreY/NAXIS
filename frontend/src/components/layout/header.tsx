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

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-slate-800/60 bg-slate-950/90 px-5 backdrop-blur-md">
      <div className="hidden md:flex items-center gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-slate-400">153 Sites</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <Activity className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-400">1,880 APs</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <Cpu className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-400">93 Edges</span>
        </div>
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
