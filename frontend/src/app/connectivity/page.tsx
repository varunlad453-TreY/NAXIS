import { Wifi } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function ConnectivityPage() {
  return (
    <PlaceholderPage
      title="Connectivity"
      description="Link, BGP, and tunnel status monitoring is under development."
      icon={<Wifi className="h-8 w-8" />}
    />
  );
}
