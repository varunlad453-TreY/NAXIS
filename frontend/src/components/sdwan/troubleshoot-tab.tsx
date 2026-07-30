"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Globe,
  HelpCircle,
  Layers,
  Shield,
  TrendingDown,
  WifiOff,
} from "lucide-react";

interface TroubleshootStep {
  id: string;
  title: string;
  description: string;
  checks: string[];
  action: string;
}

const TROUBLESHOOT_FLOWS: Array<{ id: string; icon: React.ElementType; label: string; color: string; steps: TroubleshootStep[] }> = [
  {
    id: "edge-offline",
    icon: WifiOff,
    label: "Edge Offline",
    color: "text-critical",
    steps: [
      {
        id: "1", title: "Verify physical connectivity",
        description: "An offline edge almost always means the device cannot reach the VCO. Start with layer 1.",
        checks: ["Check WAN port LEDs — are they lit?", "Is the edge powered on and booting?", "Is the ISP link active? Call the ISP if needed."],
        action: "If LEDs are dark → check cable / power cycle the edge.",
      },
      {
        id: "2", title: "Check internet reachability from the edge",
        description: "If the physical link is up but the edge is still offline, the ISP may be blocking outbound traffic.",
        checks: ["Can the edge ping 8.8.8.8?", "Is DNS resolving?", "Is TCP/443 outbound to *.velocloud.net allowed?"],
        action: "Ask the ISP to verify the circuit. Confirm firewall rules allow TCP/443 outbound.",
      },
      {
        id: "3", title: "Verify VCO reachability",
        description: "The edge needs to reach the VCO activation server.",
        checks: ["Is vco109-usca1.velocloud.net reachable?", "Are there proxy or firewall rules blocking it?", "Has the activation key expired in VCO?"],
        action: "In VCO → Configure → Edges → check the edge activation state and reissue if expired.",
      },
      {
        id: "4", title: "Reboot the edge",
        description: "If all network checks pass but the edge is still offline, a software hang may be the cause.",
        checks: ["Remote reboot via VCO if partial connectivity exists", "Physical power cycle if fully unreachable", "Check edge logs via USB console for kernel panics"],
        action: "Remote: VCO → Monitor → Edges → [edge] → Remote Actions → Reboot.",
      },
    ],
  },
  {
    id: "degraded-link",
    icon: TrendingDown,
    label: "Degraded WAN Link",
    color: "text-major",
    steps: [
      {
        id: "1", title: "Identify which link is degraded in Link Health tab",
        description: "VeloBrain scores below 3.5 indicate a link problem. Open the Link Health tab and expand the affected edge.",
        checks: ["Which link interface is affected (GE1, GE2, LTE)?", "Are latency/jitter/loss all elevated, or just one?", "When did the score first drop?"],
        action: "Note the specific link name and the metric that is worst — this tells you what to investigate.",
      },
      {
        id: "2", title: "High latency (>100 ms)",
        description: "Sustained high latency points to ISP routing issues or a congested circuit.",
        checks: ["Run a traceroute from the edge (VCO → Diagnostics)", "Compare latency to the SLA for this circuit", "Check if it correlates with business hours (congestion vs. routing fault)"],
        action: "Raise an ISP ticket with traceroute output. VeloCloud Dynamic Path will steer traffic away automatically.",
      },
      {
        id: "3", title: "High packet loss (>0.5%)",
        description: "Packet loss causes retransmissions and degrades real-time apps immediately.",
        checks: ["Is loss only on one link? → ISP problem", "Is loss on all links? → possible local equipment fault", "Check cable/SFP integrity if using fiber"],
        action: "For ISP loss: raise a ticket with VeloCloud latency graph export as evidence.",
      },
      {
        id: "4", title: "Confirm VeloCloud DMPO is working",
        description: "SD-WAN should already be steering away from the bad link automatically.",
        checks: ["In VCO: Monitor → Edges → [edge] → QoE — is steering active?", "Are overlay tunnels re-established on the healthy link?", "Is the business policy enforcing the right path preference?"],
        action: "If DMPO is not steering: check the Business Policy priority rules in VCO.",
      },
    ],
  },
  {
    id: "high-loss",
    icon: AlertTriangle,
    label: "Packet Loss Alarm",
    color: "text-critical",
    steps: [
      {
        id: "1", title: "Confirm loss is real-time",
        description: "VeloBrain metrics are 1-hour averages. Check live loss in VCO.",
        checks: ["VCO → Monitor → Edges → [edge] → WAN Links → Live stats", "Is loss >0.5% sustained for >5 minutes?", "Or is it a spike that has already resolved?"],
        action: "If already resolved: check VCO alerts for root cause. If ongoing: proceed to step 2.",
      },
      {
        id: "2", title: "Isolate the loss to one link",
        description: "Loss on a single link is usually an ISP problem. Loss on all links suggests a local switch/router issue.",
        checks: ["Compare all WAN links in the Link Health tab", "Check if the LTE backup link is also showing loss", "Run VCO diagnostics → packet capture on the affected interface"],
        action: "Single-link loss → ISP ticket. Multi-link loss → check the WAN aggregation switch.",
      },
      {
        id: "3", title: "Check for duplex mismatch",
        description: "A duplex mismatch on the WAN handoff port causes severe packet loss and is easy to miss.",
        checks: ["VCO → Configure → Edge → Device settings → WAN interface speed/duplex", "Is the ISP CPE set to auto or hardcoded?", "Check interface error counters in VCO diagnostics"],
        action: "Force both the edge and the ISP CPE to the same speed/duplex setting.",
      },
    ],
  },
  {
    id: "app-performance",
    icon: Activity,
    label: "Application Performance",
    color: "text-info",
    steps: [
      {
        id: "1", title: "Check VeloBrain score for the affected edge",
        description: "Application problems are often preceded by link quality degradation that VeloBrain detects first.",
        checks: ["Is the VeloBrain score below 4.0 for this edge?", "Is latency elevated on the primary WAN link?", "Are any links in UNSTABLE state?"],
        action: "If score is OK: the problem is likely an application-layer issue, not the WAN. Proceed to step 2.",
      },
      {
        id: "2", title: "Check Business Policy and QoS",
        description: "Application traffic may be mis-classified or placed on a suboptimal path.",
        checks: ["VCO → Configure → Profiles → Business Policy: Is the app correctly matched?", "Is real-time traffic (VoIP, video) prioritised (P1)?", "Are there queuing policies that may be dropping bursts?"],
        action: "Update the Business Policy to prioritise the affected application class.",
      },
      {
        id: "3", title: "Verify DNS and overlay health",
        description: "Overlay tunnel problems can cause intermittent application failures even when the underlay looks healthy.",
        checks: ["VCO → Monitor → Edges: check overlay tunnel states", "Are all tunnels to the data centre / hub established?", "Run VCO → Diagnostics → Remote Diagnostics → tunnel test"],
        action: "If tunnels are down: check hub edge status. Restart the VCO edge service if needed.",
      },
    ],
  },
];

export function TroubleshootTab() {
  const [activeFlow, setActiveFlow] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const flow = TROUBLESHOOT_FLOWS.find(f => f.id === activeFlow);

  return (
    <div className="flex gap-6 min-h-[500px]">
      {/* Sidebar */}
      <div className="w-52 shrink-0 space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-foreground-subtle px-2 mb-3">Fault Scenarios</p>
        {TROUBLESHOOT_FLOWS.map(f => (
          <button key={f.id} onClick={() => { setActiveFlow(f.id); setExpandedStep(null); }}
            className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              activeFlow === f.id
                ? "bg-primary/10 border border-primary/25 text-primary"
                : "hover:bg-surface/60 text-foreground-muted hover:text-foreground border border-transparent"
            }`}>
            <f.icon className={`h-4 w-4 shrink-0 ${activeFlow === f.id ? "text-primary" : f.color}`} />
            <span className="font-medium">{f.label}</span>
          </button>
        ))}
        <div className="pt-4 border-t border-border/30 mt-4">
          <p className="text-2xs uppercase tracking-[0.2em] text-foreground-subtle px-2 mb-2">Reference</p>
          {[
            { icon: Globe, label: "VCO Portal" },
            { icon: Shield, label: "Security Policy" },
            { icon: Layers, label: "DMPO Logic" },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-2 px-3 py-2 text-xs text-foreground-subtle">
              <r.icon className="h-3.5 w-3.5" />{r.label}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!flow ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
            <HelpCircle className="h-10 w-10 text-foreground-subtle" />
            <div>
              <p className="font-semibold text-foreground">Select a fault scenario</p>
              <p className="text-sm text-foreground-muted mt-1 max-w-sm">
                Choose a fault type from the left to walk through a structured troubleshooting guide for your SD-WAN environment.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 pb-4 border-b border-border/40">
              <flow.icon className={`h-5 w-5 ${flow.color}`} />
              <div>
                <h3 className="font-semibold text-foreground">{flow.label}</h3>
                <p className="text-xs text-foreground-muted">Follow each step in sequence. Steps build on each other.</p>
              </div>
            </div>
            <div className="space-y-3">
              {flow.steps.map((step, idx) => (
                <div key={step.id} className={`rounded-lg border transition-all ${expandedStep === step.id ? "border-primary/30 bg-primary/4" : "border-border/40 bg-surface/30 hover:bg-surface/50"}`}>
                  <button onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0 ${expandedStep === step.id ? "bg-primary text-white" : "bg-surface-subtle text-foreground-subtle"}`}>{idx + 1}</span>
                      <span className="font-medium text-foreground text-sm">{step.title}</span>
                    </div>
                    {expandedStep === step.id ? <ChevronDown className="h-4 w-4 text-foreground-subtle" /> : <ChevronRight className="h-4 w-4 text-foreground-subtle" />}
                  </button>
                  {expandedStep === step.id && (
                    <div className="px-4 pb-4 space-y-4">
                      <p className="text-sm text-foreground-muted">{step.description}</p>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-foreground-subtle mb-2">Checks</p>
                        <ul className="space-y-1.5">
                          {step.checks.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <Circle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-foreground-subtle" />{c}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/8 px-3 py-2.5">
                        <ArrowRight className="h-4 w-4 text-info shrink-0 mt-0.5" />
                        <p className="text-sm text-foreground"><span className="font-semibold text-info">Action: </span>{step.action}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
