"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, BarChart2, Loader2, Zap, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

type AgentStats = {
  by_operation: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  totals: { prompt: number; completion: number; total: number; calls: number };
};
type TokenData = { agent1: AgentStats; agent2: AgentStats; grand_total: { prompt: number; completion: number; total: number; calls: number } };

function StatRow({ label, val }: { label: string; val: number }) {
  return (
    <div className="flex justify-between text-xs py-1 border-b border-ink-100 last:border-0">
      <span className="text-ink-500 capitalize">{label.replace(/_/g, " ")}</span>
      <span className="font-semibold text-ink-700">{val.toLocaleString()}</span>
    </div>
  );
}

function AgentCard({ title, color, data }: { title: string; color: string; data: AgentStats }) {
  const ops = Object.entries(data.by_operation);
  return (
    <div className={`card p-4 border-2 ${color}`}>
      <p className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-1.5">
        <Zap size={13}/> {title}
      </p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[["Total tokens", data.totals.total], ["Prompt", data.totals.prompt], ["Completion", data.totals.completion]].map(([l, v]) => (
          <div key={l as string} className="bg-ink-50 rounded-lg p-2 text-center">
            <p className="text-[10px] text-ink-400 mb-0.5">{l}</p>
            <p className="text-sm font-bold text-ink-700">{(v as number).toLocaleString()}</p>
          </div>
        ))}
      </div>
      {ops.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wide mb-2">By operation</p>
          {ops.map(([op, s]) => (
            <div key={op} className="mb-2 last:mb-0">
              <div className="flex justify-between text-xs mb-0.5">
                <span className="font-medium text-ink-600 capitalize">{op.replace(/_/g, " ")}</span>
                <span className="text-ink-400">{s.calls} call{s.calls !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                <div className="h-full rounded-full bg-brand-400 transition-all"
                  style={{ width: `${data.totals.total > 0 ? Math.min(100, (s.total / data.totals.total) * 100) : 0}%` }}/>
              </div>
              <p className="text-[10px] text-ink-400 mt-0.5">{s.total.toLocaleString()} tokens</p>
            </div>
          ))}
        </div>
      )}
      {ops.length === 0 && (
        <p className="text-xs text-ink-400 italic text-center py-2">No usage recorded yet</p>
      )}
    </div>
  );
}

export function TokenUsageModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, refetch, isFetching } = useQuery<TokenData>({
    queryKey: ["token-usage"],
    queryFn: () => (api as any).getTokenUsage(),
    refetchInterval: 30000,
  });

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-ink-100 sticky top-0 bg-white z-10 rounded-t-2xl">
          <p className="font-bold text-ink-800 flex items-center gap-2">
            <BarChart2 size={16} className="text-brand-500"/> Token Usage Dashboard
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-400 hover:text-ink-600 transition-colors" title="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""}/>
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-400 hover:text-ink-600 transition-colors">
              <X size={14}/>
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-brand-400"/>
            </div>
          )}
          {data && (
            <>
              {/* Grand total banner */}
              <div className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 p-4 text-white flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-75 mb-0.5">Total tokens used (all agents)</p>
                  <p className="text-2xl font-bold">{data.grand_total.total.toLocaleString()}</p>
                  <p className="text-xs opacity-75 mt-0.5">{data.grand_total.calls} LLM call{data.grand_total.calls !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-right text-xs opacity-75 space-y-1">
                  <p>Prompt: {data.grand_total.prompt.toLocaleString()}</p>
                  <p>Completion: {data.grand_total.completion.toLocaleString()}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AgentCard title="Agent 1 — Requirement Validation" color="border-brand-200" data={data.agent1}/>
                <AgentCard title="Agent 2 — Test Case Generation" color="border-teal-200" data={data.agent2}/>
              </div>
              <p className="text-[10px] text-ink-400 text-center">
                Token counts are recorded when Ollama responds. Fallback (rule-based) generations use 0 tokens. Refreshes every 30s.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
