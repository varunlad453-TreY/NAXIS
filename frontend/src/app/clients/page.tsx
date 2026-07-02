import { Users } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function ClientsPage() {
  return (
    <PlaceholderPage
      title="Clients"
      description="Wireless and wired client health dashboard is coming soon."
      icon={<Users className="h-8 w-8" />}
    />
  );
}
