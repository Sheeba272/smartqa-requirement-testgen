"use client";
import { clsx } from "clsx";

export function ScoreRing({ score, max = 50 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color = score >= 40 ? "#10B981" : score >= 25 ? "#F59E0B" : "#F43F5E";
  const r = 34, cx = 42, cy = 42, circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF0F6" strokeWidth="7" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 42 42)"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
        <text x="42" y="38" textAnchor="middle" fontSize="17" fontWeight="700" fontFamily="Sora, sans-serif" fill="#262B3D">{score}</text>
        <text x="42" y="53" textAnchor="middle" fontSize="9" fill="#9AA3BC">/ {max}</text>
      </svg>
      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
        style={{ color, background: `${color}14` }}>
        {score >= 40 ? "Validated" : score >= 25 ? "Review needed" : "Rejected"}
      </span>
    </div>
  );
}

export function ScoreBar({ label, score, max = 10, color = "#6D5AE6" }: {
  label: string; score: number; max?: number; color?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-ink-600 font-medium">{label}</span>
        <span className="font-bold" style={{ color }}>{score}<span className="text-ink-400 font-normal">/{max}</span></span>
      </div>
      <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${(score / max) * 100}%`, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
      </div>
    </div>
  );
}

export function QualityGateBadge({ gate }: { gate?: string }) {
  if (!gate) return null;
  const cfg: Record<string, { cls: string; label: string }> = {
    validated: { cls: "badge-validated", label: "✓ Validated" },
    review_needed: { cls: "badge-review", label: "⚠ Review needed" },
    rejected: { cls: "badge-rejected", label: "✗ Rejected" },
  };
  const c = cfg[gate] || cfg.review_needed;
  return <span className={c.cls}>{c.label}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    validated: "badge-validated", review_needed: "badge-review",
    rejected: "badge-rejected", draft: "badge-draft",
    validating: "badge bg-accent-50 text-accent-600 border border-accent-100",
  };
  return <span className={map[status] || "badge-draft"}>{status.replace(/_/g, " ")}</span>;
}

// 3-step pipeline — this agent's scope ends at validation.
// Test case generation happens in the separate Test Case Generation Agent.
export function PipelineBar({ step }: { step: number }) {
  const steps = ["Input", "Validate", "Ready"];
  return (
    <div className="flex rounded-2xl overflow-hidden border border-ink-200 mb-6 bg-white/60 backdrop-blur-sm shadow-card">
      {steps.map((s, i) => (
        <div key={i} className={clsx(
          "flex-1 py-3 text-center text-xs font-semibold border-r border-ink-100 last:border-r-0 transition-colors",
          i + 1 < step ? "bg-emerald-50 text-emerald-700" :
          i + 1 === step ? "text-white" :
          "text-ink-400"
        )}
        style={i + 1 === step ? { background: "linear-gradient(135deg, #283A68, #17223E)" } : undefined}>
          <span className="block text-[10px] opacity-60 mb-0.5 font-medium">{String(i + 1).padStart(2, "0")}</span>
          {s}
        </div>
      ))}
    </div>
  );
}
