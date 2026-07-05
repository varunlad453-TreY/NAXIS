import { CheckCircle2, Cloud, Loader2, Radio, Router, ShieldAlert, Wifi, XCircle } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import type { IntegrationDefinition, IntegrationStatus } from "@/types/integration";

export type { IntegrationStatus } from "@/types/integration";

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [
  {
    id: "mist",
    name: "Juniper Mist",
    vendor: "Juniper Networks",
    description: "Wireless APs, sites, clients, and alarms via the Mist REST API.",
    icon: "wifi",
  },
  {
    id: "dnac",
    name: "Cisco DNA Center",
    vendor: "Cisco",
    description: "Wired infrastructure, topology, and assurance events from DNAC.",
    icon: "router",
  },
  {
    id: "velocloud",
    name: "VeloCloud SD-WAN",
    vendor: "Arista / VMware",
    description: "Edge status, link metrics, and tunnel health from VeloCloud Orchestrator.",
    icon: "cloud",
  },
  {
    id: "arista-wlc",
    name: "Arista Wireless Controller",
    vendor: "Arista",
    description: "Controller-based wireless telemetry and client events.",
    icon: "radio",
  },
];

export const statusConfig: Record<
  IntegrationStatus,
  {
    label: string;
    icon: ComponentType<{ className?: string }>;
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
  testing: {
    label: "Testing",
    icon: Loader2,
    text: "text-info",
    dot: "bg-info",
  },
  error: {
    label: "Error",
    icon: XCircle,
    text: "text-critical",
    dot: "bg-critical",
  },
};

export function getIntegrationIcon(id: string): ReactNode {
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

export function getIntegrationDefinition(id: string): IntegrationDefinition | undefined {
  return INTEGRATION_DEFINITIONS.find((integration) => integration.id === id);
}