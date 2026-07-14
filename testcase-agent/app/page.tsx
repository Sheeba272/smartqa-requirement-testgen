"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import DashboardView from "@/components/DashboardView";
import StoryInputForm from "@/components/StoryInputForm";
import TestCaseResults from "@/components/TestCaseResults";
import BrowseTestCases from "@/components/BrowseTestCases";
import { PipelineBar } from "@/components/ScoreComponents";
import { TestCase } from "@/lib/api";
import { TokenUsageModal } from "@/components/TokenUsageModal";
import { RAGPipelineModal } from "@/components/RAGPipelineModal";
import { LayoutDashboard, Plus, FlaskConical, Sparkles, ListChecks, BarChart2, GitMerge } from "lucide-react";
import { clsx } from "clsx";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5000 } } });

type View = "dashboard" | "input" | "results" | "browse";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [browseFilter, setBrowseFilter] = useState<string>("");
  const [showTokens, setShowTokens] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);

  const handleGenerated = (reqId: string, generatedCases: TestCase[]) => {
    setCases(generatedCases);
    setView("results");
  };

  const goToBrowse = (statusFilter: string) => {
    setBrowseFilter(statusFilter);
    setView("browse");
  };

  return (
    <>
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="min-h-16 sticky top-0 z-20 glass-panel rounded-none border-x-0 border-t-0 flex flex-wrap items-center px-5 py-2.5 gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-glow flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #16AECF 0%, #5840D6 100%)" }}>
            <FlaskConical size={19} className="text-white"/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink-800 text-sm font-display">Test Case Generation</span>
              <span className="badge bg-accent-50 text-accent-600 border border-accent-100">Agent 2</span>
            </div>
            <span className="text-xs text-ink-400 hidden md:inline">5 test case types, AI-generated</span>
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          <button className={clsx("btn-secondary text-xs", view === "dashboard" && "!bg-brand-50 !text-brand-700 !border-brand-200")}
            onClick={() => setView("dashboard")}>
            <LayoutDashboard size={14}/> Dashboard
          </button>
          <button className="btn-secondary text-xs" onClick={() => setShowPipeline(true)}>
            <GitMerge size={13}/> RAG pipeline
          </button>
          <button className="btn-secondary text-xs" onClick={() => setShowTokens(true)}>
            <BarChart2 size={13}/> Token usage
          </button>
          <button className="btn-primary text-xs" onClick={() => setView("input")}>
            <Plus size={13}/> New test cases
          </button>
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          {view === "dashboard" && <DashboardView onNavigate={goToBrowse}/>}

          {view === "browse" && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ListChecks size={18} className="text-accent-500"/>
                  <h1 className="text-xl font-bold text-ink-800 font-display">All test cases</h1>
                </div>
                <button className="btn-secondary text-xs" onClick={() => setView("dashboard")}>
                  Back to dashboard
                </button>
              </div>
              <BrowseTestCases initialStatusFilter={browseFilter}/>
            </>
          )}

          {view === "input" && (
            <>
              <PipelineBar step={1}/>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={18} className="text-accent-500"/>
                <h1 className="text-xl font-bold text-ink-800 font-display">Generate test cases</h1>
              </div>
              <StoryInputForm onGenerated={handleGenerated}/>
            </>
          )}

          {view === "results" && (
            <>
              <PipelineBar step={3}/>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ListChecks size={18} className="text-accent-500"/>
                  <h1 className="text-xl font-bold text-ink-800 font-display">Agent 2 — Generated test cases</h1>
                </div>
                <button className="btn-secondary text-xs" onClick={() => setView("input")}>
                  <Plus size={12}/> Generate more
                </button>
              </div>
              <TestCaseResults cases={cases} onUpdate={setCases}/>
            </>
          )}
        </div>
      </main>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="sm:hidden glass-panel rounded-none border-x-0 border-b-0 flex items-center justify-around px-2 py-2 sticky bottom-0 z-20">
        <button className={clsx("flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          view === "dashboard" ? "text-brand-700 bg-brand-50" : "text-ink-400")}
          onClick={() => setView("dashboard")}>
          <LayoutDashboard size={14}/>Dashboard
        </button>
        <button className={clsx("flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
          view === "input" ? "text-brand-700 bg-brand-50" : "text-ink-400")}
          onClick={() => setView("input")}>
          <Plus size={14}/>New
        </button>
      </nav>
    </div>
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
