"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import {
  AlertBannerGroup,
  CollectorSection,
  IntegrationConfigPanel,
  IntegrationRow,
  IntegrationStats,
  type IntegrationActionResponse,
} from "@/components/integrations";

export default function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [expandedCollectorsId, setExpandedCollectorsId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.listIntegrations(),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: telemetryAlerts } = useQuery({
    queryKey: ["telemetry-alerts"],
    queryFn: () => api.listTelemetryAlerts(),
    refetchInterval: 30000,
    retry: false,
  });

  const integrations = data?.integrations ?? [];

  const refreshIntegrations = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const handleTest = async (id: string): Promise<IntegrationActionResponse> => {
    setTestingId(id);
    try {
      const result = await api.testIntegration(id);
      await refreshIntegrations();
      return result;
    } finally {
      setTestingId(null);
    }
  };

  const handleSync = async (id: string): Promise<IntegrationActionResponse> => {
    setSyncingId(id);
    try {
      const result = await api.syncIntegration(id);
      await refreshIntegrations();
      return result;
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="space-y-4 border-b border-border/50 pb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Platform connections
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Integrations
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-foreground-muted">
              Live status for each vendor collector, with real connectivity tests, sync actions,
              and masked configuration details for operators.
            </p>
          </div>

          <div className="flex items-center gap-3 text-sm text-foreground-muted">
            {isFetching && (
              <span className="inline-flex items-center gap-2 text-sm text-foreground-muted">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Refreshing live status
              </span>
            )}
          </div>
        </div>

        <IntegrationStats integrations={integrations} />
      </header>

      {telemetryAlerts && telemetryAlerts.count > 0 && (
        <AlertBannerGroup alerts={telemetryAlerts.alerts} />
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading integrations...
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 border-l-2 border-l-critical pl-3 py-2 text-sm text-critical">
          <AlertCircle className="h-4 w-4" />
          {(error as Error).message}
        </div>
      )}

      <section className="space-y-0">
        {integrations.map((item) => (
          <div key={item.id} className="scroll-mt-24">
            <IntegrationRow
              item={item}
              isTesting={testingId === item.id}
              isSyncing={syncingId === item.id}
              isOpen={openConfigId === item.id}
              isCollectorsOpen={expandedCollectorsId === item.id}
              onToggleConfigure={(id) => setOpenConfigId((current) => (current === id ? null : id))}
              onToggleCollectors={(id) => setExpandedCollectorsId((current) => (current === id ? null : id))}
              onTest={(id) => handleTest(id)}
              onSync={(id) => handleSync(id)}
            />
            <CollectorSection
              collectors={item.collectors}
              isOpen={expandedCollectorsId === item.id}
              integrationId={item.id}
            />
            <IntegrationConfigPanel
              item={item}
              isOpen={openConfigId === item.id}
              isTesting={testingId === item.id}
              onTest={handleTest}
            />
          </div>
        ))}
      </section>

      {!integrations.length && !isLoading && !error && (
        <div className="border-t border-border/60 py-10 text-sm text-foreground-muted">
          No integrations are available.
        </div>
      )}
    </div>
  );
}