"use client";

import { useState } from "react";
import { ExternalLink, Settings2 } from "lucide-react";
import {
  INTEGRATIONS,
  IntegrationStats,
  IntegrationRow,
  type Integration,
} from "@/components/integrations";

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS);
  const [isTesting, setIsTesting] = useState<string | null>(null);

  const handleTest = async (id: string) => {
    setIsTesting(id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setIntegrations((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.status === "connected" ? "disconnected" : "connected",
              lastSync: item.status !== "connected" ? new Date().toISOString() : null,
              eventsLastHour: item.status !== "connected" ? 12 : 0,
              healthScore: item.status !== "connected" ? 92 : null,
            }
          : item
      )
    );
    setIsTesting(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            Platform connections
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            Integrations
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Manage vendor collectors, credentials, and ingestion health.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 text-sm font-medium text-foreground-subtle transition-colors hover:text-foreground">
          <Settings2 className="h-4 w-4" />
          Global settings
        </button>
      </div>

      {/* Stats */}
      <IntegrationStats integrations={integrations} />

      {/* Integration list */}
      <section>
        <div className="mb-3 hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle lg:grid lg:grid-cols-12 lg:gap-6">
          <div className="col-span-4">Source</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Last sync</div>
          <div className="col-span-2">Health</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-border/30">
          {integrations.map((item) => (
            <IntegrationRow
              key={item.id}
              item={item}
              isTesting={isTesting === item.id}
              onTest={handleTest}
            />
          ))}
        </div>
      </section>

      {/* Help link */}
      <div className="flex items-start gap-3 text-sm">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-foreground-muted">
          <span className="font-medium text-foreground">Need a custom collector?</span>{" "}
          New vendor integrations can be added via the worker configuration. See the
          integration guide for details.
        </p>
      </div>
    </div>
  );
}
