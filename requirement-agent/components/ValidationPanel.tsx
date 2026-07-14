"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, Requirement } from "@/lib/api";
import { ScoreRing, ScoreBar, QualityGateBadge, StatusBadge } from "./ScoreComponents";
import { PipelineExecutionView } from "./PipelineExecutionView";
import {
  CheckCircle, XCircle, AlertTriangle, Loader2, Sparkles,
  ChevronDown, ChevronUp, Copy, Edit3, Save, RefreshCw,
  ShieldCheck, Target, Layers, BarChart3, FlaskConical,
  TrendingUp, Wand2, Info, Activity
} from "lucide-react";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";

/* ── Score dimension config ─────────────────────────────────────────────── */
const SCORE_DIMS = [
  { label: "Completeness",           key: "score_completeness",   color: "#6D5AE6", icon: Layers,      hint: "AS/WANT/SO THAT structure + description depth" },
  { label: "Acceptance Criteria",    key: "score_ac_presence",    color: "#1D9E75", icon: CheckCircle, hint: "Measurable, numbered AC lines present" },
  { label: "Edge Coverage",          key: "score_edge_coverage",  color: "#378ADD", icon: Target,      hint: "Negative scenarios, boundaries, error states" },
  { label: "Clarity",                key: "score_clarity",        color: "#D85A30", icon: ShieldCheck, hint: "No ambiguity, no undefined terms, explicit conditions" },
  { label: "Testability",            key: "score_testability",    color: "#D4537E", icon: FlaskConical,hint: "Each criterion maps to a verifiable test" },
];

/* ── Quality grade helper ───────────────────────────────────────────────── */
function qualityMeta(score: number) {
  if (score >= 40) return { grade: "A", label: "Excellent", color: "#10B981", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800" };
  if (score >= 30) return { grade: "B", label: "Good",      color: "#F59E0B", bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-800" };
  if (score >= 20) return { grade: "C", label: "Fair",      color: "#F97316", bg: "bg-orange-50",  border: "border-orange-200",  text: "text-orange-800" };
  return              { grade: "D", label: "Poor",      color: "#F43F5E", bg: "bg-rose-50",    border: "border-rose-200",    text: "text-rose-800" };
}

/* ── Inline missing-param row ───────────────────────────────────────────── */
function ParamItem({ param }: { param: any }) {
  const sev: "high" | "medium" | "low" = (param.severity === "high" || param.severity === "medium" || param.severity === "low") ? param.severity : "medium";
  const cfgMap = {
    high:   { Icon: XCircle,       cls: "text-red-500",   bg: "bg-red-50 border-red-100",   badge: "bg-red-100 text-red-700" },
    medium: { Icon: AlertTriangle, cls: "text-amber-500", bg: "bg-amber-50 border-amber-100", badge: "bg-amber-100 text-amber-700" },
    low:    { Icon: Info,          cls: "text-blue-400",  bg: "bg-blue-50 border-blue-100",  badge: "bg-blue-100 text-blue-700" },
  };
  const cfg = cfgMap[sev];
  const { Icon } = cfg;
  return (
    <li className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.bg} text-sm mb-2 last:mb-0`}>
      <Icon size={15} className={`${cfg.cls} mt-0.5 flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-semibold text-ink-700">{param.param}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cfg.badge}`}>{sev}</span>
        </div>
        <span className="text-ink-500 text-xs">{param.detail}</span>
      </div>
    </li>
  );
}

/* ── AI-suggested replacement text accordion ────────────────────────────── */
// The AI Suggestions section is now unified — no more separate "AI Analysis"
// and "AI-Suggested Improvements" showing the same text twice.
// This single section shows the analysis AND the actionable apply buttons.
function AISuggestionsSection({ req, showSuggestions, setShowSuggestions, onApply, onApplyAll, onRevalidate, isValidating, isEnhancing }: {
  req: Requirement;
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  onApply: (field: string, val: string) => void;
  onApplyAll: () => void;
  onRevalidate: () => void;
  isValidating: boolean;
  isEnhancing?: boolean;
}) {
  if (!req.ai_suggestions) return null;

  // Build a pre-conditions suggestion from story body + AC — the AI often
  // identifies pre-conditions are missing; give the user a head-start by
  // extracting likely pre-conditions from what they've already written.
  const inferPreConditions = () => {
    const parts: string[] = [];
    const story = (req.story_body || "").toLowerCase();
    if (story.includes("specialist") || story.includes("officer") || story.includes("user")) {
      parts.push("User has the required SAP role and access rights");
    }
    if (story.includes("procurement") || story.includes("purchase") || story.includes("mm")) {
      parts.push("User is logged into the SAP MM module");
    }
    if (story.includes("sales") || story.includes("order") || story.includes("sd")) {
      parts.push("User is logged into the SAP SD module");
    }
    if (parts.length === 0) {
      parts.push("User is authenticated with the required role and has access to the relevant module");
    }
    return parts.join("\n");
  };

  return (
    <div className="card overflow-hidden border-amber-200">
      <button
        className="flex items-center justify-between w-full px-5 py-3.5 bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-200 hover:from-amber-100 hover:to-yellow-100 transition-colors"
        onClick={() => setShowSuggestions(!showSuggestions)}>
        <span className="flex items-center gap-2 text-xs font-bold text-amber-800 uppercase tracking-wider">
          <Sparkles size={13}/> AI Analysis &amp; Recommendations
        </span>
        {showSuggestions ? <ChevronUp size={13} className="text-amber-600"/> : <ChevronDown size={13} className="text-amber-600"/>}
      </button>
      {showSuggestions && (
        <div className="p-5 bg-gradient-to-b from-amber-50/50 to-white space-y-4">
          {/* Analysis text */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Sparkles size={14} className="text-amber-700"/>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800 mb-1">Agent 1 Analysis</p>
              <p className="text-sm text-amber-900 leading-relaxed">{req.ai_suggestions}</p>
            </div>
          </div>

          {/* Insight pills */}
          <div className="flex flex-wrap gap-2 pt-1 pb-2 border-t border-amber-200">
            {req.score_completeness < 6 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 flex items-center gap-1">
                <XCircle size={10}/> Incomplete story structure
              </span>
            )}
            {req.score_ac_presence < 5 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 flex items-center gap-1">
                <AlertTriangle size={10}/> Weak acceptance criteria
              </span>
            )}
            {req.score_edge_coverage < 4 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                <Target size={10}/> Missing edge cases
              </span>
            )}
            {req.score_testability < 5 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                <FlaskConical size={10}/> Low testability
              </span>
            )}
            {req.score_total >= 40 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <CheckCircle size={10}/> Ready for test generation
              </span>
            )}
          </div>

          {/* ── Actions: single consolidated action bar ────────────── */}
          <div className="rounded-xl bg-white border border-amber-200 p-4">
            <p className="text-xs font-bold text-amber-700 mb-3 flex items-center gap-1.5">
              <Wand2 size={12}/> What to do next
            </p>
            <div className="grid grid-cols-1 gap-2">
              {/* PRIMARY: Apply all AI suggestions — fills all weak fields at once */}
              <button
                className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-lg text-white font-semibold disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #D97706 0%, #B45309 100%)" }}
                onClick={onApplyAll}
                disabled={isEnhancing}>
                {isEnhancing
                  ? <><Loader2 size={12} className="animate-spin flex-shrink-0"/> AI is rewriting fields...</>
                  : <><Sparkles size={12} className="flex-shrink-0"/> Apply AI suggestions to all fields (recommended)</>
                }
              </button>
              {/* Edit requirement manually */}
              <button
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-white text-ink-700 border border-ink-200 hover:bg-ink-50 transition-colors font-medium"
                onClick={() => onApply("story_body", req.story_body || "")}>
                <Edit3 size={12} className="flex-shrink-0"/>
                Edit requirement manually
              </button>
              {/* Re-validate without editing */}
              <button
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-white text-ink-500 border border-ink-200 hover:bg-ink-50 transition-colors"
                onClick={() => onRevalidate()}
                disabled={isValidating}>
                {isValidating
                  ? <Loader2 size={12} className="animate-spin flex-shrink-0"/>
                  : <RefreshCw size={12} className="flex-shrink-0"/>}
                Re-validate now (without editing)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Human-in-the-Loop edit form ────────────────────────────────────────── */
function EditForm({ req, onSaved, onCancel, prefill }: {
  req: Requirement; onSaved: () => void; onCancel: () => void;
  prefill?: { field: string; value: string } | { fields: Record<string, string> };
}) {
  // Support both single-field prefill and multi-field prefill
  const getInitial = (field: string, defaultVal: string) => {
    if (!prefill) return defaultVal;
    if ("fields" in prefill) return prefill.fields[field] ?? defaultVal;
    if ("field" in prefill && prefill.field === field) return prefill.value;
    return defaultVal;
  };

  const [storyBody, setStoryBody] = useState(getInitial("story_body", req.story_body || ""));
  const [ac, setAc] = useState(getInitial("acceptance_criteria", req.acceptance_criteria || ""));
  const [edgeCases, setEdgeCases] = useState(getInitial("edge_cases", req.edge_cases || ""));
  const [preConditions, setPreConditions] = useState(getInitial("pre_conditions", req.pre_conditions || ""));

  const updateMut = useMutation({
    mutationFn: (revalidate: boolean) => api.updateRequirement(req.id, {
      story_body: storyBody,
      acceptance_criteria: ac,
      edge_cases: edgeCases,
      pre_conditions: preConditions,
      revalidate,
    }),
    onSuccess: (_, revalidate) => {
      toast.success(revalidate ? "Saved — re-validating..." : "Saved");
      onSaved();
    },
    onError: (err: any) => {
      const raw = err?.response?.data?.detail;
      let detail: string;
      if (Array.isArray(raw)) {
        // Pydantic 422 — each item has { loc, msg, type }
        detail = raw.map((e: any) => {
          const loc = Array.isArray(e.loc) ? e.loc.filter((l: any) => l !== "body").join(" → ") : "";
          return loc ? `${loc}: ${e.msg}` : e.msg;
        }).join("; ");
      } else if (typeof raw === "string") {
        detail = raw;
      } else {
        detail = err?.message || "Unknown error";
      }
      console.error("Save failed:", err?.response?.data || err);
      toast.error(`Failed to save: ${detail}`, { duration: 8000 });
    },
  });

  const isAIFilled = prefill && "fields" in prefill && Object.keys(prefill.fields).length > 0;

  return (
    <div className="card p-5 space-y-4 border-brand-200 shadow-card-hover">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-brand-800 uppercase tracking-wider flex items-center gap-1.5">
          <Edit3 size={13}/> Edit requirement
        </p>
        <button onClick={onCancel} className="text-xs text-ink-400 hover:text-ink-600 px-2 py-1 rounded-lg hover:bg-ink-100 transition-colors">Cancel</button>
      </div>
      {isAIFilled && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <Sparkles size={13} className="text-amber-600 mt-0.5 flex-shrink-0"/>
          <div>
            <p className="text-xs font-bold text-amber-800 mb-0.5">AI suggestions applied — please review</p>
            <p className="text-[11px] text-amber-700">Fields have been pre-filled based on AI analysis. Review each field, improve the content, then click Save &amp; Re-validate.</p>
          </div>
        </div>
      )}
      <div>
        <label className="label">User story body</label>
        <textarea rows={5} className="input font-mono text-xs leading-relaxed" value={storyBody} onChange={e => setStoryBody(e.target.value)} />
      </div>
      <div>
        <label className="label">Acceptance criteria</label>
        <textarea rows={5} className="input font-mono text-xs leading-relaxed" value={ac} onChange={e => setAc(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Edge cases / negative scenarios</label>
          <textarea rows={3} className="input text-xs" value={edgeCases} onChange={e => setEdgeCases(e.target.value)} />
        </div>
        <div>
          <label className="label">Pre-conditions</label>
          <textarea rows={3} className="input text-xs" value={preConditions} onChange={e => setPreConditions(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="btn-secondary flex-1 justify-center text-xs" onClick={() => updateMut.mutate(false)}
          disabled={updateMut.isPending}>
          {updateMut.isPending ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>} Save only
        </button>
        <button className="btn-primary flex-1 justify-center text-xs" onClick={() => updateMut.mutate(true)}
          disabled={updateMut.isPending}>
          {updateMut.isPending ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Save &amp; re-validate
        </button>
      </div>
    </div>
  );
}

/* ── Main ValidationPanel ───────────────────────────────────────────────── */
export default function ValidationPanel({ reqId }: { reqId: string }) {
  const qc = useQueryClient();
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);
  const [showScores, setShowScores] = useState(true);
  const [showMissing, setShowMissing] = useState(true);
  const [showSimilar, setShowSimilar] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prefill, setPrefill] = useState<{ field: string; value: string } | { fields: Record<string, string> } | undefined>();

  const { data: req, isLoading } = useQuery<Requirement>({
    queryKey: ["requirement", reqId],
    queryFn: () => api.getRequirement(reqId),
    refetchInterval: (query) => query.state.data?.status === "validating" ? 2000 : false,
  });

  useEffect(() => { setEditing(false); setPrefill(undefined); }, [reqId]);

  const validateMut = useMutation({
    mutationFn: () => api.validateRequirement(reqId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requirement", reqId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Validation complete");
    },
    onError: () => toast.error("Validation failed"),
  });

  const copyReqId = () => {
    if (req?.id) {
      navigator.clipboard.writeText(req.id);
      toast.success("Requirement ID copied — paste into Test Case Agent");
    }
  };

  const handleApplySuggestion = (field: string, value: string) => {
    setPrefill({ field, value });
    setEditing(true);
  };

  const enhanceMut = useMutation({
    mutationFn: () => api.aiEnhanceRequirement(reqId),
    onSuccess: (data) => {
      // Coerce any accidental list values (LLM sometimes returns arrays)
      const asStr = (v: any) => Array.isArray(v) ? v.join("\n") : (v || "");
      const fields: Record<string, string> = {
        story_body:          asStr(data.story_body),
        acceptance_criteria: asStr(data.acceptance_criteria),
        edge_cases:          asStr(data.edge_cases),
        pre_conditions:      asStr(data.pre_conditions),
      };
      setPrefill({ fields });
      setEditing(true);
      if (data.ai_enhanced) {
        toast.success("AI rewrote all fields — review each one, then Save & Re-validate", { duration: 5000 });
      } else {
        toast("Fields strengthened using rule-based fallback (Ollama may be slow) — review, then Save & Re-validate",
          { icon: "⚡", duration: 5000 });
      }
    },
    onError: () => {
      toast.error("Could not reach the backend — make sure run_backend.bat is running");
    },
  });

  const handleApplyAllSuggestions = () => {
    if (!req) return;
    enhanceMut.mutate();
  };


  if (isLoading) return (
    <div className="card p-10 flex flex-col items-center justify-center gap-3 text-ink-400">
      <Loader2 size={22} className="animate-spin text-brand-500" />
      <p className="text-sm">Loading requirement...</p>
    </div>
  );
  if (!req) return null;

  const scores = SCORE_DIMS.map(d => ({ ...d, value: (req as any)[d.key] as number || 0 }));
  const isValidating = req.status === "validating" || validateMut.isPending;
  const hasScore = req.score_total > 0;
  const qMeta = qualityMeta(req.score_total);

  if (editing) {
    return (
      <EditForm req={req} prefill={prefill}
        onCancel={() => { setEditing(false); setPrefill(undefined); }}
        onSaved={() => {
          setEditing(false);
          setPrefill(undefined);
          qc.invalidateQueries({ queryKey: ["requirement", reqId] });
          qc.invalidateQueries({ queryKey: ["requirements"], exact: false });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="card p-5 overflow-hidden relative">
        {/* Subtle gradient accent bar at top */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brand-400 via-brand-500 to-accent-500"/>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-ink-800 text-base leading-snug mb-2">{req.title}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {req.module && (
                <span className="badge bg-brand-50 text-brand-600 border border-brand-100 text-[11px]">
                  {req.module}
                </span>
              )}
              {(req as any).priority && (
                <span className="badge bg-ink-100 text-ink-600 border border-ink-200 text-[11px]">
                  {(req as any).priority}
                </span>
              )}
              {req.quality_gate
                ? <QualityGateBadge gate={req.quality_gate} />
                : <StatusBadge status={req.status} />
              }
            </div>
          </div>
          {hasScore && (
            <div className="flex-shrink-0 flex flex-col items-center gap-1">
              <ScoreRing score={req.score_total} />
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${qMeta.bg} ${qMeta.text} border ${qMeta.border}`}>
                Grade {qMeta.grade} · {qMeta.label}
              </span>
            </div>
          )}
        </div>

        {/* Story preview */}
        <div className="bg-ink-50 rounded-xl p-4 text-sm text-ink-600 space-y-3 mb-4 border border-ink-100">
          {req.story_body && <p className="whitespace-pre-wrap leading-relaxed">{req.story_body}</p>}
          {req.acceptance_criteria && (
            <div className="pt-2 border-t border-ink-200">
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider mb-1.5">Acceptance criteria</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{req.acceptance_criteria}</p>
            </div>
          )}
        </div>

        {!hasScore && !isValidating && (
          <button className="btn-primary w-full justify-center py-3" onClick={() => validateMut.mutate()}>
            <Sparkles size={14} /> Run Agent 1 — Validate requirement
          </button>
        )}
        {isValidating && (
          <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
            <Loader2 size={16} className="animate-spin text-brand-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-brand-800">Validating requirement...</p>
              <p className="text-xs text-brand-600">Agent 1 is scoring your requirement against the 50-point rubric</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Score breakdown accordion ────────────────────────────────────── */}
      {hasScore && (
        <>
          <div className="card overflow-hidden">
            <button className="flex items-center justify-between w-full px-5 py-3.5 border-b border-ink-100 hover:bg-ink-50 transition-colors"
              onClick={() => setShowScores(!showScores)}>
              <span className="flex items-center gap-2 text-xs font-bold text-ink-600 uppercase tracking-wider">
                <BarChart3 size={13} className="text-brand-500"/> Quality Score Breakdown
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-ink-500">{req.score_total}/50</span>
                {showScores ? <ChevronUp size={13} className="text-ink-400"/> : <ChevronDown size={13} className="text-ink-400"/>}
              </div>
            </button>
            {showScores && (
              <div className="p-5 space-y-4">
                {/* Score grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                  {scores.map(({ label, value, color, icon: Icon }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 bg-ink-50 rounded-xl p-3 border border-ink-100 hover:border-ink-200 transition-colors">
                      <Icon size={16} style={{ color }} />
                      <span className="text-[10px] font-semibold text-ink-500 text-center leading-tight">{label}</span>
                      <span className="text-xl font-bold font-display" style={{ color }}>{value}</span>
                      <span className="text-[9px] text-ink-400 font-medium">/10</span>
                    </div>
                  ))}
                </div>
                {/* Score bars */}
                <div className="space-y-3">
                  {scores.map(({ label, value, color }) => (
                    <ScoreBar key={label} label={label} score={value} color={color} />
                  ))}
                </div>
                {/* Progress towards validation threshold */}
                <div className="bg-ink-50 rounded-xl p-3 border border-ink-100">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-ink-500 font-medium">Progress to validation threshold</span>
                    <span className="font-bold text-ink-700">{req.score_total}/40 needed</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-ink-200 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, (req.score_total / 40) * 100)}%`,
                        background: req.score_total >= 40 ? "linear-gradient(90deg, #10B981, #059669)"
                          : req.score_total >= 25 ? "linear-gradient(90deg, #F59E0B, #D97706)"
                          : "linear-gradient(90deg, #F43F5E, #E11D48)"
                      }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-ink-400 mt-1">
                    <span>0</span>
                    <span className="text-amber-600 font-semibold">25 — review</span>
                    <span className="text-emerald-600 font-semibold">40 — validated</span>
                    <span>50</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Missing parameters accordion ──────────────────────────────── */}
          {req.missing_params && req.missing_params.length > 0 && (
            <div className="card overflow-hidden">
              <button className="flex items-center justify-between w-full px-5 py-3.5 border-b border-ink-100 hover:bg-ink-50 transition-colors"
                onClick={() => setShowMissing(!showMissing)}>
                <span className="flex items-center gap-2 text-xs font-bold text-ink-600 uppercase tracking-wider">
                  <AlertTriangle size={13} className="text-amber-500"/>
                  Missing / Weak Parameters
                  <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {req.missing_params.length}
                  </span>
                </span>
                {showMissing ? <ChevronUp size={13} className="text-ink-400"/> : <ChevronDown size={13} className="text-ink-400"/>}
              </button>
              {showMissing && (
                <div className="p-5">
                  <ul>
                    {req.missing_params.map((p: any, i: number) => <ParamItem key={i} param={p} />)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Unified AI Analysis & Recommendations ──────────────────── */}
          <AISuggestionsSection
            req={req}
            showSuggestions={showSuggestions}
            setShowSuggestions={setShowSuggestions}
            onApply={handleApplySuggestion}
            onApplyAll={handleApplyAllSuggestions}
            onRevalidate={() => validateMut.mutate()}
            isValidating={isValidating}
            isEnhancing={enhanceMut.isPending}
          />

          {/* ── AI Execution Pipeline log ─────────────────────────────────── */}
          <div className="card overflow-hidden">
            <button className="flex items-center justify-between w-full px-5 py-3.5 border-b border-ink-100 hover:bg-ink-50 transition-colors"
              onClick={() => setShowPipeline(p => !p)}>
              <span className="text-xs font-bold text-ink-600 uppercase tracking-wide flex items-center gap-1.5">
                <Activity size={13} className="text-brand-500"/> AI Execution Pipeline
              </span>
              <span className="text-[10px] text-ink-400">{showPipeline ? "▲" : "▼"}</span>
            </button>
            {showPipeline && (
              <div className="p-4">
                <PipelineExecutionView reqId={reqId} isValidating={isValidating}/>
              </div>
            )}
          </div>

          {/* ── Similar past requirements accordion ───────────────────────── */}
          {req.similar_requirements && req.similar_requirements.length > 0 && (
            <div className="card overflow-hidden">
              <button className="flex items-center justify-between w-full px-5 py-3.5 border-b border-ink-100 hover:bg-ink-50 transition-colors"
                onClick={() => setShowSimilar(!showSimilar)}>
                <span className="flex items-center gap-2 text-xs font-bold text-ink-600 uppercase tracking-wider">
                  <TrendingUp size={13} className="text-brand-500"/> Similar Past Requirements
                  <span className="bg-brand-50 text-brand-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-brand-200">
                    {req.similar_requirements.length}
                  </span>
                </span>
                {showSimilar ? <ChevronUp size={13} className="text-ink-400"/> : <ChevronDown size={13} className="text-ink-400"/>}
              </button>
              {showSimilar && (
                <div className="p-5">
                  {req.similar_requirements.some((r: any) => r.similarity_reliable === false) && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 mb-3">
                      <AlertTriangle size={13} className="text-amber-600 mt-0.5 flex-shrink-0"/>
                      <p className="text-xs text-amber-700">
                        Embedding model unavailable — similarity scores aren't reliable until <code className="bg-amber-100 px-1 rounded">nomic-embed-text</code> is reachable.
                      </p>
                    </div>
                  )}
                  <ul className="space-y-2">
                    {req.similar_requirements.map((r: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100 hover:border-ink-200 transition-colors">
                        <span className="text-xs text-ink-700 font-medium flex-1 truncate">{r.title}</span>
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                          r.similarity_reliable === false || r.similarity === null
                            ? "bg-ink-100 text-ink-400"
                            : r.similarity >= 0.7 ? "bg-emerald-100 text-emerald-700"
                            : r.similarity >= 0.4 ? "bg-amber-100 text-amber-700"
                            : "bg-ink-100 text-ink-500"
                        }`}>
                          {r.similarity_reliable === false || r.similarity === null
                            ? "—"
                            : `${Math.round(r.similarity * 100)}% match`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Status result panel ───────────────────────────────────────── */}
          {req.status === "validated" && (
            <div className="card p-5 border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-400 to-green-500"/>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle size={16} className="text-emerald-600"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Approved — Ready for Test Case Generation</p>
                  <p className="text-xs text-emerald-600">Score: {req.score_total}/50 · Threshold met (≥40)</p>
                </div>
              </div>
              <p className="text-xs text-emerald-700 mb-3">
                Copy this requirement's ID and paste it into the <strong>Test Case Generation Agent</strong> (port 3002).
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 font-mono text-ink-600 truncate shadow-sm">
                  {req.id}
                </code>
                <button className="btn-success text-xs px-4 py-2" onClick={copyReqId}>
                  <Copy size={12}/> Copy ID
                </button>
              </div>
            </div>
          )}

          {req.status === "review_needed" && (
            <div className="card p-5 border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-yellow-500"/>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle size={16} className="text-amber-600"/>
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-800">Review Needed — Below Threshold</p>
                  <p className="text-xs text-amber-600">Score: {req.score_total}/50 · Need ≥40 to validate</p>
                </div>
              </div>
              <p className="text-xs text-amber-700 mt-2 mb-3">
                Address the gaps in the <strong>Missing Parameters</strong> and <strong>AI Recommendations</strong> sections above, then click Re-validate.
              </p>
              {/* Always show Copy ID so user can still try test case generation manually */}
              <div className="mt-3 pt-3 border-t border-amber-100">
                <p className="text-xs text-amber-600 mb-2">You can still copy the ID and try test case generation manually:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono text-ink-600 truncate shadow-sm">
                    {req.id}
                  </code>
                  <button className="btn-secondary text-xs px-3 py-2" onClick={copyReqId}>
                    <Copy size={12}/> Copy ID
                  </button>
                </div>
              </div>
            </div>
          )}

          {req.status === "rejected" && (
            <div className="card p-4 border-red-200 bg-gradient-to-br from-red-50 to-rose-50">
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={16} className="text-red-500 flex-shrink-0"/>
                <p className="text-sm font-bold text-red-800">Rejected — Significant Gaps Found</p>
              </div>
              <p className="text-xs text-red-700 mb-3">
                Score: {req.score_total}/50. Apply AI suggestions to rewrite all fields, then re-validate.
              </p>
              <div className="pt-2 border-t border-red-100">
                <p className="text-xs text-red-600 mb-2">You can still copy the ID and try test case generation manually:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-red-200 rounded-lg px-3 py-2 font-mono text-ink-600 truncate">
                    {req.id}
                  </code>
                  <button className="btn-secondary text-xs px-3 py-2" onClick={copyReqId}>
                    <Copy size={12}/> Copy ID
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
