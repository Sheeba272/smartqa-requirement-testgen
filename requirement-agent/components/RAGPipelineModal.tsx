"use client";
import { useState, useEffect } from "react";
import { X, CheckCircle, Loader2, Database, FileSearch, Cpu, GitMerge, ClipboardCheck, Sparkles, BookOpen } from "lucide-react";

type StepStatus = "idle" | "running" | "done" | "skipped";

interface PipelineStep {
  id: number;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  detail: string;
  color: string;
}

const STEPS: PipelineStep[] = [
  {
    id: 1,
    icon: <FileSearch size={16}/>,
    label: "Requirement Parsing",
    sublabel: "Input fields extracted",
    detail: "Story body, acceptance criteria, edge cases and pre-conditions are extracted and normalised from your input.",
    color: "brand",
  },
  {
    id: 2,
    icon: <Database size={16}/>,
    label: "Text Chunking & Embedding",
    sublabel: "nomic-embed-text",
    detail: "The requirement text is split into semantic chunks. Each chunk is converted to a 768-dimension vector using nomic-embed-text running locally in Ollama.",
    color: "purple",
  },
  {
    id: 3,
    icon: <BookOpen size={16}/>,
    label: "Knowledge Base RAG",
    sublabel: "ChromaDB vector search",
    detail: "Your uploaded BRD / Word / Confluence documents are searched using cosine similarity. The top-4 most relevant knowledge chunks are retrieved to provide domain context to the LLM.",
    color: "teal",
  },
  {
    id: 4,
    icon: <GitMerge size={16}/>,
    label: "Similar Requirements RAG",
    sublabel: "Past requirements corpus",
    detail: "Previously validated requirements are searched in ChromaDB. Top-3 similar requirements are retrieved as few-shot examples, helping the LLM understand your organisation's quality standards.",
    color: "orange",
  },
  {
    id: 5,
    icon: <Cpu size={16}/>,
    label: "LLM Validation",
    sublabel: "Claude / Qwen3 / DeepSeek-R1",
    detail: "The requirement + RAG context is sent to the LLM with a structured scoring prompt. The model returns completeness, AC quality, edge coverage, clarity and testability scores (0–10 each) plus missing parameter flags and actionable suggestions.",
    color: "indigo",
  },
  {
    id: 6,
    icon: <ClipboardCheck size={16}/>,
    label: "Score Calculation & Gating",
    sublabel: "50-point quality gate",
    detail: "Scores are summed (max 50). ≥40 → Validated (Agent 2 unlocked). 25–39 → Review Needed. <25 → Rejected. Missing parameters are ranked HIGH/MEDIUM/LOW for triage.",
    color: "emerald",
  },
  {
    id: 7,
    icon: <Sparkles size={16}/>,
    label: "AI Enhancement & Re-validation",
    sublabel: "Human-in-the-loop",
    detail: "If below threshold, the LLM rewrites all four fields (story body, AC, edge cases, pre-conditions) using domain-specific SAP knowledge. The user reviews and re-validates in a Human-in-the-Loop workflow.",
    color: "rose",
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; icon: string; ring: string }> = {
  brand:   { bg: "bg-brand-50",   border: "border-brand-200",   text: "text-brand-700",   icon: "text-brand-500",   ring: "ring-brand-400" },
  purple:  { bg: "bg-purple-50",  border: "border-purple-200",  text: "text-purple-700",  icon: "text-purple-500",  ring: "ring-purple-400" },
  teal:    { bg: "bg-teal-50",    border: "border-teal-200",    text: "text-teal-700",    icon: "text-teal-500",    ring: "ring-teal-400" },
  orange:  { bg: "bg-orange-50",  border: "border-orange-200",  text: "text-orange-700",  icon: "text-orange-500",  ring: "ring-orange-400" },
  indigo:  { bg: "bg-indigo-50",  border: "border-indigo-200",  text: "text-indigo-700",  icon: "text-indigo-500",  ring: "ring-indigo-400" },
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: "text-emerald-500", ring: "ring-emerald-400" },
  rose:    { bg: "bg-rose-50",    border: "border-rose-200",    text: "text-rose-700",    icon: "text-rose-500",    ring: "ring-rose-400" },
};

export function RAGPipelineModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<StepStatus[]>(STEPS.map(() => "idle"));
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const runAnimation = async () => {
    setRunning(true);
    setStatuses(STEPS.map(() => "idle"));
    for (let i = 0; i < STEPS.length; i++) {
      setStatuses(prev => prev.map((s, idx) => idx === i ? "running" : s));
      await new Promise(r => setTimeout(r, 700 + Math.random() * 400));
      setStatuses(prev => prev.map((s, idx) => idx === i ? "done" : s));
      await new Promise(r => setTimeout(r, 180));
    }
    setRunning(false);
  };

  useEffect(() => { runAnimation(); }, []);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 rounded-t-2xl border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-ink-800 text-base flex items-center gap-2">
              <Database size={16} className="text-brand-500"/> RAG Pipeline — How Agent 1 Works
            </p>
            <p className="text-xs text-ink-400 mt-0.5">7-step Retrieval-Augmented Generation pipeline</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runAnimation} disabled={running}
              className="text-xs px-3 py-1.5 rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-50 flex items-center gap-1 disabled:opacity-50 transition-colors">
              <Loader2 size={11} className={running ? "animate-spin" : ""}/>
              {running ? "Running..." : "Replay"}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-400 transition-colors">
              <X size={14}/>
            </button>
          </div>
        </div>

        {/* Architecture note */}
        <div className="mx-6 mt-4 mb-2 p-3 rounded-xl bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-100 text-xs text-ink-600">
          <strong className="text-brand-700">What makes this different:</strong> Every validation uses two RAG retrievals —
          your uploaded knowledge documents <em>and</em> your past validated requirements — giving the LLM real
          organisational context rather than relying purely on general training data.
        </div>

        {/* Pipeline steps */}
        <div className="px-6 pb-6 pt-3 space-y-2">
          {STEPS.map((step, i) => {
            const status = statuses[i];
            const c = COLOR_MAP[step.color];
            const isExpanded = expanded === step.id;
            return (
              <div key={step.id} className="relative">
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="absolute left-[23px] top-[44px] w-0.5 h-4 bg-ink-150 z-0"/>
                )}
                <div
                  className={`relative z-10 rounded-xl border transition-all duration-300 cursor-pointer
                    ${status === "done" ? `${c.bg} ${c.border}` : status === "running" ? "bg-white border-ink-200 ring-2 " + c.ring : "bg-white border-ink-150"}
                  `}
                  onClick={() => setExpanded(isExpanded ? null : step.id)}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Step number / icon */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all
                      ${status === "done" ? `${c.bg} ${c.border} ${c.icon}` :
                        status === "running" ? "bg-white border-brand-300 text-brand-500 animate-pulse" :
                        "bg-ink-50 border-ink-200 text-ink-400"}`}>
                      {status === "running" ? <Loader2 size={14} className="animate-spin"/> :
                       status === "done" ? step.icon :
                       <span className="text-xs font-bold">{step.id}</span>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${status === "done" ? c.text : "text-ink-500"}`}>
                        {step.label}
                      </p>
                      <p className="text-[11px] text-ink-400">{step.sublabel}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {status === "done" && (
                        <CheckCircle size={14} className={c.icon}/>
                      )}
                      {status === "running" && (
                        <span className="text-[10px] text-brand-500 font-medium animate-pulse">Processing...</span>
                      )}
                      <span className="text-[10px] text-ink-300">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={`px-4 pb-3 pt-0 border-t ${c.border} mx-4 mb-2`}>
                      <p className="text-xs text-ink-600 leading-relaxed mt-2">{step.detail}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tech stack summary */}
        <div className="mx-6 mb-6 p-4 rounded-xl bg-ink-50 border border-ink-150">
          <p className="text-xs font-bold text-ink-500 uppercase tracking-wide mb-3">Technology Stack</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-ink-600">
            <div><span className="font-medium text-ink-700">Vector DB:</span> ChromaDB (in-process)</div>
            <div><span className="font-medium text-ink-700">Embeddings:</span> nomic-embed-text</div>
            <div><span className="font-medium text-ink-700">LLM:</span> Claude / Qwen3:8b / DeepSeek-R1</div>
            <div><span className="font-medium text-ink-700">RAG retrieval:</span> Cosine similarity top-k</div>
            <div><span className="font-medium text-ink-700">Backend:</span> FastAPI + SQLite</div>
            <div><span className="font-medium text-ink-700">Frontend:</span> Next.js + React Query</div>
          </div>
        </div>
      </div>
    </div>
  );
}
