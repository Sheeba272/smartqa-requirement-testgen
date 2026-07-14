"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CheckCircle, Loader2, Clock, Database, Cpu, GitMerge, FileSearch, BarChart2, Sparkles, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";

interface PipelineStep {
  step: number;
  label: string;
  detail: string;
  status: string;
  tokens: number;
  latency_ms: number;
  retrieved: number;
  ts: number;
}

const STEP_ICONS: Record<number, React.ReactNode> = {
  1: <FileSearch size={13}/>,
  2: <Database size={13}/>,
  3: <Database size={13}/>,
  4: <GitMerge size={13}/>,
  5: <Cpu size={13}/>,
  6: <Sparkles size={13}/>,
  7: <BarChart2 size={13}/>,
};

const STEP_COLORS = ["brand", "purple", "teal", "orange", "indigo", "emerald", "rose"];
const COLOR_CLASSES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  brand:   { bg: "bg-brand-50",   border: "border-brand-200",   text: "text-brand-700",   icon: "text-brand-500" },
  purple:  { bg: "bg-purple-50",  border: "border-purple-200",  text: "text-purple-700",  icon: "text-purple-500" },
  teal:    { bg: "bg-teal-50",    border: "border-teal-200",    text: "text-teal-700",    icon: "text-teal-500" },
  orange:  { bg: "bg-orange-50",  border: "border-orange-200",  text: "text-orange-700",  icon: "text-orange-500" },
  indigo:  { bg: "bg-indigo-50",  border: "border-indigo-200",  text: "text-indigo-700",  icon: "text-indigo-500" },
  emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: "text-emerald-500" },
  rose:    { bg: "bg-rose-50",    border: "border-rose-200",    text: "text-rose-700",    icon: "text-rose-500" },
};

export function PipelineExecutionView({ reqId, isValidating }: {
  reqId: string;
  isValidating: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-log", reqId],
    queryFn: () => (api as any).getPipelineLog(reqId),
    enabled: !!reqId,
    refetchInterval: isValidating ? 2000 : false,
  });

  const steps: PipelineStep[] = data?.steps || [];
  const available = data?.available;

  if (!available && !isValidating && !isLoading) {
    return (
      <div className="text-xs text-ink-400 italic text-center py-3">
        Run validation to see the AI execution pipeline trace
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-ink-400">
        <Loader2 size={12} className="animate-spin"/> Loading pipeline log...
      </div>
    );
  }

  const totalTokens = steps.reduce((s, e) => s + (e.tokens || 0), 0);
  const totalLatency = steps.reduce((s, e) => s + (e.latency_ms || 0), 0);
  const totalRetrieved = steps.reduce((s, e) => s + (e.retrieved || 0), 0);

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      {steps.length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-ink-500 bg-ink-50 rounded-lg px-3 py-2 border border-ink-100">
          <span className="flex items-center gap-1">
            <Cpu size={11} className="text-brand-400"/>
            <strong className="text-ink-700">{totalTokens.toLocaleString()}</strong> tokens
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} className="text-teal-500"/>
            <strong className="text-ink-700">{(totalLatency/1000).toFixed(1)}s</strong>
          </span>
          <span className="flex items-center gap-1">
            <Database size={11} className="text-orange-400"/>
            <strong className="text-ink-700">{totalRetrieved}</strong> chunks retrieved
          </span>
          <span className="ml-auto text-[10px] text-ink-400">
            {steps.length}/7 steps
          </span>
        </div>
      )}

      {/* Step list */}
      <div className="space-y-1.5">
        {steps.map((step, i) => {
          const colorKey = STEP_COLORS[i % STEP_COLORS.length];
          const c = COLOR_CLASSES[colorKey];
          return (
            <div key={step.step}
              className={clsx("flex items-start gap-2 rounded-lg border px-3 py-2 transition-all", c.bg, c.border)}>
              <div className={clsx("mt-0.5 flex-shrink-0", c.icon)}>
                {STEP_ICONS[step.step] || <CheckCircle size={13}/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={clsx("text-xs font-semibold", c.text)}>{step.label}</span>
                  <CheckCircle size={10} className={c.icon}/>
                  {step.tokens > 0 && (
                    <span className="text-[10px] text-ink-400 ml-auto">{step.tokens.toLocaleString()} tokens</span>
                  )}
                  {step.latency_ms > 0 && (
                    <span className="text-[10px] text-ink-400">{(step.latency_ms/1000).toFixed(1)}s</span>
                  )}
                  {step.retrieved > 0 && (
                    <span className="text-[10px] text-orange-500">{step.retrieved} retrieved</span>
                  )}
                </div>
                <p className="text-[11px] text-ink-500 mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          );
        })}

        {/* Live "running" placeholder while validating */}
        {isValidating && steps.length < 7 && (
          <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 animate-pulse">
            <Loader2 size={13} className="text-brand-400 animate-spin flex-shrink-0"/>
            <span className="text-xs text-brand-600 font-medium">
              Step {steps.length + 1} — Running...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
