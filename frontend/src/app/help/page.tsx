"use client";

import React from "react";
import {
  HelpCircle,
  BookOpen,
  Code2,
  ShieldCheck,
  Headphones,
  Terminal,
  ExternalLink,
} from "lucide-react";

export default function HelpPage() {
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header Bar */}
      <div className="border-b border-slate-800/80 pb-5">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-indigo-400" /> Platform Help & Architectural Reference
        </h1>
        <p className="text-slate-400 text-xs mt-1">
          Operational guides, REST API endpoints documentation, SLA matrices, and 24/7 enterprise NOC support escalation.
        </p>
      </div>

      {/* Guide List */}
      <div className="divide-y divide-slate-800/80">
        <div className="flex flex-col md:flex-row md:items-start gap-4 py-5">
          <BookOpen className="w-6 h-6 text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h3 className="text-base font-bold text-white">System Architecture Guide</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Understand how NAXIS ingests raw telemetry from Juniper Mist, Cisco DNA Center, and VeloCloud to normalize canonical location IDs.
            </p>
            <a
              href="#"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors pt-1"
            >
              Read Technical Whitepaper <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-start gap-4 py-5">
          <Code2 className="w-6 h-6 text-purple-400 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h3 className="text-base font-bold text-white">REST API Reference</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Integrate NAXIS telemetry and LLM Root Cause Analysis directly into your custom DevOps pipelines and OpenAPI endpoints.
            </p>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors pt-1"
            >
              Explore Swagger API Spec <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-start gap-4 py-5">
          <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h3 className="text-base font-bold text-white">SLA & Compliance Matrix</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Review service level agreement guarantees for 99.98% operational uptime and sub-second telemetry ingestion.
            </p>
            <a
              href="#"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors pt-1"
            >
              View Guarantees <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* REST API Endpoints Quick Reference */}
      <div className="border-t border-slate-800/80 pt-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-800/60">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white">Core REST API Endpoints Cheat Sheet</h3>
        </div>

        <div className="text-xs font-mono divide-y divide-slate-800/80">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 font-bold">GET</span>
              <span className="text-slate-200">/locations/tree</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Returns multi-vendor physical facility taxonomy</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 font-bold">GET</span>
              <span className="text-slate-200">/locations/floorplan/{"{location_id}"}</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Returns AP coordinates and telemetry for blueprint map</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="text-indigo-400 font-bold">POST</span>
              <span className="text-slate-200">/incidents/{"{id}"}/rca</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Triggers AI-Led Root Cause Analysis engine</span>
          </div>
        </div>
      </div>

      {/* Support Escalation */}
      <div className="border-t border-slate-800/80 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Headphones className="w-6 h-6 text-indigo-400" />
          <div>
            <h4 className="text-sm font-bold text-white">Need Tier-3 Escalation Support?</h4>
            <p className="text-xs text-slate-400">Our Enterprise NOC engineering team is available 24/7/365.</p>
          </div>
        </div>

        <a
          href="mailto:noc-support@naxis.internal"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-sm text-xs transition-all"
        >
          Contact NOC Desk
        </a>
      </div>
    </div>
  );
}
