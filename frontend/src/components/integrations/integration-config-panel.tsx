"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import { api } from "@/lib/api";
import { cn, formatTimestamp } from "@/lib/utils";
import type { Integration, IntegrationActionResponse } from "@/types/integration";

interface IntegrationConfigPanelProps {
  item: Integration;
  isOpen: boolean;
  isTesting: boolean;
  onTest: (id: string) => Promise<IntegrationActionResponse>;
}

export function IntegrationConfigPanel({ item, isOpen, isTesting, onTest }: IntegrationConfigPanelProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["integration-config", item.id],
    queryFn: () => api.getIntegrationConfig(item.id),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) {
      setFeedback(null);
    }
  }, [isOpen]);

  const handleTest = async () => {
    try {
      const result = await onTest(item.id);
      setFeedback(result.message);
      await refetch();
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : "Connection test failed";
      setFeedback(message);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="border-b border-border/40 bg-background-elevated/40 px-4 py-4 lg:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
            <SettingsLabel />
            Collector configuration
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading masked configuration...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 border-l-2 border-l-critical pl-3 py-1 text-sm text-critical">
              <AlertCircle className="h-4 w-4" />
              {(error as Error).message}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm text-foreground-muted">
                <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", data.configured ? "text-success" : "text-foreground-muted")}>{data.configured ? "Configured" : "Not configured"}</span>
                {data.comingSoon && (
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-info">
                    Coming soon
                  </span>
                )}
                <span>Last test: {data.lastTestedAt ? formatTimestamp(data.lastTestedAt) : "Never"}</span>
              </div>

              <div className="space-y-4">
                {data.groups.map((group) => (
                  <div key={group.title} className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                      {group.title}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.items.map((itemField) => (
                        <div key={`${group.title}-${itemField.label}`} className="border-b border-border/40 px-1 py-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                            {itemField.label}
                          </div>
                          <div className="mt-1 text-sm text-foreground">
                            {itemField.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleTest}
                  disabled={isTesting || isFetching}
                  className="inline-flex items-center gap-2 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTesting || isFetching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {isTesting ? "Testing" : "Test connection"}
                </button>
                {feedback && <span className="text-sm text-foreground-muted">{feedback}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
            Recent errors
          </div>
          <div className="space-y-2">
            {data?.recentErrors.length ? (
              data.recentErrors.map((message, index) => (
                <div key={`${message}-${index}`} className="border-b border-border/40 px-1 py-2 text-sm text-foreground-muted">
                  {message}
                </div>
              ))
            ) : (
              <div className="border-b border-dashed border-border/40 px-1 py-2 text-sm text-foreground-subtle">
                No recent errors recorded.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Collector status
            </div>
            <div className="space-y-2">
              {data?.collectors.map((collector) => (
                <div key={collector.id} className="border-b border-border/40 px-1 py-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-foreground">{collector.label}</div>
                      <div className="text-xs text-foreground-subtle">
                        {collector.lastSync ? formatTimestamp(collector.lastSync) : "No sync yet"}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums text-foreground-muted">
                      {collector.healthScore === null ? "—" : `${collector.healthScore}%`}
                    </div>
                  </div>
                  {collector.message && <div className="mt-1 text-xs text-foreground-subtle">{collector.message}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsLabel() {
  return <span className="inline-flex h-2 w-2 bg-primary" aria-hidden />;
}