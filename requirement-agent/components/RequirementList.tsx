"use client";
import { useQuery } from "@tanstack/react-query";
import { api, Requirement } from "@/lib/api";
import { StatusBadge } from "./ScoreComponents";
import { Loader2, Search, FileSearch } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";

export default function RequirementList({
  selectedId, onSelect, filterStatus: controlledFilterStatus, onFilterStatusChange,
}: {
  selectedId?: string; onSelect: (id: string) => void;
  filterStatus?: string; onFilterStatusChange?: (status: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [localFilterStatus, setLocalFilterStatus] = useState("");
  const filterStatus = controlledFilterStatus !== undefined ? controlledFilterStatus : localFilterStatus;
  const setFilterStatus = (s: string) => {
    setLocalFilterStatus(s);
    onFilterStatusChange?.(s);
  };

  const { data, isLoading } = useQuery<Requirement[]>({
    queryKey: ["requirements", filterStatus],
    queryFn: () => api.listRequirements({ status: filterStatus || undefined, limit: 100 }),
    // Poll every 3s when any item is still validating, otherwise every 15s
    refetchInterval: (query) => {
      const data = query.state.data as any[];
      if (Array.isArray(data) && data.some((r: any) => r.status === "validating")) return 3000;
      return 15000;
    },
  });

  const filtered = data?.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.module?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2 border-b border-ink-100">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"/>
          <input className="input pl-8 text-xs" placeholder="Search requirements..."
            value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select className="input text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="validated">Validated</option>
          <option value="review_needed">Review needed</option>
          <option value="rejected">Rejected</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <div className="overflow-y-auto flex-1">
        {isLoading && (
          <div className="p-4 flex items-center justify-center gap-2 text-ink-400">
            <Loader2 size={14} className="animate-spin"/> Loading...
          </div>
        )}
        {filtered?.length === 0 && !isLoading && (
          <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
              <FileSearch size={18} className="text-brand-400"/>
            </div>
            <p className="text-xs text-ink-400">No requirements yet</p>
          </div>
        )}
        {filtered?.map(r => (
          <button key={r.id}
            onClick={() => onSelect(r.id)}
            className={clsx(
              "w-full text-left px-4 py-3 border-b border-ink-100 hover:bg-brand-50/60 transition-colors relative",
              selectedId === r.id ? "bg-brand-50" : ""
            )}>
            {selectedId === r.id && (
              <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
                style={{ background: "linear-gradient(180deg, #6D5AE6, #5840D6)" }}/>
            )}
            <p className="text-xs font-semibold text-ink-700 truncate mb-1">{r.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {r.module && <span className="text-[10px] text-ink-400">{r.module.split(" ")[0]}</span>}
              <StatusBadge status={r.status} />
              {r.score_total > 0 && (
                <span className="text-[10px] font-bold text-brand-600">{r.score_total}/50</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
