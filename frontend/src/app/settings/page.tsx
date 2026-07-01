import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      description="Platform configuration, integrations, and user preferences are coming soon."
      icon={<Settings className="h-8 w-8" />}
    />
  );
}
