"use client";
import { clsx } from "clsx";

export function StatusBadge({ status }: { status: string }) {
  const styleMap: Record<string, string> = {
    generated:     "badge bg-ink-100 text-ink-600 border border-ink-200",
    approved:      "badge-validated",
    rejected:      "badge bg-amber-50 text-amber-700 border border-amber-200",
    under_review:  "badge bg-amber-50 text-amber-700 border border-amber-200",
    pushed_to_jira: "badge bg-accent-50 text-accent-600 border border-accent-100",
  };
  const labelMap: Record<string, string> = {
    rejected: "needs review",
    under_review: "under review",
  };
  const label = labelMap[status] || status.replace(/_/g, " ");
  return <span className={styleMap[status] || "badge-draft"}>{label}</span>;
}

// Badge styling for all 5 test case categories:
// positive, negative, boundary, error_handling, integration
const TC_CATEGORY_STYLES: Record<string, string> = {
  positive:       "badge bg-emerald-50 text-emerald-700 border border-emerald-200",
  negative:       "badge bg-rose-50 text-rose-700 border border-rose-200",
  boundary:       "badge bg-amber-50 text-amber-700 border border-amber-200",
  error_handling: "badge bg-violet-50 text-violet-700 border border-violet-200",
  integration:    "badge bg-accent-50 text-accent-600 border border-accent-100",
};

export function TCCategoryBadge({ category }: { category: string }) {
  const key = (category || "positive").toLowerCase();
  const cls = TC_CATEGORY_STYLES[key] || "badge-draft";
  return <span className={cls}>{key.replace(/_/g, " ")}</span>;
}

// 3-step pipeline — this agent's scope starts at the user story input.
// Requirement scoring/validation happens in the separate Requirement Validation Agent.
export function PipelineBar({ step }: { step: number }) {
  const steps = ["User story input", "Generate test cases", "Review & push"];
  return (
    <div className="flex rounded-2xl overflow-hidden border border-ink-200 mb-6 bg-white/60 backdrop-blur-sm shadow-card">
      {steps.map((s, i) => (
        <div key={i} className={clsx(
          "flex-1 py-3 text-center text-xs font-semibold border-r border-ink-100 last:border-r-0 transition-colors",
          i + 1 < step ? "bg-emerald-50 text-emerald-700" :
          i + 1 === step ? "text-white" :
          "text-ink-400"
        )}
        style={i + 1 === step ? { background: "linear-gradient(135deg, #16AECF, #5840D6)" } : undefined}>
          <span className="block text-[10px] opacity-60 mb-0.5 font-medium">{String(i + 1).padStart(2, "0")}</span>
          {s}
        </div>
      ))}
    </div>
  );
}
