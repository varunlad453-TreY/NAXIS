"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, Circle, Database } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function Header() {
  const pathname = usePathname();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000,
  });

  const navItems = [
    { href: "/", label: "Home" },
    { href: "/events", label: "Events" },
  ];

  const isOnline = health?.status === "healthy";

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-cyan-400/10 text-primary ring-1 ring-border transition-all group-hover:ring-primary/40">
            <Activity className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight text-foreground leading-none">
              Naxis
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle leading-none mt-1">
              Operational Intelligence
            </span>
          </div>
        </Link>


        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-foreground-muted hover:text-foreground"
                )}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <Link
            href="/devices"
            className={cn(
              "hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              pathname === "/devices"
                ? "border-primary/40 bg-primary/8 text-primary"
                : "border-border/50 text-foreground-muted hover:border-primary/30 hover:text-foreground"
            )}
          >
            <Database className="h-3.5 w-3.5" />
            Inventory
          </Link>
          <div
            className={cn(
              "hidden sm:flex items-center gap-2 text-xs font-medium",
              isOnline ? "text-success" : "text-foreground-subtle"
            )}
          >
            <Circle className={cn("h-2 w-2 fill-current", isOnline && "animate-pulse")} />
            {isOnline ? "Online" : "Connecting"}
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
