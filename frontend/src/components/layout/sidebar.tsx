"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Cpu } from "lucide-react";
import { useState } from "react";
import { mainNavigation, type NavSection } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";

function NavSection({
  title,
  items,
  collapsed,
}: {
  title: string;
  items: NavSection["items"];
  collapsed: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="px-3 py-2">
      {!collapsed && (
        <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          {title}
        </div>
      )}
      <div className="space-y-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground-muted hover:bg-surface hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  active
                    ? "text-primary"
                    : "text-foreground-subtle group-hover:text-foreground"
                )}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-full bg-critical/10 px-1.5 py-0.5 text-[10px] font-semibold text-critical">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-border/40 bg-background/90 backdrop-blur-xl transition-all duration-300",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border/40 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-cyan-400/10 text-primary ring-1 ring-border">
          <Cpu className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight leading-none text-foreground">
              Naxis
            </span>
            <span className="mt-1 text-[10px] uppercase leading-none tracking-[0.2em] text-foreground-subtle">
              Operational Intelligence
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {mainNavigation.map((section, index) => (
          <div key={section.title}>
            <NavSection
              title={section.title}
              items={section.items}
              collapsed={collapsed}
            />
            {index < mainNavigation.length - 1 && (
              <div className="my-2 border-t border-border/40" />
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center justify-between">
          {!collapsed && <ThemeToggle />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface hover:text-foreground",
              collapsed && "mx-auto"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
