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
      <div className={cn(
        "flex items-center gap-4 px-5 py-4 transition-colors cursor-pointer",
        "hover:bg-white/[0.04]",
        !event.incident_id && "opacity-75"
      )}>
        {/* Time */}
        <div className="flex items-center gap-2 min-w-fit text-foreground-muted">
          <Clock className="h-4 w-4 flex-shrink-0" />
          <time className="text-sm whitespace-nowrap" title={new Date(event.timestamp).toISOString()}>
            {formatTimestamp(event.timestamp)}
          </time>
        </div>

        {/* Severity */}
        <div className="flex-shrink-0">
          <EventSeverityBadge severity={event.severity} />
        </div>

        {/* Source */}
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm font-medium text-foreground min-w-fit">
          {event.source}
        </div>

        {/* Device */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Server className="h-4 w-4 flex-shrink-0 text-foreground-muted" />
          <div className="truncate">
            <div className="text-sm font-medium text-foreground truncate">
              {event.device_name || event.device_id}
            </div>
            {event.site_name && (
              <div className="text-xs text-foreground-muted truncate">
                {event.site_name}
              </div>
            )}
          </div>
        </div>

        {/* Title/Description */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{event.title}</p>
        </div>

        {/* Incident Link */}
        {event.incident_id && (
          <div className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary whitespace-nowrap flex-shrink-0">
            <LinkIcon className="h-3 w-3" />
            <span>Incident</span>
          </div>
        )}
      </div>
    </Link>
  );
}
