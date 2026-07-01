import { Activity } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function PerformancePage() {
  return (
    <PlaceholderPage
      title="Performance"
      description="Latency, CPU, memory, and bandwidth trend analytics are coming soon."
      icon={<Activity className="h-8 w-8" />}
    />
  );
}
