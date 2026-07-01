"use client";

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
    <header className="sticky top-0 z-40 flex h-16 items-center justify-end gap-4 border-b border-border/40 bg-background/70 px-6 backdrop-blur-xl">
      <div
        className={cn(
          "flex items-center gap-2 text-xs font-medium",
          isOnline ? "text-success" : "text-foreground-subtle"
        )}
      >
        <Circle className={cn("h-2 w-2 fill-current", isOnline && "animate-pulse")} />
        {isOnline ? "Online" : "Connecting"}
      </div>
    </header>
  );
}
