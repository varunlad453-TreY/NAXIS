import {
  Activity,
  HelpCircle,
  LayoutDashboard,
  Network,
  Plug,
  Settings,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Main sidebar navigation.
 *
 * Rule: every href here must have a matching route under src/app/.
 * This is the single source of truth for primary navigation.
 */
export const mainNavigation: NavSection[] = [
  {
    title: "Operational",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/topology", label: "Topology", icon: Network },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/performance", label: "Performance", icon: Activity },
      { href: "/connectivity", label: "Connectivity", icon: Wifi },
      { href: "/clients", label: "Clients", icon: Users },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/help", label: "Help", icon: HelpCircle },
    ],
  },
];

/**
 * Utility: list all primary sidebar hrefs.
 */
export function getPrimaryRoutes(): string[] {
  return mainNavigation.flatMap((section) => section.items.map((item) => item.href));
}
