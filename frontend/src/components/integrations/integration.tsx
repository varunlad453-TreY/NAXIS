import { CheckCircle2, Cloud, Radio, Router, ShieldAlert, Wifi, XCircle } from "lucide-react";

export type IntegrationStatus = "connected" | "disconnected" | "not_configured";

export interface Integration {
  id: string;
  name: string;
  vendor: string;
  description: string;
  icon: string;
  status: IntegrationStatus;
  lastSync: string | null;
  eventsLastHour: number;
  healthScore: number | null;
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "mist",
    name: "Juniper Mist",
    vendor: "Juniper Networks",
    description: "Wireless APs, sites, clients, and alarms via the Mist REST API.",
    icon: "wifi",
    status: "not_configured",
    lastSync: null,
    eventsLastHour: 0,
    healthScore: null,
  },
  {
    id: "dnac",
    name: "Cisco DNA Center",
    vendor: "Cisco",
    description: "Wired infrastructure, topology, and assurance events from DNAC.",
    icon: "router",
    status: "not_configured",
    lastSync: null,
    eventsLastHour: 0,
    healthScore: null,
  },
  {
    id: "velocloud",
    name: "VeloCloud SD-WAN",
    vendor: "Arista / VMware",
    description: "Edge status, link metrics, and tunnel health from VeloCloud Orchestrator.",
    icon: "cloud",
    status: "not_configured",
    lastSync: null,
    eventsLastHour: 0,
    healthScore: null,
  },
  {
    id: "arista-wlc",
    name: "Arista Wireless Controller",
    vendor: "Arista",
    description: "Controller-based wireless telemetry and client events.",
    icon: "radio",
    status: "not_configured",
    lastSync: null,
    eventsLastHour: 0,
    healthScore: null,
  },
];

export const statusConfig: Record<
  IntegrationStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    text: string;
    dot: string;
  }
> = {
  connected: {
    label: "Connected",
    icon: CheckCircle2,
    text: "text-success",
    dot: "bg-success",
  },
  disconnected: {
    label: "Disconnected",
    icon: XCircle,
    text: "text-critical",
    dot: "bg-critical",
  },
  not_configured: {
    label: "Not configured",
    icon: ShieldAlert,
    text: "text-foreground-subtle",
    dot: "bg-foreground-subtle",
  },
};

export function getIntegrationIcon(id: string): React.ReactNode {
  const className = "h-5 w-5";
  switch (id) {
    case "mist":
      return <Wifi className={className} />;
    case "dnac":
      return <Router className={className} />;
    case "velocloud":
      return <Cloud className={className} />;
    case "arista-wlc":
      return <Radio className={className} />;
    default:
      return <Cloud className={className} />;
  }
}
