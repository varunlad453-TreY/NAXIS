"use client";

import Link from "next/link";
import { Activity, Circle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function Header() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000, // Check every 30s
  });

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 border border-primary/20 group-hover:border-primary/40 transition-colors">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-foreground leading-none">
              Naxis
            </span>
            <span className="text-2xs text-foreground-subtle leading-none mt-0.5">
              Operational Intelligence
            </span>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm text-foreground-muted hover:text-foreground transition-colors"
          >
            Incidents
          </Link>
          <Link
            href="/timeline"
            className="text-sm text-foreground-muted hover:text-foreground transition-colors opacity-50 cursor-not-allowed"
          >
            Timeline
          </Link>
        </nav>

        {/* Status */}
        <div className="flex items-center gap-2">
          {health?.status === "healthy" ? (
            <>
              <Circle className="h-2 w-2 fill-success text-success animate-pulse" />
              <span className="text-xs text-foreground-muted">
                v{health.version}
              </span>
            </>
          ) : (
            <>
              <Circle className="h-2 w-2 fill-foreground-subtle text-foreground-subtle" />
              <span className="text-xs text-foreground-subtle">
                Connecting...
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
