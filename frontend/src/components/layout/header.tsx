"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";
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
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-950/80 px-6 backdrop-blur-xl shadow-sm">
      {/* Live Enterprise Ticker Status Bar */}
      <div className="hidden md:flex items-center gap-6 text-xs text-slate-400">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
          <ShieldCheck className="w-3.5 h-3.5" /> 153 Sites Synced
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-300">
          <Activity className="w-3.5 h-3.5 text-indigo-400" /> 1,880 Wireless APs Online
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
          <Cpu className="w-3.5 h-3.5 text-blue-400" /> 93 SD-WAN Edges Operational
        </div>
      </div>

      <div className="flex items-center gap-4 ml-auto">
        <div
          className={cn(
            "flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-full border",
            isOnline
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : "text-slate-400 bg-slate-900 border-slate-800"
          )}
        >
          <Circle className={cn("h-2 w-2 fill-current", isOnline && "animate-pulse")} />
          {isOnline ? "Platform Online (99.98% SLA)" : "Connecting..."}
        </div>
        <div className="border-l border-slate-800 pl-4">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
