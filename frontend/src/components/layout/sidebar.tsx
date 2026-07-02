"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Brain,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Home,
  Menu,
  Radio,
  Server,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",            icon: Home,          label: "Home",        exact: true },
  { href: "/events",      icon: Zap,           label: "Events" },
  { href: "/devices",     icon: Server,        label: "Inventory" },
  { href: "/mist",        icon: Wifi,          label: "Mist Wi-Fi" },
  { href: "/sdwan",       icon: Radio,         label: "SD-WAN" },
  { href: "/correlation", icon: Brain,         label: "Correlation" },
] as const;

function NavItem({
  href, icon: Icon, label, exact, collapsed,
  onClick,
}: {
  href: string; icon: React.ElementType; label: string; exact?: boolean;
  collapsed: boolean; onClick?: () => void;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
        active
          ? "bg-primary/12 text-primary"
          : "text-foreground-muted hover:bg-surface hover:text-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-foreground-subtle group-hover:text-foreground")} />
      {!collapsed && <span className="truncate">{label}</span>}
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-2 z-50 hidden group-hover:flex items-center whitespace-nowrap rounded-md border border-border/60 bg-surface-elevated px-2 py-1 text-xs font-medium text-foreground shadow-lg">
          {label}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  const pathname = usePathname();
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Persist collapsed state and sync body attribute
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    const val = stored === "true";
    setCollapsed(val);
    document.body.setAttribute("data-sidebar-collapsed", String(val));
  }, []);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", String(next));
      document.body.setAttribute("data-sidebar-collapsed", String(next));
      return next;
    });
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn("flex h-16 items-center border-b border-border/40 px-3 shrink-0", collapsed ? "justify-center" : "gap-3 px-4")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-cyan-400/10 text-primary ring-1 ring-border">
          <Activity className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight text-foreground leading-none">Naxis</div>
            <div className="text-2xs uppercase tracking-[0.2em] text-foreground-subtle mt-0.5">Operational Intelligence</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {!collapsed && (
          <p className="mb-2 px-3 text-2xs font-bold uppercase tracking-[0.2em] text-foreground-subtle">Navigation</p>
        )}
        {NAV.map(item => (
          <NavItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            exact={"exact" in item ? item.exact : undefined}
            collapsed={collapsed}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      <div className="hidden lg:flex shrink-0 border-t border-border/40 p-2">
        <button
          onClick={toggleCollapsed}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-foreground-muted hover:bg-surface hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger trigger (in header slot) */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-background/80 backdrop-blur text-foreground-muted hover:text-foreground transition-colors"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-background border-r border-border/50 transition-transform duration-200 lg:hidden",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebarContent}
      </div>

      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 border-r border-border/50 bg-background/95 backdrop-blur transition-all duration-200",
        collapsed ? "w-[60px]" : "w-56"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}

export function useSidebarWidth() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    setCollapsed(stored === "true");
    const handler = () => setCollapsed(localStorage.getItem("sidebar-collapsed") === "true");
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return collapsed ? 60 : 224;
}
