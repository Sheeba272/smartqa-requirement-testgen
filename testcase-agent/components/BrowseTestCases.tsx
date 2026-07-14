"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, TestCase } from "@/lib/api";
import { Loader2, Filter } from "lucide-react";
import TestCaseResults from "./TestCaseResults";

const STATUS_FILTERS = [
  { key: "", label: "All statuses" },
  { key: "generated", label: "Generated" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "pushed_to_jira", label: "Pushed to JIRA" },
];

export default function BrowseTestCases({ initialStatusFilter }: { initialStatusFilter?: string }) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "");
  const [cases, setCases] = useState<TestCase[] | null>(null);

  const { data, isLoading, refetch } = useQuery<TestCase[]>({
    queryKey: ["all-testcases", statusFilter],
    queryFn: () => api.listAllTestCases({ status: statusFilter || undefined, limit: 200 }),
  });

  const displayCases = cases ?? data ?? [];

  return (
    <div className="space-y-4">
      <div className="card p-3 flex items-center gap-2">
        <Filter size={14} className="text-ink-400 flex-shrink-0"/>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.key}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                statusFilter === f.key
                  ? "bg-brand-50 text-brand-700 border-brand-200"
                  : "bg-white text-ink-500 border-ink-200 hover:bg-ink-50"
              }`}
              onClick={() => { setStatusFilter(f.key); setCases(null); }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="card p-8 flex items-center justify-center gap-2 text-ink-400">
          <Loader2 size={18} className="animate-spin"/> Loading test cases...
        </div>
      )}

      {!isLoading && displayCases.length === 0 && (
        <div className="card p-8 text-center text-sm text-ink-400">
          No test cases found{statusFilter ? ` with status "${statusFilter}"` : ""}.
        </div>
      )}

      {!isLoading && displayCases.length > 0 && (
        <TestCaseResults cases={displayCases} onUpdate={(updated) => { setCases(updated); refetch(); }} />
      )}
    </div>
  );
}
