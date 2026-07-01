"use client";

import { ChevronDown, ChevronUp, Server } from "lucide-react";
import { InventoryPanel } from "./inventory-panel";

interface InventoryToggleProps {
  show: boolean;
  onToggle: () => void;
}

export function InventoryToggle({ show, onToggle }: InventoryToggleProps) {
  return (
    <section
      className="border-t border-border/30 pt-8"
      style={{ animation: "naxis-enter 0.6s 0.9s both" }}
    >
      <button
        onClick={onToggle}
        className="group flex w-full items-center justify-between px-1 py-1 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="h-px w-6 bg-primary/30" />
          <Server className="h-3.5 w-3.5 text-foreground-subtle" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground-muted">
            Full Inventory
          </span>
          <span className="font-mono text-[10px] text-foreground-subtle">
            all platforms combined
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-foreground-subtle transition-colors group-hover:text-primary">
          {show ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> expand
            </>
          )}
        </div>
      </button>
      {show && (
        <div
          className="mt-5 rounded-xl border border-border/30 bg-surface/30 p-5"
          style={{ animation: "naxis-enter 0.4s both" }}
        >
          <InventoryPanel />
        </div>
      )}
    </section>
  );
}
