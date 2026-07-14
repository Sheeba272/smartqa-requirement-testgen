"use client";
import { useQuery } from "@tanstack/react-query";
import { api, DashboardStats } from "@/lib/api";
import { FlaskConical, Send, Layers, Sparkles, ArrowRightLeft, ListChecks } from "lucide-react";

function HeroStat({ icon, label, value, sub, accent, onClick }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string; accent: string;
  onClick?: () => void;
}) {
  return (
    <div className={`card-hover p-5 flex items-start gap-4 animate-slide-up ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick} role={onClick ? "button" : undefined}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1">{label}</p>
        <p className="text-3xl font-bold text-ink-800 font-display leading-none">{value}</p>
        {sub && <p className="text-xs text-ink-400 mt-1.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardView({ onNavigate }: { onNavigate?: (statusFilter: string) => void }) {
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
    refetchInterval: 15000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-pulse">
        {[...Array(3)].map((_, i) => <div key={i} className="card p-5 h-28 bg-ink-100/60" />)}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card p-8 text-center text-ink-400 space-y-2">
        <p className="text-sm font-medium text-ink-600">Could not reach the backend</p>
        <p className="text-xs">Make sure <code className="bg-ink-100 px-1 rounded">run_backend.bat</code> is running at port 8001, then refresh.</p>
      </div>
    );
  }

  const isEmpty = data.total_test_cases === 0;

  return (
    <div className="space-y-6">
      {/* ── Hero banner ──────────────────────────────────────────────── */}
      <div className="card-gradient p-6 sm:p-8 relative overflow-hidden animate-fade-in"
        style={{ background: "linear-gradient(135deg, #16AECF 0%, #6D5AE6 55%, #5840D6 100%)" }}>
        <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-white/10 blur-2xl"/>
        <div className="absolute right-24 bottom-0 w-32 h-32 rounded-full bg-gold-400/20 blur-2xl"/>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <FlaskConical size={18} className="text-white"/>
            </div>
            <span className="badge bg-white/15 text-white border-white/20 backdrop-blur-sm">Agent 2</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display mb-1.5">Test Case Generation</h2>
          <p className="text-white/85 text-sm max-w-xl">
            Positive, negative, boundary, error, and integration cases — generated from your stories.
          </p>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <HeroStat icon={<Layers size={20} className="text-brand-600"/>} accent="bg-brand-50"
          label="Test cases generated" value={data.total_test_cases}
          sub={isEmpty ? "Generate your first batch" : "Click to view all"}
          onClick={onNavigate ? () => onNavigate("") : undefined} />
        <HeroStat icon={<Send size={20} className="text-accent-600"/>} accent="bg-accent-50"
          label="Pushed to JIRA" value={data.pushed_to_jira} sub="Click to view pushed cases"
          onClick={onNavigate ? () => onNavigate("pushed_to_jira") : undefined} />
        <HeroStat icon={<ArrowRightLeft size={20} className="text-gold-600"/>} accent="bg-gold-50"
          label="Shared requirements corpus" value={data.total_requirements} sub="from Agent 1 + direct entries" />
      </div>

      {/* ── How it works / empty state ──────────────────────────────────── */}
      {isEmpty ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Sparkles size={18}/>, title: "Bring a user story", desc: "Paste directly, link JIRA/Confluence, or pull a validated requirement ID from Agent 1." },
            { icon: <ListChecks size={18}/>, title: "Pick your options", desc: "Choose test case types (positive/negative/boundary/error/integration), complexity, template, and naming convention." },
            { icon: <Send size={18}/>, title: "Review & push", desc: "Approve generated cases, edit notes, then push straight to JIRA as Zephyr test cases." },
          ].map((tip, i) => (
            <div key={i} className="card p-5 animate-slide-up" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="w-9 h-9 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center mb-3">
                {tip.icon}
              </div>
              <p className="text-sm font-semibold text-ink-700 mb-1">{tip.title}</p>
              <p className="text-xs text-ink-400 leading-relaxed">{tip.desc}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-5 animate-slide-up">
          <p className="text-sm text-ink-600 leading-relaxed">
            Approved test cases feed future generations as style examples — output gets more
            consistent the more you approve.
          </p>
        </div>
      )}
    </div>
  );
}
