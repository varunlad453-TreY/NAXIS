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
import { API_BASE } from "@/lib/api";


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
      const res = await fetch(`${API_BASE}/incidents/${incidentId}/rca`);
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
      const res = await fetch(`${API_BASE}/incidents/${incidentId}/rca`, {
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
    <div className="border-t border-border/40 pt-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              AI Root Cause Analysis
              {rca && (
                <span className="text-xs font-semibold text-success">
                  {(rca.confidence_score * 100).toFixed(0)}% Confidence
                </span>
              )}
            </h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              Grounded with mandatory evidence citations • Sanitized PII & secrets
            </p>
          </div>
        </div>

        <button
          onClick={generateRca}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary-hover text-primary-foreground font-medium text-xs transition-colors disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Re-Analyze"}
        </button>
      </div>

      {rca ? (
        <div className="space-y-5">
          {/* Primary Hypothesis */}
          <div className="border-l-2 border-l-primary pl-3 space-y-2">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Primary Root Cause Hypothesis
            </div>
            <p className="text-sm font-semibold text-foreground">{rca.root_cause_hypothesis}</p>
          </div>

          {/* Diagnosis Narrative */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-foreground-subtle uppercase tracking-wider">
              Diagnosis & Telemetry Evidence
            </h3>
            <div className="text-sm text-foreground-muted leading-relaxed border-l-2 border-l-border pl-3">
              {renderCitedText(rca.summary)}
            </div>
          </div>

          {/* Mitigation Checklist */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-foreground-subtle uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" /> Recommended Remediation
            </h3>
            <div className="space-y-2">
              {rca.mitigation_steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 py-2 border-b border-border/40 text-xs text-foreground-muted"
                >
                  <span className="text-xs font-bold text-primary flex-shrink-0">
                    {idx + 1}.
                  </span>
                  <div>{renderCitedText(step)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Pack Toggle */}
          <div className="border-t border-border/40 pt-3">
            <button
              onClick={() => setShowEvidencePack(!showEvidencePack)}
              className="flex items-center justify-between w-full text-xs font-semibold text-foreground-subtle hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Evidence Pack ({rca.evidence_pack.evidence_items.length} items)
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
                      className={`py-2 border-b transition-all ${
                        isHighlighted
                          ? "border-primary text-foreground"
                          : "border-border/40 text-foreground-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono font-bold text-primary mb-1">
                        <span>{item.evidence_id}</span>
                        <span className="text-[10px] uppercase text-foreground-subtle font-sans">{item.source}</span>
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
        <div className="py-8 text-center text-foreground-muted text-sm">
          {loading ? "Analyzing correlated evidence & synthesizing diagnosis..." : "No RCA generated yet."}
        </div>
      )}
    </div>
  );
}
