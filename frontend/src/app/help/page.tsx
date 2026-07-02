import { HelpCircle } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export default function HelpPage() {
  return (
    <PlaceholderPage
      title="Help"
      description="Documentation, guides, and support resources are coming soon."
      icon={<HelpCircle className="h-8 w-8" />}
    />
  );
}
