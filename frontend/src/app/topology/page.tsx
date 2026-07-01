import { Network } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function TopologyPage() {
  return (
    <PlaceholderPage
      title="Topology"
      description="Interactive network topology visualization is under development."
      icon={<Network className="h-8 w-8" />}
    />
  );
}
