"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DashboardBackground } from "@/components/dashboard/dashboard-background";
import { CollectorHealthWidget } from "@/components/dashboard/collector-health-widget";
import { HeroSection } from "@/components/dashboard/hero-section";
import { InventoryToggle } from "@/components/dashboard/inventory-toggle";
import { PlatformObserverSection } from "@/components/dashboard/platform-observer-section";

type EventRange = "1h" | "24h" | "7d" | "30d";

const RANGE_MS: Record<EventRange, number> = {
  "1h": 3600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
};

function useCount(key: string[], fn: () => Promise<{ total: number }>, placeholder: number | null = null) {
  const { data, isPlaceholderData } = useQuery({
    queryKey: key,
    queryFn: fn,
    refetchInterval: 15000,
    placeholderData: (prev: { total: number } | undefined) => prev ?? (placeholder !== null ? { total: placeholder } : undefined),
  });
  return { count: data?.total ?? placeholder, isStale: isPlaceholderData };
}

export default function HomePage() {
  const [showInventory, setShowInventory] = useState(false);
  const [eventRange, setEventRange] = useState<EventRange>("24h");

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 10000,
  });

  const { count: mistDeviceCount } = useCount(["mist-devices-count"], () =>
    api.listDevices({ platform: "mist", limit: 1 })
  );
  const { count: sdwanEdgeCount } = useCount(["sdwan-devices-count"], () =>
    api.listDevices({ platform: "velocloud", limit: 1 })
  );
  const { count: eventCount, isStale: eventCountStale } = useCount(["events-count", eventRange], () =>
    api.listEvents({ limit: 1, start_time: new Date(Date.now() - RANGE_MS[eventRange]).toISOString() })
  );

  const isOnline = health?.status === "healthy";

  return (
    <DashboardBackground>
      <div className="relative mx-auto max-w-6xl space-y-16 px-6 py-20 lg:px-8">
        <HeroSection isOnline={isOnline} eventCount={eventCount} eventCountStale={eventCountStale} eventRange={eventRange} onEventRangeChange={setEventRange} />
        <CollectorHealthWidget />
        <PlatformObserverSection mistDeviceCount={mistDeviceCount} sdwanEdgeCount={sdwanEdgeCount} />
        <InventoryToggle
          show={showInventory}
          onToggle={() => setShowInventory((s) => !s)}
        />
      </div>
    </DashboardBackground>
  );
}
