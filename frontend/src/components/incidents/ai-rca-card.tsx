"use client";

import React, { useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";

interface EvidenceItem {
  evidence_id: string;
  item_type: string;
  timestamp: string;
  source: string;
  summary: string;
  details?: Record<string, any>;
}

interface RCAResponse {
  incident_id: string;
  confidence_score: number;
  summary: string;
  root_cause_hypothesis: string;
  mitigation_steps: string[];
  citations: Array<{ citation_id: string; evidence_summary: string }>;
  evidence_pack: {
    evidence_items: EvidenceItem[];
    anonymization_map?: Record<string, any>;
  };
}

export function AIRcaCard({ incidentId }: { incidentId: string }) {
  const [rca, setRca] = useState<RCAResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [showEvidencePack, setShowEvidencePack] = useState(false);

  const fetchRca = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/incidents/${incidentId}/rca`);
      if (res.ok) {
        const data = await res.json();
        setRca(data);
      }
    } catch (err) {
      console.error("Failed to fetch RCA:", err);
    } finally {
      setLoading(false);
    }
  };

  const generateRca = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/incidents/${incidentId}/rca`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setRca(data);
      }
    } catch (err) {
      console.error("Failed to generate RCA:", err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchRca();
  }, [incidentId]);

  // Parse text with clickable [EVD-XX] tags
  const renderCitedText = (text: string) => {
    const parts = text.split(/(\[EVD-\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/\[(EVD-\d+)\]/);
      if (match) {
        const evdId = match[1];
        const isSelected = activeEvidenceId === evdId;
        return (
          <button
            key={idx}
            onClick={() => {
              setActiveEvidenceId(evdId);
              setShowEvidencePack(true);
            }}
            className={`inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
              isSelected
                ? "bg-indigo-600 text-white ring-2 ring-indigo-400 scale-105"
                : "bg-indigo-900/40 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-800/60"
            }`}
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            {evdId}
          </button>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Brain className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              Falsifiable AI Root Cause Analysis
              {rca && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {(rca.confidence_score * 100).toFixed(0)}% Confidence
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Grounded with mandatory evidence citations • Sanitized PII & secrets
            </p>
          </div>
        </div>

        <button
          onClick={generateRca}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-xs transition-colors disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Re-Analyze"}
        </button>
      </div>

      {rca ? (
        <div className="space-y-5">
          {/* Primary Hypothesis Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" /> Primary Technical Root Cause Hypothesis
            </div>
            <p className="text-sm font-semibold text-slate-100">{rca.root_cause_hypothesis}</p>
          </div>

          {/* Plain-English Diagnosis Narrative */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Diagnosis & Telemetry Evidence
            </h3>
            <div className="text-sm text-slate-200 leading-relaxed bg-slate-950/40 p-4 rounded-xl border border-slate-800">
              {renderCitedText(rca.summary)}
            </div>
          </div>

          {/* Actionable Mitigation Checklist */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Recommended Actionable Remediation
            </h3>
            <div className="space-y-2">
              {rca.mitigation_steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 bg-slate-950/40 border border-slate-800/80 rounded-lg text-xs text-slate-300"
                >
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-indigo-300 font-bold flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="mt-0.5">{renderCitedText(step)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Pack Drawer Toggle */}
          <div className="border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowEvidencePack(!showEvidencePack)}
              className="flex items-center justify-between w-full text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                Sanitized Evidence Pack ({rca.evidence_pack.evidence_items.length} items)
              </span>
              {showEvidencePack ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showEvidencePack && (
              <div className="mt-3 space-y-2 text-xs">
                {rca.evidence_pack.evidence_items.map((item) => {
                  const isHighlighted = activeEvidenceId === item.evidence_id;
                  return (
                    <div
                      key={item.evidence_id}
                      className={`p-3 rounded-lg border transition-all ${
                        isHighlighted
                          ? "bg-indigo-950/50 border-indigo-500 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono font-bold text-indigo-400 mb-1">
                        <span>{item.evidence_id}</span>
                        <span className="text-[10px] uppercase text-slate-500 font-sans">{item.source}</span>
                      </div>
                      <p>{item.summary}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-slate-500 text-sm">
          {loading ? "Analyzing correlated evidence & synthesizing diagnosis..." : "No RCA generated yet."}
        </div>
      )}
    </div>
  );
}
