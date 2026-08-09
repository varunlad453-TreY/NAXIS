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
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
            Documentation & Support
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-indigo-400" /> Platform Help & Architectural Reference
        </h1>
        <p className="text-slate-400 text-xs mt-1">
          Operational guides, REST API endpoints documentation, SLA matrices, and 24/7 enterprise NOC support escalation.
        </p>
      </div>

      {/* Guide Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-3">
          <BookOpen className="w-8 h-8 text-indigo-400" />
          <h3 className="text-base font-bold text-white">System Architecture Guide</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Understand how NAXIS ingests raw telemetry from Juniper Mist, Cisco DNA Center, and VeloCloud to normalize canonical location IDs.
          </p>
          <a
            href="#"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors pt-2"
          >
            Read Technical Whitepaper <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-3">
          <Code2 className="w-8 h-8 text-purple-400" />
          <h3 className="text-base font-bold text-white">REST API Reference</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Integrate NAXIS telemetry and LLM Root Cause Analysis directly into your custom DevOps pipelines and OpenAPI endpoints.
          </p>
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors pt-2"
          >
            Explore Swagger API Spec <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-3">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
          <h3 className="text-base font-bold text-white">SLA & Compliance Matrix</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Review service level agreement guarantees for 99.98% operational uptime and sub-second telemetry ingestion.
          </p>
          <a
            href="#"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors pt-2"
          >
            View Guarantees <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* REST API Endpoints Quick Reference */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white">Core REST API Endpoints Cheat Sheet</h3>
        </div>

        <div className="space-y-3 text-xs font-mono">
          <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">GET</span>
              <span className="text-slate-200">/locations/tree</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Returns multi-vendor physical facility taxonomy</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">GET</span>
              <span className="text-slate-200">/locations/floorplan/{"{location_id}"}</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Returns AP coordinates and telemetry for blueprint map</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-bold">POST</span>
              <span className="text-slate-200">/incidents/{"{id}"}/rca</span>
            </div>
            <span className="text-slate-500 font-sans text-[11px]">Triggers AI-Led Root Cause Analysis engine</span>
          </div>
        </div>
      </div>

      {/* Support Escalation */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Headphones className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Need Tier-3 Escalation Support?</h4>
            <p className="text-xs text-slate-400">Our Enterprise NOC engineering team is available 24/7/365.</p>
          </div>
        </div>

        <a
          href="mailto:noc-support@naxis.internal"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-indigo-600/30"
        >
          Contact NOC Desk
        </a>
      </div>
    </div>
  );
}
