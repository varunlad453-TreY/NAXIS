"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { IncidentCard } from "@/components/incidents/incident-card";
import { IncidentListSkeleton } from "@/components/incidents/incident-skeleton";
import { EmptyState } from "@/components/incidents/empty-state";
import { StatsPanel } from "@/components/layout/stats-panel";
import type { IncidentSeverity } from "@/types/incident";

export default function HomePage() {
  const [activeOnly, setActiveOnly] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["incidents", activeOnly],
    queryFn: () =>
      activeOnly ? api.listActiveIncidents() : api.listIncidents(),
    refetchInterval: 10000, // Refresh every 10s
  });

  const incidents = data?.incidents ?? [];

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main Content */}
        <div>
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-semibold text-foreground mb-2">
              Incidents
            </h1>
            <p className="text-foreground-muted">
              Real-time operational intelligence across your network infrastructure
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="mb-6 flex items-center gap-2 border-b border-border">
            <button
              onClick={() => setActiveOnly(true)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activeOnly
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Active
              {activeOnly && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveOnly(false)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                !activeOnly
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              All
              {!activeOnly && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {/* Error State */}
          {error && (
            <div className="rounded-lg border border-critical-border bg-critical-bg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-critical flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-critical mb-1">
                    Failed to load incidents
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {error instanceof Error ? error.message : "Unknown error"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Incident List */}
          {isLoading ? (
            <IncidentListSkeleton count={5} />
          ) : incidents.length > 0 ? (
            <div className="space-y-3">
              {incidents.map((incident) => (
                <IncidentCard key={incident.incident_id} incident={incident} />
              ))}
            </div>
          ) : (
            <EmptyState variant={activeOnly ? "no-active" : "no-incidents"} />
          )}

          {/* Footer */}
          {!isLoading && incidents.length > 0 && (
            <div className="mt-6 text-center text-sm text-foreground-subtle">
              Showing {incidents.length} of {data?.total ?? 0} incidents
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {!isLoading && <StatsPanel incidents={incidents} />}
        </div>
      </div>
    </div>
  );
}
