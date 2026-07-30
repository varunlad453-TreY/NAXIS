"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import { Circle } from "lucide-react";
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
    <header className="sticky top-0 z-20 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6 pl-14 lg:pl-6">
        {/* Spacer — hamburger is absolutely positioned on mobile */}
        <div className="flex-1" />

        <div className="flex items-center gap-3 shrink-0">
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-medium",
              isOnline ? "text-success" : "text-foreground-subtle"
            )}
          >
            <Circle className={cn("h-2 w-2 fill-current", isOnline && "animate-pulse")} />
            <span className="hidden sm:inline">{isOnline ? "Live" : "Connecting"}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <ThemeToggle />
        </div>
      </div>
      <div className="border-l border-border/30 pl-4">
        <ThemeToggle />
      </div>
    </header>
  );
}
