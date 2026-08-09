"use client";

import React, { useState } from "react";
import {
  Settings,
  Key,
  Bell,
  Database,
  Shield,
  Save,
  CheckCircle2,
  Lock,
} from "lucide-react";

export default function SettingsPage() {
  const [mistToken, setMistToken] = useState("●●●●●●●●●●●●●●●●●●●●●●●●");
  const [veloHost, setVeloHost] = useState("vco-prod.velocloud.net");
  const [veloKey, setVeloKey] = useState("●●●●●●●●●●●●●●●●●●●●");
  const [ciscoHost, setCiscoHost] = useState("dnac.corp.internal");
  const [webhookUrl, setWebhookUrl] = useState("https://hooks.slack.com/services/T00/B00/XXXXX");
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header Bar */}
      <div className="border-b border-slate-800/80 pb-5">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-mono font-bold uppercase tracking-wider">
            Platform Administration
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" /> Enterprise Platform Configuration
        </h1>
        <p className="text-slate-400 text-xs mt-1">
          Manage multi-vendor API credentials, telemetry polling intervals, notification webhooks, and security access policies.
        </p>
      </div>

      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-xl flex items-center gap-3 text-xs font-semibold shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Enterprise configuration successfully encrypted and saved to database!
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Vendor API Credentials */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Key className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Multi-Vendor Controller API Credentials</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">Juniper Mist API Token</label>
              <div className="relative">
                <input
                  type="password"
                  value={mistToken}
                  onChange={(e) => setMistToken(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <Lock className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-500" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">VeloCloud Orchestrator Host</label>
              <input
                type="text"
                value={veloHost}
                onChange={(e) => setVeloHost(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">VeloCloud Enterprise Key</label>
              <div className="relative">
                <input
                  type="password"
                  value={veloKey}
                  onChange={(e) => setVeloKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <Lock className="w-3.5 h-3.5 absolute right-3 top-3 text-slate-500" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">Cisco DNA Center Host</label>
              <input
                type="text"
                value={ciscoHost}
                onChange={(e) => setCiscoHost(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Webhooks & Alerts */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Bell className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Incident Alerts & Webhook Destinations</h3>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300">Slack / PagerDuty Webhook URL</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[11px] text-slate-500">Automated LLM Root Cause Summaries will post directly to this channel when incidents trigger.</p>
          </div>
        </div>

        {/* System & DB Retention */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-md space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Database className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Telemetry Retention & Database Engine</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-slate-300 font-medium">Raw Telemetry Retention</span>
              <span className="font-bold font-mono text-indigo-400">90 Days</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-slate-300 font-medium">Incident Evidence Compression</span>
              <span className="font-bold font-mono text-emerald-400">Enabled (zstd)</span>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-indigo-600/30"
          >
            <Save className="w-4 h-4" /> Save & Encrypt Platform Settings
          </button>
        </div>
      </form>
    </div>
  );
}
