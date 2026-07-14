"use client";
import { useQuery } from "@tanstack/react-query";
import { api, DashboardStats, Requirement } from "@/lib/api";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ClipboardCheck, Sparkles, FileSearch, TrendingUp, ArrowUpRight, BookOpen, Plus } from "lucide-react";
import { StatusBadge, QualityGateBadge } from "./ScoreComponents";
import { clsx } from "clsx";

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

const STATUS_COLORS: Record<string, string> = {
  Validated: "#10B981",
  "Review needed": "#F59E0B",
  Rejected: "#F43F5E",
  Draft: "#A99CF7",
};

export default function DashboardView({ onGoToKnowledgeBase, onSelectRequirement, onFilterStatus }: {
  onGoToKnowledgeBase?: () => void;
  onSelectRequirement?: (id: string) => void;
  onFilterStatus?: (status: string) => void;
}) {
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: api.getDashboard,
    refetchInterval: 15000,
    retry: 2,
  });

  const { data: recent } = useQuery<Requirement[]>({
    queryKey: ["requirements", "recent"],
    queryFn: () => api.listRequirements({ limit: 5 }),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
        {[...Array(4)].map((_, i) => <div key={i} className="card p-5 h-28 bg-ink-100/60" />)}
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

  const isEmpty = data.total_requirements === 0;

  const chartData = [
    { name: "Validated", value: data.validated },
    { name: "Review needed", value: data.review_needed },
    { name: "Rejected", value: data.rejected },
    { name: "Draft", value: data.draft },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* ── Hero banner ──────────────────────────────────────────────── */}
      <div className="card-gradient p-6 sm:p-8 relative overflow-hidden animate-fade-in">
        <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-white/10 blur-2xl"/>
        <div className="absolute right-20 bottom-0 w-32 h-32 rounded-full bg-accent-400/20 blur-2xl"/>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <ClipboardCheck size={18} className="text-white"/>
            </div>
            <span className="badge bg-white/15 text-white border-white/20 backdrop-blur-sm">Agent 1</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-display mb-1.5">Requirement Validation</h2>
          <p className="text-brand-100 text-sm max-w-xl">
            Score user stories against a 50-point rubric, with AI suggestions on what's missing.
          </p>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroStat icon={<FileSearch size={20} className="text-brand-600"/>} accent="bg-brand-50"
          label="Total requirements" value={data.total_requirements}
          sub={isEmpty ? "Get started below" : "Click to view all"}
          onClick={onFilterStatus ? () => onFilterStatus("") : undefined} />
        <HeroStat icon={<ClipboardCheck size={20} className="text-emerald-600"/>} accent="bg-emerald-50"
          label="Validated" value={data.validated} sub="Click to view — ready for Agent 2"
          onClick={onFilterStatus ? () => onFilterStatus("validated") : undefined} />
        <HeroStat icon={<TrendingUp size={20} className="text-accent-600"/>} accent="bg-accent-50"
          label="Avg quality score" value={isEmpty ? "—" : `${data.avg_score}`} sub="out of 50" />
        <HeroStat icon={<Sparkles size={20} className="text-gold-600"/>} accent="bg-gold-50"
          label="Review needed" value={data.review_needed} sub="Click to view — awaiting refinement"
          onClick={onFilterStatus ? () => onFilterStatus("review_needed") : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Donut chart or empty state ──────────────────────────────── */}
        <div className="card p-5 lg:col-span-2 animate-slide-up">
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-3">Status breakdown</p>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-100 to-accent-50 flex items-center justify-center">
                <FileSearch size={26} className="text-brand-500"/>
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-700">No requirements yet</p>
                <p className="text-xs text-ink-400 mt-1 max-w-[220px]">
                  Add your first user story to see live validation stats here.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={160}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name"
                    innerRadius={45} outerRadius={70} paddingAngle={3} stroke="none">
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.name] || "#A99CF7"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #EEF0F6" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {chartData.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[d.name] }}/>
                      <span className="text-ink-600">{d.name}</span>
                    </div>
                    <span className="font-semibold text-ink-800">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Recent activity ──────────────────────────────────────────── */}
        <div className="card p-5 lg:col-span-3 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Recent requirements</p>
            {recent && recent.length > 0 && (
              <button
                className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:underline"
                onClick={() => onFilterStatus?.("")}>
                View all <ArrowUpRight size={12}/>
              </button>
            )}
          </div>

          {!recent || recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-50 to-brand-50 flex items-center justify-center">
                <Plus size={26} className="text-accent-500"/>
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-700">Ready when you are</p>
                <p className="text-xs text-ink-400 mt-1 max-w-[280px]">
                  Click <strong>"New requirement"</strong> above to paste a user story, link a JIRA
                  issue, or upload a BRD — Agent 1 will score it instantly.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-1">
              {recent.map(r => (
                <li key={r.id}
                  onClick={() => onSelectRequirement?.(r.id)}
                  role={onSelectRequirement ? "button" : undefined}
                  className={`flex items-center gap-3 py-2.5 border-b border-ink-100 last:border-0
                                           hover:bg-brand-50/50 rounded-lg px-2 -mx-2 transition-colors ${onSelectRequirement ? "cursor-pointer" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-700 truncate">{r.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {r.module && <span className="text-xs text-ink-400">{r.module}</span>}
                      {r.quality_gate ? <QualityGateBadge gate={r.quality_gate}/> : <StatusBadge status={r.status}/>}
                    </div>
                  </div>
                  {r.score_total > 0 && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-brand-700">{r.score_total}</p>
                      <p className="text-[10px] text-ink-400">/ 50</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Quick tips ───────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <FileSearch size={18}/>, title: "Paste or link a story", desc: "JIRA, Confluence, BRD, Word doc, or raw text — six input modes supported.", onClick: undefined },
            { icon: <Sparkles size={18}/>, title: "AI scores it instantly", desc: "5 parameters, 50-point rubric, missing-detail suggestions powered by your local LLM.", onClick: undefined },
            { icon: <BookOpen size={18}/>, title: "Build your knowledge base", desc: "Upload BRDs and Confluence pages once — every future validation gets smarter.", onClick: onGoToKnowledgeBase },
          ].map((tip, i) => (
            <div key={i}
              role={tip.onClick ? "button" : undefined}
              onClick={tip.onClick}
              className={clsx(
                "card p-5 animate-slide-up",
                tip.onClick && "cursor-pointer hover:border-brand-300 hover:-translate-y-0.5 transition-all"
              )}
              style={{ animationDelay: `${i * 80}ms` }}>
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
                {tip.icon}
              </div>
              <p className="text-sm font-semibold text-ink-700 mb-1 flex items-center gap-1.5">
                {tip.title}
                {tip.onClick && <ArrowUpRight size={13} className="text-brand-400"/>}
              </p>
              <p className="text-xs text-ink-400 leading-relaxed">{tip.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
