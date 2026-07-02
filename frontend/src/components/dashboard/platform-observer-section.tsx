"use client";

import { HardDrive, Network, Radio, Wifi } from "lucide-react";
import { PlatformCard } from "./platform-card";

interface PlatformObserverSectionProps {
  mistDeviceCount: number;
  sdwanEdgeCount: number;
}

export function PlatformObserverSection({ mistDeviceCount, sdwanEdgeCount }: PlatformObserverSectionProps) {
  return (
    <section style={{ animation: "naxis-enter 0.8s 0.4s both" }}>
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-foreground-subtle">
        Platform Observers
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PlatformCard
          href="/mist"
          icon={<Wifi className="h-5 w-5" />}
          label="Juniper Mist"
          sublabel="Wireless"
          description="AP inventory, client sessions and RF health across 61 Tata Motors sites."
          stat={{ value: mistDeviceCount.toLocaleString(), label: "APs" }}
          active
          accentRgb="139,92,246"
          tag="Live"
          delay={0.5}
        />
        <PlatformCard
          href="/integrations"
          icon={<Network className="h-5 w-5" />}
          label="Cisco DNA Center"
          sublabel="Wired"
          description="Switches, routers and campus fabric. Full physical infrastructure."
          active={false}
          accentRgb="59,130,246"
          tag="Wired"
          delay={0.6}
        />
        <PlatformCard
          href="/sdwan"
          icon={<Radio className="h-5 w-5" />}
          label="Arista SD-WAN"
          sublabel="WAN"
          description="Edge devices, tunnel health and WAN telemetry across all sites."
          stat={{ value: sdwanEdgeCount.toLocaleString(), label: "Edges" }}
          active
          accentRgb="52,211,153"
          tag="Live"
          delay={0.7}
        />
        <PlatformCard
          href="/integrations"
          icon={<HardDrive className="h-5 w-5" />}
          label="Arista WLC"
          sublabel="Controllers"
          description="Wireless LAN controllers and managed AP visibility."
          active={false}
          accentRgb="251,191,36"
          tag="WLC"
          delay={0.8}
        />
      </div>
    </section>
  );
}
