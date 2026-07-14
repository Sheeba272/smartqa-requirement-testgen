"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import DashboardView from "@/components/DashboardView";
import RequirementForm from "@/components/RequirementForm";
import ValidationPanel from "@/components/ValidationPanel";
import RequirementList from "@/components/RequirementList";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";
import { PipelineBar } from "@/components/ScoreComponents";
import { TokenUsageModal } from "@/components/TokenUsageModal";
import { RAGPipelineModal } from "@/components/RAGPipelineModal";
import { LayoutDashboard, Plus, ChevronRight, ClipboardCheck, BookOpen, Sparkles, BarChart2, GitMerge } from "lucide-react";
import { clsx } from "clsx";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5000 } } });

type View = "dashboard" | "new" | "validate" | "knowledge";

const NAV_ITEMS: { key: View; label: string; icon: JSX.Element }[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={14}/> },
  { key: "knowledge", label: "Knowledge base", icon: <BookOpen size={14}/> },
];

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedReqId, setSelectedReqId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarFilterStatus, setSidebarFilterStatus] = useState("");
  const [showTokens, setShowTokens] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);

  const handleCreated = (id: string) => {
    setSelectedReqId(id);
    setView("validate");
  };

  const handleSelectReq = (id: string) => {
    setSelectedReqId(id);
    setView("validate");
  };

  // Dashboard "Validated"/"Review needed" stat cards: open the sidebar with
  // that status filter applied, so the user can browse and click into one.
  const handleFilterFromDashboard = (status: string) => {
    setSidebarFilterStatus(status);
    setSidebarOpen(true);
  };

  return (
    <>
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="min-h-16 sticky top-0 z-20 glass-panel rounded-none border-x-0 border-t-0 flex flex-wrap items-center px-5 py-2.5 gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-glow flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #6D5AE6 0%, #5840D6 100%)" }}>
            <ClipboardCheck size={19} className="text-white"/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink-800 text-sm font-display">Requirement Validation</span>
              <span className="badge-brand">Agent 1</span>
            </div>
            <span className="text-xs text-ink-400 hidden md:inline">50-point quality scoring</span>
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {NAV_ITEMS.map(item => (
            <button key={item.key}
              className={clsx(
                "btn-secondary text-xs",
                view === item.key && "!bg-brand-50 !text-brand-700 !border-brand-200"
              )}
              onClick={() => setView(item.key)}>
              {item.icon} {item.label}
            </button>
          ))}
          <button className="btn-secondary text-xs" onClick={() => setShowPipeline(true)}>
            <GitMerge size={13}/> RAG pipeline
          </button>
          <button className="btn-secondary text-xs" onClick={() => setShowTokens(true)}>
            <BarChart2 size={13}/> Token usage
          </button>
          <button className="btn-primary text-xs" onClick={() => setView("new")}>
            <Plus size={13}/> New requirement
          </button>
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className={clsx(
          "flex flex-col transition-all duration-200 flex-shrink-0",
          sidebarOpen ? "w-72" : "w-0 overflow-hidden"
        )}>
          <div className="m-3 mr-0 card flex flex-col h-[calc(100vh-104px)] overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
              <span className="text-xs font-bold text-ink-500 uppercase tracking-wide">Requirements</span>
              <button className="text-ink-400 hover:text-brand-600 transition-colors" onClick={() => setSidebarOpen(false)}>
                <ChevronRight size={15}/>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RequirementList selectedId={selectedReqId} onSelect={handleSelectReq}
                filterStatus={sidebarFilterStatus} onFilterStatusChange={setSidebarFilterStatus}/>
            </div>
          </div>
        </aside>

        {!sidebarOpen && (
          <button className="w-6 flex items-center justify-center hover:bg-white/60 transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(true)} title="Show requirements">
            <ChevronRight size={13} className="text-ink-400 rotate-180"/>
          </button>
        )}

        {/* ── Main content ─────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-4xl mx-auto">
            {view === "dashboard" && (
              <DashboardView
                onGoToKnowledgeBase={() => setView("knowledge")}
                onSelectRequirement={handleSelectReq}
                onFilterStatus={handleFilterFromDashboard}
              />
            )}

            {view === "new" && (
              <>
                <PipelineBar step={1}/>
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={18} className="text-brand-500"/>
                  <h1 className="text-xl font-bold text-ink-800 font-display">New requirement</h1>
                </div>
                <RequirementForm onCreated={handleCreated} onGoToKnowledgeBase={() => setView("knowledge")}/>
              </>
            )}

            {view === "validate" && selectedReqId && (
              <>
                <PipelineBar step={2}/>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles size={18} className="text-brand-500"/>
                    <h1 className="text-xl font-bold text-ink-800 font-display">Agent 1 — Validation</h1>
                  </div>
                  <button className="btn-secondary text-xs" onClick={() => setView("new")}>
                    <Plus size={12}/> New requirement
                  </button>
                </div>
                <ValidationPanel reqId={selectedReqId}/>
              </>
            )}

            {view === "knowledge" && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen size={18} className="text-brand-500"/>
                  <h1 className="text-xl font-bold text-ink-800 font-display">Contextual knowledge base</h1>
                </div>
                <KnowledgeBasePanel/>
              </>
            )}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="sm:hidden glass-panel rounded-none border-x-0 border-b-0 flex items-center justify-around px-2 py-2 sticky bottom-0 z-20">
        {[...NAV_ITEMS, { key: "new" as View, label: "New", icon: <Plus size={14}/> }].map(item => (
          <button key={item.key}
            className={clsx(
              "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              view === item.key ? "text-brand-700 bg-brand-50" : "text-ink-400"
            )}
            onClick={() => setView(item.key)}>
            {item.icon}{item.label}
          </button>
        ))}
      </nav>    </div>
      {showTokens && <TokenUsageModal onClose={() => setShowTokens(false)}/>}
      {showPipeline && <RAGPipelineModal onClose={() => setShowPipeline(false)}/>}
  </>
  );
}

export default function Page() {
  return (
    <QueryClientProvider client={qc}>
      <App/>
      <Toaster position="bottom-right" toastOptions={{ style: { fontSize: 13, borderRadius: 10, fontFamily: "Plus Jakarta Sans" } }}/>
    </QueryClientProvider>
  );
}
