"use client";

import Link from "next/link";
import { Clock, Server, Wifi, Link as LinkIcon } from "lucide-react";
import type { EventSummary } from "@/types/event";
import { EventSeverityBadge } from "./event-severity-badge";
import { formatTimestamp, cn } from "@/lib/utils";

interface EventRowProps {
  event: EventSummary;
}

export function EventRow({ event }: EventRowProps) {
  return (
    <Link href={event.incident_id ? `/incidents/${event.incident_id}` : "#"}>
      <div
        className={cn(
          "group grid grid-cols-12 items-center gap-4 px-2 py-3.5 transition-colors hover:bg-surface",
          !event.incident_id && "opacity-75"
        )}
      >
        <div className="col-span-12 flex flex-col gap-1.5 sm:col-span-3 lg:col-span-2">
          <EventSeverityBadge severity={event.severity} />
          <div className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Clock className="h-3 w-3" />
            <time title={new Date(event.timestamp).toISOString()}>
              {formatTimestamp(event.timestamp)}
            </time>
          </div>
        </div>

        <div className="col-span-12 space-y-1.5 sm:col-span-9 lg:col-span-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border/70 bg-surface-subtle/30 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
              {event.source}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {event.title}
          </p>
        </div>

        <div className="col-span-12 space-y-1 lg:col-span-3">
          {event.device_id && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Server className="h-3.5 w-3.5 text-foreground-subtle" />
              <span className="font-mono text-foreground">{event.device_id}</span>
            </div>
          )}
          {event.site_id && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Wifi className="h-3.5 w-3.5 text-foreground-subtle" />
              <span>{event.site_name || event.site_id}</span>
            </div>
          )}
        </div>

        <div className="col-span-12 flex items-center justify-start gap-3 lg:col-span-2">
          {event.incident_id && (
            <div className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <LinkIcon className="h-3 w-3" />
              <span>Incident</span>
            </div>
          )}
          <span className="font-mono text-xs text-foreground-subtle lg:hidden">
            {event.event_id.slice(0, 10)}...
          </span>
        </div>
      </div>
    </Link>
  );
}
