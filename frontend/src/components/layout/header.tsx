"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, Circle, Search } from "lucide-react";
import { api } from "@/lib/api";

export function Header() {
  const pathname = usePathname();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000, // Check every 30s
  });

  const navItems = [
    { href: "/", label: "Incidents" },
    { href: "/events", label: "Events" },
    { href: "/devices", label: "Devices" },
  ];

  const navClass = (href: string) =>
    pathname === href
      ? "bg-white/10 text-foreground border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
      : "text-foreground-muted hover:text-foreground hover:bg-white/5 border-transparent";

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-background/72 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      <div className="container mx-auto flex h-20 items-center gap-4 px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/25 to-cyan-400/10 border border-white/10 shadow-[0_0_40px_rgba(0,174,239,0.18)] group-hover:border-primary/40 transition-colors">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight text-foreground leading-none">
              Naxis
            </span>
            <span className="text-[11px] uppercase tracking-[0.24em] text-foreground-subtle leading-none mt-1">
              Operational Intelligence
            </span>
          </div>
        </Link>

        <div className="hidden xl:flex flex-1 justify-center px-4">
          <div className="flex w-full max-w-xl items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-foreground-muted shadow-[0_24px_80px_-40px_rgba(0,0,0,0.75)]">
            <Search className="h-4 w-4 text-foreground-subtle" />
            <span className="truncate">Search incidents, sites, devices, or event IDs</span>
            <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">
              Ctrl K
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="hidden lg:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full border px-4 py-2 text-sm transition-all ${navClass(item.href)}`}
            >
              {item.label}
            </Link>
          ))}
          <span className="rounded-full border border-dashed border-white/10 px-4 py-2 text-sm text-foreground-subtle opacity-60">
            Topology
          </span>
        </nav>

        {/* Status */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-foreground-muted">
            <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_18px_rgba(34,197,94,0.65)] animate-pulse" />
            {health?.status === "healthy" ? `v${health.version} online` : "Connecting to platform"}
          </div>
          {health?.status === "healthy" ? (
            <div className="flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-2 text-xs text-success">
              <Circle className="h-2 w-2 fill-success text-success animate-pulse" />
              All systems operational
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-foreground-subtle">
              <Circle className="h-2 w-2 fill-foreground-subtle text-foreground-subtle" />
              Syncing live status
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
