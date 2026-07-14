"use client";
import { useState, useEffect } from "react";
import { X, CheckCircle, Loader2, Database, FileSearch, Cpu, GitMerge, ClipboardCheck, Sparkles, BookOpen, ListChecks } from "lucide-react";

type StepStatus = "idle" | "running" | "done" | "skipped";

interface PipelineStep {
  id: number;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  detail: string;
  color: string;
}

// Agent 2 — Test Case Generation specific pipeline steps
const STEPS: PipelineStep[] = [
  {
    id: 1,
    icon: <FileSearch size={16}/>,
    label: "Requirement Intake",
    sublabel: "Validated requirement received",
    detail: "Agent 2 receives the requirement ID (only requirements scored ≥40/50 by Agent 1 are accepted), along with its story body, acceptance criteria, edge cases, module, and priority.",
    color: "teal",
  },
  {
    id: 2,
    icon: <Database size={16}/>,
    label: "Text Embedding",
    sublabel: "nomic-embed-text",
    detail: "The requirement text is converted to a 768-dimension vector using nomic-embed-text, the same embedding model used by Agent 1 — ensuring consistent semantic search across both agents.",
    color: "purple",
  },
  {
    id: 3,
    icon: <ListChecks size={16}/>,
    label: "Similar Test Cases RAG",
    sublabel: "ChromaDB — past generated/approved test cases",
    detail: "Searches the smartqa_testcases collection for the top-4 most similar past test cases by cosine similarity. These are given to the LLM as few-shot style/naming references — NOT copied, but used to match your organisation's testing conventions.",
    color: "sky",
  },
  {
    id: 4,
    icon: <BookOpen size={16}/>,
    label: "Knowledge Base RAG",
    sublabel: "ChromaDB — uploaded BRD/Confluence docs",
    detail: "Searches the smartqa_knowledge collection for relevant chunks from your uploaded BRDs, Confluence pages, and reference documents — giving the LLM SAP-specific transaction codes, field names, and business rules it wouldn't otherwise know.",
    color: "orange",
  },
  {
    id: 5,
    icon: <GitMerge size={16}/>,
    label: "Context Builder",
    sublabel: "Prompt assembly",
    detail: "Combines: requirement fields + selected test case types (positive/negative/boundary/error/integration) + complexity level + naming convention + retrieved knowledge chunks + similar test cases into a single structured prompt.",
    color: "indigo",
  },
  {
    id: 6,
    icon: <Cpu size={16}/>,
    label: "LLM Generation",
    sublabel: "Qwen3 / DeepSeek-R1 (configurable per-agent model)",
    detail: "The assembled prompt is sent to the LLM with temperature=0.2 (slight creativity for varied scenarios, but still controlled). The model returns a structured JSON array of test cases with steps, step-level expected results, and an overall expected result.",
    color: "emerald",
  },
  {
    id: 7,
    icon: <ClipboardCheck size={16}/>,
    label: "Structuring, Naming & Indexing",
    sublabel: "Auto-numbered, step results validated",
    detail: "Generated test cases are re-numbered to match your naming convention (e.g. TC_Module_001), tc_type is normalised, step_expected_results is validated to ensure every test case has a complete verification step. Approved test cases are then indexed back into ChromaDB for future RAG retrieval.",
    color: "rose",
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; icon: string; ring: string }> = {
  teal:    { bg: "bg-teal-50",    border: "border-teal-200",    text: "text-teal-700",    icon: "text-teal-500",    ring: "ring-teal-400" },
  purple:  { bg: "bg-purple-50",  border: "border-purple-200",  text: "text-purple-700",  icon: "text-purple-500",  ring: "ring-purple-400" },
  sky:     { bg: "bg-sky-50",     border: "border-sky-200",     text: "text-sky-700",     icon: "text-sky-500",     ring: "ring-sky-400" },
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
              <ListChecks size={16} className="text-teal-500"/> RAG Pipeline — How Agent 2 Works
            </p>
            <p className="text-xs text-ink-400 mt-0.5">7-step Test Case Generation pipeline</p>
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
        <div className="mx-6 mt-4 mb-2 p-3 rounded-xl bg-gradient-to-r from-teal-50 to-sky-50 border border-teal-100 text-xs text-ink-600">
          <strong className="text-teal-700">What makes this different:</strong> Agent 2 doesn't just send your story
          to an LLM — it retrieves your own past test cases <em>and</em> your uploaded knowledge documents first,
          so generated test cases match your organisation's conventions and reference real SAP transaction codes.
        </div>

        {/* Pipeline steps */}
        <div className="px-6 pb-6 pt-3 space-y-2">
          {STEPS.map((step, i) => {
            const status = statuses[i];
            const c = COLOR_MAP[step.color];
            const isExpanded = expanded === step.id;
            return (
              <div key={step.id} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="absolute left-[23px] top-[44px] w-0.5 h-4 bg-ink-150 z-0"/>
                )}
                <div
                  className={`relative z-10 rounded-xl border transition-all duration-300 cursor-pointer
                    ${status === "done" ? `${c.bg} ${c.border}` : status === "running" ? "bg-white border-ink-200 ring-2 " + c.ring : "bg-white border-ink-150"}
                  `}
                  onClick={() => setExpanded(isExpanded ? null : step.id)}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all
                      ${status === "done" ? `${c.bg} ${c.border} ${c.icon}` :
                        status === "running" ? "bg-white border-teal-300 text-teal-500 animate-pulse" :
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
                      {status === "done" && <CheckCircle size={14} className={c.icon}/>}
                      {status === "running" && (
                        <span className="text-[10px] text-teal-500 font-medium animate-pulse">Processing...</span>
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
          <p className="text-xs font-bold text-ink-500 uppercase tracking-wide mb-3">Technology Stack — Agent 2</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-ink-600">
            <div><span className="font-medium text-ink-700">Vector DB:</span> ChromaDB — smartqa_testcases collection</div>
            <div><span className="font-medium text-ink-700">Embeddings:</span> nomic-embed-text</div>
            <div><span className="font-medium text-ink-700">LLM:</span> Qwen3:8b / DeepSeek-R1:8b (Ollama, local)</div>
            <div><span className="font-medium text-ink-700">Output format:</span> Structured JSON test cases</div>
            <div><span className="font-medium text-ink-700">Naming:</span> Auto-numbered per category</div>
            <div><span className="font-medium text-ink-700">Push target:</span> JIRA (when configured)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
