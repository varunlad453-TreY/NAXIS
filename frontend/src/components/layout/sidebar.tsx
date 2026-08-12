"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Cpu } from "lucide-react";
import { useState } from "react";
import { mainNavigation, type NavSection } from "@/config/navigation";
import { cn } from "@/lib/utils";

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
    <div className="px-2 py-2">
      {!collapsed && (
        <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          {title}
        </div>
      )}
      <div className="space-y-0">
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
                "group flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-white"
                  : "text-slate-500 hover:text-slate-300"
              )}
              style={{
                borderLeft: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                marginLeft: active ? "-2px" : "0",
              }}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  active ? "text-slate-300" : "text-slate-600 group-hover:text-slate-400"
                )}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] font-semibold text-rose-400">
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
        "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-slate-800/40 bg-slate-950 transition-all duration-300",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-slate-800/40 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-slate-900 text-slate-400 ring-1 ring-slate-800">
          <Cpu className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight leading-none text-slate-200">
              Naxis
            </span>
            <span className="mt-0.5 text-[10px] uppercase leading-none tracking-[0.15em] text-slate-600">
              Operations
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {mainNavigation.map((section, index) => (
          <div key={section.title}>
            <NavSection
              title={section.title}
              items={section.items}
              collapsed={collapsed}
            />
            {index < mainNavigation.length - 1 && (
              <div className="my-1 border-t border-slate-800/40" />
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800/40 p-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-sm text-slate-600 transition-colors hover:bg-slate-900 hover:text-slate-400",
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
