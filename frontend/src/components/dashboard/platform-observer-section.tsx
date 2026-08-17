"use client";

import { HardDrive, Network, Radio, Wifi } from "lucide-react";
import { PlatformCard } from "./platform-card";

interface PlatformObserverSectionProps {
  mistDeviceCount: number | null;
  sdwanEdgeCount: number | null;
}

function fmt(n: number | null): string {
  return n !== null ? n.toLocaleString() : "—";
}

export function PlatformObserverSection({ mistDeviceCount, sdwanEdgeCount }: PlatformObserverSectionProps) {
  return (
    <section>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-foreground-subtle">
        Platform Observers
      </p>
      <div className="flex flex-col">
        <PlatformCard
          href="/mist"
          icon={<Wifi className="h-4 w-4" />}
          label="Juniper Mist"
          sublabel="Wireless"
          description="AP inventory, client sessions and RF health across 61 Tata Motors sites."
          stat={{ value: fmt(mistDeviceCount), label: "APs" }}
          active
          accentRgb="139,92,246"
          tag="Live"
          delay={0}
        />
        <PlatformCard
          href="/integrations"
          icon={<Network className="h-4 w-4" />}
          label="Cisco DNA Center"
          sublabel="Wired"
          description="Switches, routers and campus fabric. Full physical infrastructure."
          active={false}
          accentRgb="59,130,246"
          tag="Wired"
          delay={0}
        />
        <PlatformCard
          href="/sdwan"
          icon={<Radio className="h-4 w-4" />}
          label="Arista SD-WAN"
          sublabel="WAN"
          description="Edge devices, tunnel health and WAN telemetry across all sites."
          stat={{ value: fmt(sdwanEdgeCount), label: "Edges" }}
          active
          accentRgb="52,211,153"
          tag="Live"
          delay={0}
        />
        <PlatformCard
          href="/integrations"
          icon={<HardDrive className="h-4 w-4" />}
          label="Arista WLC"
          sublabel="Controllers"
          description="Wireless LAN controllers and managed AP visibility."
          active={false}
          accentRgb="251,191,36"
          tag="WLC"
          delay={0}
        />
      </div>
    </section>
  );
}
