"use client";

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { IncidentDetail } from "@/types/incident";
import type { TopologyNodeDetail } from "@/types/topology";
import { BlastRadiusPanel } from "./blast-radius-panel";
import { NodeDetailPanel } from "./node-detail-panel";

export type PanelMode = "incident" | "node" | null;

interface TopologySidePanelProps {
  mode: PanelMode;
  incidentId?: string | null;
  incidentDetail?: IncidentDetail | null;
  nodeDetail?: TopologyNodeDetail | null;
  onClose: () => void;
  incidentLoading?: boolean;
  nodeLoading?: boolean;
  onNodePathTrace?: () => void;
  onNodeBlastRadius?: () => void;
}

export function TopologySidePanel({
  mode,
  incidentId,
  incidentDetail,
  nodeDetail,
  onClose,
  incidentLoading,
  nodeLoading,
  onNodePathTrace,
  onNodeBlastRadius,
}: TopologySidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (mode) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [mode, handleKeyDown]);

  if (!mode) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border/60 bg-background shadow-2xl transition-transform duration-300 ease-out"
      >
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {mode === "incident" ? "Incident Blast Radius" : "Node Details"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mode === "incident" && (
            <BlastRadiusPanel
              incidentId={incidentId}
              incidentDetail={incidentDetail}
              loading={incidentLoading}
            />
          )}
          {mode === "node" && (
            <NodeDetailPanel
              nodeDetail={nodeDetail}
              loading={nodeLoading}
              onPathTrace={onNodePathTrace}
              onBlastRadius={onNodeBlastRadius}
            />
          )}
        </div>
      </div>
    </>
  );
}
