"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DashboardBackground } from "@/components/dashboard/dashboard-background";
import { HeroSection } from "@/components/dashboard/hero-section";
import { InventoryToggle } from "@/components/dashboard/inventory-toggle";
import { PlatformObserverSection } from "@/components/dashboard/platform-observer-section";

function useCount(key: string[], fn: () => Promise<{ total: number }>) {
  const { data } = useQuery({ queryKey: key, queryFn: fn, refetchInterval: 15000 });
  return data?.total ?? 0;
}

export default function HomePage() {
  const [showInventory, setShowInventory] = useState(false);

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 10000,
  });

  const mistDeviceCount = useCount(["mist-devices-count"], () =>
    api.listDevices({ platform: "mist", limit: 1 })
  );
  const sdwanEdgeCount = useCount(["sdwan-devices-count"], () =>
    api.listDevices({ platform: "velocloud", limit: 1 })
  );
  const eventCount = useCount(["events-count"], () => api.listEvents({ limit: 1 }));

  const isOnline = health?.status === "healthy";

  return (
    <DashboardBackground>
      <div className="relative mx-auto max-w-6xl space-y-16 px-6 py-20 lg:px-8">
        <HeroSection isOnline={isOnline} eventCount={eventCount} />
        <PlatformObserverSection mistDeviceCount={mistDeviceCount} sdwanEdgeCount={sdwanEdgeCount} />
        <InventoryToggle
          show={showInventory}
          onToggle={() => setShowInventory((s) => !s)}
        />
      </div>
    </DashboardBackground>
  );
}
