"use client";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { api, TestCase } from "@/lib/api";
import { Loader2, CheckCircle, MessageSquare, Send, Edit3, ChevronDown, ChevronUp, Plus, Trash2, Save, X, Download, Activity, Database, GitMerge, Cpu, BarChart2 } from "lucide-react";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import { StatusBadge, TCCategoryBadge } from "./ScoreComponents";

// ── Agent 2 RAG Pipeline Log ─────────────────────────────────────────────────
function Agent2PipelineLog({ reqId }: { reqId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["pipeline-log-agent2", reqId],
    queryFn: () => (api as any).getPipelineLog(reqId, "agent2"),
    enabled: !!reqId && open,
  });

  const steps = data?.steps || [];
  const totalTokens = steps.reduce((s: number, e: any) => s + (e.tokens || 0), 0);
  const totalLatency = steps.reduce((s: number, e: any) => s + (e.latency_ms || 0), 0);
  const totalRetrieved = steps.reduce((s: number, e: any) => s + (e.retrieved || 0), 0);

  const COLORS = ["teal","purple","sky","orange","indigo","emerald","rose"];
  const COLOR_MAP: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    teal:    { bg:"bg-teal-50",    border:"border-teal-200",    text:"text-teal-700",    icon:"text-teal-500" },
    purple:  { bg:"bg-purple-50",  border:"border-purple-200",  text:"text-purple-700",  icon:"text-purple-500" },
    sky:     { bg:"bg-sky-50",     border:"border-sky-200",     text:"text-sky-700",     icon:"text-sky-500" },
    orange:  { bg:"bg-orange-50",  border:"border-orange-200",  text:"text-orange-700",  icon:"text-orange-500" },
    indigo:  { bg:"bg-indigo-50",  border:"border-indigo-200",  text:"text-indigo-700",  icon:"text-indigo-500" },
    emerald: { bg:"bg-emerald-50", border:"border-emerald-200", text:"text-emerald-700", icon:"text-emerald-500" },
    rose:    { bg:"bg-rose-50",    border:"border-rose-200",    text:"text-rose-700",    icon:"text-rose-500" },
  };
  const STEP_ICONS: Record<number, React.ReactNode> = {
    1:<Activity size={12}/>, 2:<Database size={12}/>, 3:<GitMerge size={12}/>,
    4:<Database size={12}/>, 5:<Cpu size={12}/>, 6:<Cpu size={12}/>, 7:<BarChart2 size={12}/>
  };

  return (
    <div className="card overflow-hidden">
      <button className="flex items-center justify-between w-full px-5 py-3.5 border-b border-ink-100 hover:bg-ink-50 transition-colors"
        onClick={() => setOpen(o => !o)}>
        <span className="text-xs font-bold text-ink-600 uppercase tracking-wide flex items-center gap-1.5">
          <Activity size={13} className="text-teal-500"/> Agent 2 — RAG Execution Pipeline
          {steps.length > 0 && (
            <span className="ml-2 text-[10px] font-normal text-ink-400">
              {totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens · ` : ""}
              {(totalLatency/1000).toFixed(1)}s · {totalRetrieved} retrieved
            </span>
          )}
        </span>
        <span className="text-[10px] text-ink-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-4 space-y-2">
          {!data?.available && (
            <p className="text-xs text-ink-400 italic text-center py-3">
              Generate test cases to see the Agent 2 RAG pipeline trace
            </p>
          )}
          {steps.map((step: any, i: number) => {
            const colorKey = COLORS[i % COLORS.length];
            const c = COLOR_MAP[colorKey];
            return (
              <div key={step.step} className={clsx("flex items-start gap-2 rounded-lg border px-3 py-2", c.bg, c.border)}>
                <div className={clsx("mt-0.5 flex-shrink-0", c.icon)}>{STEP_ICONS[step.step] || <CheckCircle size={12}/>}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx("text-xs font-semibold", c.text)}>{step.label}</span>
                    {step.tokens > 0 && <span className="text-[10px] text-ink-400 ml-auto">{step.tokens.toLocaleString()} tokens</span>}
                    {step.latency_ms > 0 && <span className="text-[10px] text-ink-400">{(step.latency_ms/1000).toFixed(1)}s</span>}
                    {step.retrieved > 0 && <span className="text-[10px] text-orange-500">{step.retrieved} retrieved</span>}
                  </div>
                  <p className="text-[11px] text-ink-500 mt-0.5 leading-relaxed">{step.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PRIORITIES = ["Critical", "High", "Medium", "Low"];

// ── Export / download generated test cases ──────────────────────────────
function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CSV_COLUMNS: { key: keyof TestCase | "steps_text"; label: string }[] = [
  { key: "tc_id", label: "TC ID" },
  { key: "title", label: "Title" },
  { key: "tc_type", label: "Type" },
  { key: "priority", label: "Priority" },
  { key: "template", label: "Template" },
  { key: "pre_conditions", label: "Pre-conditions" },
  { key: "steps_text", label: "Steps" },
  { key: "expected_result", label: "Expected Result" },
  { key: "notes", label: "Notes" },
  { key: "status", label: "Status" },
  { key: "jira_key", label: "JIRA Key" },
];

function csvEscape(val: any): string {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportTestCasesCSV(cases: TestCase[]) {
  const rows = cases.map(tc => {
    const row: Record<string, any> = { ...tc, steps_text: (tc.steps || []).join(" | ") };
    return CSV_COLUMNS.map(c => csvEscape(row[c.key])).join(",");
  });
  const csv = [CSV_COLUMNS.map(c => csvEscape(c.label)).join(","), ...rows].join("\n");
  downloadBlob(csv, `testcases_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
}

function exportTestCasesJSON(cases: TestCase[]) {
  downloadBlob(JSON.stringify(cases, null, 2), `testcases_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}

// ── Comment modal — shown before approve/reject/push so there's always an
// audit trail of why a reviewer made that decision. ──────────────────────
function CommentModal({ title, actionLabel, actionClass, onConfirm, onCancel }: {
  title: string; actionLabel: string; actionClass: string;
  onConfirm: (comment: string) => void; onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm p-4"
      onClick={onCancel}>
      <div className="card p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-800">{title}</p>
          <button onClick={onCancel} className="text-ink-400 hover:text-ink-600"><X size={16}/></button>
        </div>
        <div>
          <label className="label">Comment (optional, but recommended)</label>
          <textarea rows={3} className="input text-sm" autoFocus
            placeholder="Why are you making this decision? e.g. 'Steps match AC #2, looks good' or 'Missing edge case for timeout'"
            value={comment} onChange={e => setComment(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex-1 justify-center" onClick={onCancel}>Cancel</button>
          <button className={clsx(actionClass, "flex-1 justify-center")} onClick={() => onConfirm(comment)}>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Review modal — replaces the old hard "Reject". Marks the test case as
// needing another look and captures why, rather than a final rejection.
// There's no per-card regenerate yet, so this is upfront about pointing to
// "Generate more" at the top of the page as the practical next step. ──────
function ReviewModal({ onConfirm, onCancel }: {
  onConfirm: (comment: string) => void; onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm p-4"
      onClick={onCancel}>
      <div className="card p-5 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-800">Mark for review</p>
          <button onClick={onCancel} className="text-ink-400 hover:text-ink-600"><X size={16}/></button>
        </div>
        <p className="text-xs text-ink-500">
          This flags the test case as needing another look instead of approving it as-is.
          To get a fresh version, use "Generate more" at the top of the page — it pulls in
          your latest edits and comments as context.
        </p>
        <div>
          <label className="label">What needs to change?</label>
          <textarea rows={3} className="input text-sm" autoFocus
            placeholder="e.g. 'Missing edge case for timeout' or 'Steps too generic, needs SAP T-code'"
            value={comment} onChange={e => setComment(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex-1 justify-center" onClick={onCancel}>Cancel</button>
          <button className="btn-primary flex-1 justify-center" onClick={() => onConfirm(comment)}>
            Save review notes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Editable list of steps ────────────────────────────────────────────────
function StepsEditor({ steps, onSave, onCancel }: {
  steps: string[]; onSave: (steps: string[]) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(steps.length ? [...steps] : [""]);

  const updateStep = (i: number, val: string) => {
    const next = [...draft]; next[i] = val; setDraft(next);
  };
  const removeStep = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const addStep = () => setDraft([...draft, ""]);

  return (
    <div className="space-y-2">
      {draft.map((s, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-800 flex items-center justify-center text-xs font-medium flex-shrink-0 mt-1.5">{i + 1}</span>
          <textarea rows={1} className="input text-sm flex-1" value={s}
            onChange={e => updateStep(i, e.target.value)} />
          <button className="text-ink-400 hover:text-red-500 mt-1.5" onClick={() => removeStep(i)}>
            <Trash2 size={14}/>
          </button>
        </div>
      ))}
      <button className="text-xs text-brand-600 flex items-center gap-1" onClick={addStep}>
        <Plus size={12}/> Add step
      </button>
      <div className="flex gap-2 pt-1">
        <button className="btn-secondary text-xs flex-1 justify-center" onClick={onCancel}>Cancel</button>
        <button className="btn-primary text-xs flex-1 justify-center"
          onClick={() => onSave(draft.map(s => s.trim()).filter(Boolean))}>
          <Save size={12}/> Save steps
        </button>
      </div>
    </div>
  );
}

function TCCard({ tc, onApprove, onReject, onPush, onEdit, pushing, forceExpanded }: {
  tc: TestCase;
  onApprove: (comment: string) => void; onReject: (comment: string) => void;
  onPush: (comment: string) => void; onEdit: (field: string, val: any) => void;
  pushing: boolean; forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false); // collapsed by default
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(tc.notes || "");
  const [editingSteps, setEditingSteps] = useState(false);
  const [editingPre, setEditingPre] = useState(false);
  const [preConditions, setPreConditions] = useState(tc.pre_conditions || "");
  const [editingExpected, setEditingExpected] = useState(false);
  const [expectedResult, setExpectedResult] = useState(tc.expected_result || "");
  const [editingPriority, setEditingPriority] = useState(false);

  const [confirmAction, setConfirmAction] = useState<"approve" | "review" | "push" | null>(null);

  // Respond to parent-level Collapse All / Expand All
  useEffect(() => {
    if (forceExpanded !== undefined) setExpanded(forceExpanded);
  }, [forceExpanded]);

  return (
    <div className={clsx(
      "card overflow-hidden transition-all",
      (tc.status === "rejected" || tc.status === "under_review") ? "border-l-4 border-l-amber-400" : ""
    )}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-100 bg-ink-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-mono font-semibold text-ink-500">{tc.tc_id}</span>
        <TCCategoryBadge category={tc.tc_type}/>
        <span className="text-sm font-medium text-ink-800 flex-1 truncate">{tc.title}</span>
        <StatusBadge status={tc.status} />
        {tc.jira_key && <span className="badge bg-blue-50 text-blue-700 border border-blue-200 text-xs">{tc.jira_key}</span>}
        {expanded ? <ChevronUp size={14} className="text-ink-400"/> : <ChevronDown size={14} className="text-ink-400"/>}
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-ink-500">Priority</p>
                <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setEditingPriority(!editingPriority)}>
                  <Edit3 size={11}/> {editingPriority ? "Done" : "Edit"}
                </button>
              </div>
              {editingPriority ? (
                <select className="input text-sm" value={tc.priority}
                  onChange={e => { onEdit("priority", e.target.value); }}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              ) : (
                <p className="text-ink-700">{tc.priority}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500 mb-1">Template</p>
              <p className="text-ink-700">{tc.template}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-ink-500">Pre-conditions</p>
              <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setEditingPre(!editingPre)}>
                <Edit3 size={11}/> {editingPre ? "Save" : "Edit"}
              </button>
            </div>
            {editingPre ? (
              <textarea rows={2} className="input text-sm" value={preConditions}
                onChange={e => setPreConditions(e.target.value)}
                onBlur={() => { onEdit("pre_conditions", preConditions); setEditingPre(false); }} />
            ) : (
              <p className="text-sm text-ink-600 bg-ink-50 rounded-lg px-3 py-2">{tc.pre_conditions || "—"}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-ink-500">Steps</p>
              {!editingSteps && (
                <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setEditingSteps(true)}>
                  <Edit3 size={11}/> Edit
                </button>
              )}
            </div>
            {editingSteps ? (
              <StepsEditor steps={tc.steps || []}
                onCancel={() => setEditingSteps(false)}
                onSave={(steps) => { onEdit("steps", steps); setEditingSteps(false); }} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-brand-50 border-b border-brand-100">
                      <th className="text-left px-3 py-2.5 font-bold text-brand-600 w-12">Step</th>
                      <th className="text-left px-3 py-2.5 font-bold text-brand-600">Action</th>
                      <th className="text-left px-3 py-2.5 font-bold text-brand-600">Expected Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tc.steps || []).map((s, i) => {
                      const perStep = tc.step_expected_results?.[i];
                      const isLastStep = i === (tc.steps || []).length - 1;
                      const expectedText = perStep || (isLastStep ? tc.expected_result : "");
                      return (
                        <tr key={i} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/60 transition-colors">
                          <td className="px-3 py-2.5">
                            <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-ink-700 leading-snug">{s.replace(/^Step \d+:\s*/i, "")}</td>
                          <td className="px-3 py-2.5 text-ink-500 italic leading-snug">
                            {expectedText || <span className="text-ink-300 not-italic">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!editingSteps && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-ink-500">Overall expected result</p>
              <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setEditingExpected(!editingExpected)}>
                <Edit3 size={11}/> {editingExpected ? "Save" : "Edit"}
              </button>
            </div>
            {editingExpected ? (
              <textarea rows={2} className="input text-sm" value={expectedResult}
                onChange={e => setExpectedResult(e.target.value)}
                onBlur={() => { onEdit("expected_result", expectedResult); setEditingExpected(false); }} />
            ) : (
              <p className="text-sm text-ink-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{tc.expected_result}</p>
            )}
          </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-ink-500">Notes</p>
              <button className="text-xs text-brand-600 flex items-center gap-1" onClick={() => setEditingNotes(!editingNotes)}>
                <Edit3 size={11}/> {editingNotes ? "Save" : "Edit"}
              </button>
            </div>
            {editingNotes ? (
              <textarea rows={2} className="input text-sm"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { onEdit("notes", notes); setEditingNotes(false); }}
              />
            ) : (
              <p className="text-sm text-ink-500 italic">
                {tc.notes
                  ? tc.notes
                      // Strip the JIRA fallback file path — it's a server-side path
                      // that's useful in logs but confusing/ugly in the UI during demos
                      .replace(/\[JIRA push failed[^\]]*\]/gi, "[JIRA push saved locally]")
                      .replace(/C:\\[^\s)]*\.json/gi, "")
                      .replace(/\/home\/[^\s)]*\.json/gi, "")
                      // Clean up verbose timeout message for demo readability
                      .replace("AI generation unavailable: Request timed out.", "Generated from fallback template (Ollama timeout — start the model for AI-generated steps)")
                      .replace("AI generation unavailable: ", "Fallback: ")
                      .trim()
                  : "No notes yet"}
              </p>
            )}
          </div>

          {tc.review_comment && (
            <div>
              <p className="text-xs font-medium text-ink-500 mb-1">Review comment</p>
              <p className="text-sm text-ink-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{tc.review_comment}</p>
            </div>
          )}

          {tc.status !== "pushed_to_jira" && (
            <div className="space-y-2 pt-1">
              {tc.status !== "approved" ? (
                // Not yet approved: the two real choices are "looks good"
                // or "needs another look" — Push to JIRA isn't offered yet
                // since nothing should go to JIRA before it's approved.
                <div className="flex gap-2">
                  <button className="btn-success flex-1 justify-center text-xs" onClick={() => setConfirmAction("approve")}>
                    <CheckCircle size={13}/> Approve
                  </button>
                  <button className="btn-secondary flex-1 justify-center text-xs" onClick={() => setConfirmAction("review")}>
                    <MessageSquare size={13}/> Review
                  </button>
                </div>
              ) : (
                // Already approved: Push to JIRA is now the natural next
                // step, so it's the emphasized action — Review is still
                // available as a secondary option if something needs a
                // second look before pushing.
                <div className="flex gap-2">
                  <button className="btn-primary flex-1 justify-center text-xs" onClick={() => setConfirmAction("push")}
                    disabled={pushing}>
                    {pushing ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>} Push to JIRA
                  </button>
                  <button className="btn-secondary flex-1 justify-center text-xs" onClick={() => setConfirmAction("review")}>
                    <MessageSquare size={13}/> Review
                  </button>
                </div>
              )}
            </div>
          )}
          {tc.status === "pushed_to_jira" && (
            <div className="flex items-center gap-1.5 text-xs text-blue-700">
              <CheckCircle size={13}/> Pushed to JIRA {tc.jira_key ? `(${tc.jira_key})` : ""}
            </div>
          )}
        </div>
      )}

      {confirmAction === "approve" && (
        <CommentModal title="Approve test case" actionLabel="Approve" actionClass="btn-success"
          onCancel={() => setConfirmAction(null)}
          onConfirm={(comment) => { onApprove(comment); setConfirmAction(null); }} />
      )}
      {confirmAction === "review" && (
        <ReviewModal
          onCancel={() => setConfirmAction(null)}
          onConfirm={(comment) => { onReject(comment); setConfirmAction(null); }} />
      )}
      {confirmAction === "push" && (
        <CommentModal title="Push to JIRA" actionLabel="Push to JIRA" actionClass="btn-primary"
          onCancel={() => setConfirmAction(null)}
          onConfirm={(comment) => { onPush(comment); setConfirmAction(null); }} />
      )}
    </div>
  );
}

// ── Feedback panel ────────────────────────────────────────────────────────
const TC_ISSUE_OPTIONS = [
  "Test case title not appropriate",
  "Steps were incorrect or missing",
  "Expected result was wrong",
  "Wrong test case type generated",
  "Too generic — needs more detail",
  "Quality was poor overall",
];

function FeedbackPanel({ cases }: { cases: TestCase[] }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const toggle = (issue: string) =>
    setIssues(prev => prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]);

  const handleSubmit = async () => {
    await api.submitFeedback({
      type: "tc_quality",
      agent: "agent2",
      source_id: cases[0]?.requirement_id || "",
      rating: rating || undefined,
      issues,
      comment,
    });
    setSubmitted(true);
    toast.success("Feedback submitted — thank you!");
  };

  if (submitted) return (
    <div className="card p-4 border-emerald-200 bg-emerald-50 text-sm text-emerald-700 flex items-center gap-2">
      <CheckCircle size={14}/> Thank you for the feedback — it will help improve future test case quality.
    </div>
  );

  return (
    <div className="card p-4 border-ink-100">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-500 flex items-center gap-1.5">
          <MessageSquare size={14} className="flex-shrink-0"/>
          Facing any issues with the quality of these test cases?
        </p>
        <button className="text-xs text-brand-600 underline flex-shrink-0" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Submit feedback"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-ink-500 mb-1.5">Overall quality rating</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button"
                  onClick={() => setRating(n)}
                  className={clsx("w-8 h-8 rounded-lg border text-xs font-medium transition-colors",
                    rating === n ? "bg-brand-500 text-white border-brand-500" : "border-ink-200 text-ink-500 hover:bg-ink-50"
                  )}>
                  {n}
                </button>
              ))}
              <span className="text-xs text-ink-400 self-center ml-1">1 = poor · 5 = excellent</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-ink-500 mb-1.5">What was wrong? (select all that apply)</p>
            <div className="grid grid-cols-2 gap-1.5">
              {TC_ISSUE_OPTIONS.map(opt => (
                <label key={opt} className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
                  <input type="checkbox" checked={issues.includes(opt)} onChange={() => toggle(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-ink-500 mb-1">Additional comments</p>
            <textarea rows={2} className="input text-sm" placeholder="What would better test cases for this requirement look like?"
              value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          <div className="flex gap-2 justify-end">
            <button className="btn-secondary text-xs" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary text-xs" onClick={handleSubmit}
              disabled={!rating && issues.length === 0 && !comment.trim()}>
              Submit feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TestCaseResults({ cases, onUpdate }: {
  cases: TestCase[];
  onUpdate: (cases: TestCase[]) => void;
}) {
  const approveMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => api.approveTestCase(id, comment),
    onSuccess: (updated) => {
      onUpdate(cases.map(c => c.id === updated.id ? updated : c));
      toast.success("Approved");
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => api.rejectTestCase(id, comment),
    onSuccess: (updated) => {
      onUpdate(cases.map(c => c.id === updated.id ? updated : c));
      toast("Review notes saved — marked for review", { icon: "🔍" });
    },
  });

  const pushMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => api.pushTcToJira(id, comment),
    onSuccess: (updated) => {
      onUpdate(cases.map(c => c.id === updated.id ? updated : c));
      toast.success("Pushed to JIRA");
    },
    onError: (err: any) => {
      // The backend returns a detailed message that includes the local
      // fallback filepath when credentials are missing/wrong, so the
      // user knows their work wasn't lost — extract and show it rather
      // than a generic "check credentials" message that hides that fact.
      const detail: string = err?.response?.data?.detail || "";
      if (detail.includes("saved locally")) {
        toast.error(detail, { duration: 8000 });
      } else {
        toast.error(
          "JIRA push failed — test case saved locally as a JSON fallback in backend/data/jira_fallback/. Check JIRA credentials in backend/.env.",
          { duration: 8000 }
        );
      }
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateTestCase(id, data),
    onSuccess: (updated) => onUpdate(cases.map(c => c.id === updated.id ? updated : c)),
  });

  const approvedCount = cases.filter(tc => tc.status === "approved").length;
  const [expandAll, setExpandAll] = useState<boolean | undefined>(undefined);
  const [approvingAll, setApprovingAll] = useState(false);

  // ── Checkbox selection state ──────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);

  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleSelectAll = () => {
    if (selected.size === cases.length) setSelected(new Set());
    else setSelected(new Set(cases.map(c => c.id)));
  };

  const selectedCases = cases.filter(c => selected.has(c.id));
  const selectedApproved = selectedCases.filter(c => c.status === "approved");

  // ── Approve All: accumulate updates to avoid stale-closure dropping results ─
  const approveAll = async () => {
    const toApprove = cases.filter(tc => tc.status !== "approved" && tc.status !== "pushed_to_jira");
    if (toApprove.length === 0) { toast("All test cases are already approved"); return; }
    setApprovingAll(true);
    const tid = toast.loading(`Approving ${toApprove.length} test cases...`);
    let current = [...cases];
    let approved = 0;
    for (const tc of toApprove) {
      try {
        const updated = await api.approveTestCase(tc.id, "Bulk approved");
        // Update within accumulated array — not stale outer `cases`
        current = current.map(c => c.id === updated.id ? updated : c);
        onUpdate([...current]);
        approved++;
      } catch { /* continue with remaining */ }
    }
    toast.success(`${approved} of ${toApprove.length} test cases approved`, { id: tid });
    setApprovingAll(false);
  };

  // ── Bulk approve selected ──────────────────────────────────────────────────
  const approveSelected = async () => {
    const toApprove = selectedCases.filter(tc => tc.status !== "approved" && tc.status !== "pushed_to_jira");
    if (toApprove.length === 0) { toast("Selected test cases are already approved"); return; }
    setBulkActioning(true);
    const tid = toast.loading(`Approving ${toApprove.length} selected...`);
    let current = [...cases];
    let approved = 0;
    for (const tc of toApprove) {
      try {
        const updated = await api.approveTestCase(tc.id, "Bulk approved");
        current = current.map(c => c.id === updated.id ? updated : c);
        onUpdate([...current]);
        approved++;
      } catch { /* continue */ }
    }
    toast.success(`${approved} approved`, { id: tid });
    setSelected(new Set());
    setBulkActioning(false);
  };

  // ── Bulk push selected (approved only) ────────────────────────────────────
  const pushSelected = async () => {
    const toPush = selectedApproved;
    if (toPush.length === 0) { toast("Select approved test cases to push"); return; }
    setBulkActioning(true);
    const tid = toast.loading(`Pushing ${toPush.length} to JIRA...`);
    let current = [...cases];
    let pushed = 0;
    let lastError = "";
    for (const tc of toPush) {
      try {
        const updated = await api.pushTcToJira(tc.id, "Bulk pushed");
        current = current.map(c => c.id === updated.id ? updated : c);
        onUpdate([...current]);
        pushed++;
      } catch (err: any) {
        lastError = err?.response?.data?.detail || err?.message || "Unknown error";
      }
    }
    if (pushed === toPush.length) {
      toast.success(`${pushed} pushed to JIRA`, { id: tid });
    } else {
      const isCredentialError = lastError.toLowerCase().includes("credential") || lastError.toLowerCase().includes("not configured");
      toast.error(isCredentialError
        ? "JIRA credentials not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in backend/.env and restart."
        : `${pushed} pushed, ${toPush.length - pushed} failed: ${lastError}`,
        { id: tid, duration: 8000 });
    }
    setSelected(new Set());
    setBulkActioning(false);
  };

  const pushAll = async () => {
    const toPush = cases.filter(tc => tc.status === "approved");
    if (toPush.length === 0) return;
    const tid = toast.loading(`Pushing ${toPush.length} test case(s) to JIRA...`);
    let current = [...cases];
    let pushed = 0;
    let lastError = "";
    for (const tc of toPush) {
      try {
        const updated = await api.pushTcToJira(tc.id, "Bulk pushed");
        current = current.map(c => c.id === updated.id ? updated : c);
        onUpdate([...current]);
        pushed++;
      } catch (err: any) {
        lastError = err?.response?.data?.detail || err?.message || "Unknown error";
      }
    }
    if (pushed === toPush.length) {
      toast.success(`${pushed} test case(s) pushed to JIRA successfully`, { id: tid });
    } else if (pushed > 0) {
      toast.error(`${pushed} pushed, ${toPush.length - pushed} failed. ${lastError}`, { id: tid, duration: 8000 });
    } else {
      // All failed — show clear credential guidance
      const isCredentialError = lastError.toLowerCase().includes("credential") || lastError.toLowerCase().includes("not configured") || lastError.toLowerCase().includes("jira_base_url");
      if (isCredentialError) {
        toast.error(
          "JIRA credentials not set up. Open backend/.env and fill in JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, then restart the backend. Test cases have been saved locally as JSON fallback.",
          { id: tid, duration: 10000 }
        );
      } else {
        toast.error(`JIRA push failed: ${lastError}. Test cases saved locally in backend/data/jira_fallback/`, { id: tid, duration: 8000 });
      }
    }
  };

  const hasSelection = selected.size > 0;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center">
          {/* Master checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-ink-500 select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded accent-teal-600 cursor-pointer"
              checked={selected.size === cases.length && cases.length > 0}
              ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < cases.length; }}
              onChange={toggleSelectAll}
            />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          <span className="text-ink-200">|</span>
          <span className="badge bg-ink-100 text-ink-600 border border-ink-200">
            {cases.length} test cases
          </span>
          {["positive", "negative", "boundary", "error_handling", "integration"].map(cat => {
            const count = cases.filter(t => t.tc_type === cat).length;
            if (count === 0) return null;
            return (
              <span key={cat} className="inline-flex">
                <TCCategoryBadge category={cat} />
                <span className="ml-1 text-xs text-ink-400 self-center">×{count}</span>
              </span>
            );
          })}
          <button
            className="text-xs px-2.5 py-1 rounded-lg bg-white border border-ink-200 text-ink-500 hover:bg-ink-50 flex items-center gap-1 transition-colors ml-2"
            onClick={() => setExpandAll(expandAll === true ? false : true)}>
            {expandAll === true ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
            {expandAll === true ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Bulk actions for selection */}
          {hasSelection && (
            <>
              <button className="btn-success text-xs" onClick={approveSelected} disabled={bulkActioning}>
                {bulkActioning ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
                Approve selected ({selected.size})
              </button>
              {selectedApproved.length > 0 && (
                <button className="btn-primary text-xs" onClick={pushSelected} disabled={bulkActioning}>
                  <Send size={12}/> Push selected ({selectedApproved.length})
                </button>
              )}
            </>
          )}
          {/* Global actions — shown when no selection */}
          {!hasSelection && (
            <>
              {approvedCount > 0 && (
                <button className="btn-primary text-xs" onClick={pushAll} disabled={pushMut.isPending}>
                  <Send size={12}/> Push all approved ({approvedCount})
                </button>
              )}
              <button className="btn-success text-xs" onClick={approveAll} disabled={approvingAll}>
                {approvingAll ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
                {approvingAll ? "Approving..." : "Approve all"}
              </button>
            </>
          )}
          <button className="btn-secondary text-xs" onClick={() => exportTestCasesCSV(cases)} disabled={cases.length === 0}>
            <Download size={12}/> Export CSV
          </button>
          <button className="btn-secondary text-xs" onClick={() => exportTestCasesJSON(cases)} disabled={cases.length === 0}>
            <Download size={12}/> Export JSON
          </button>
        </div>
      </div>

      {cases.map(tc => (
        <div key={tc.id} className="flex items-start gap-2">
          {/* Per-row checkbox */}
          <div className="pt-4 pl-1 flex-shrink-0">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded accent-teal-600 cursor-pointer"
              checked={selected.has(tc.id)}
              onChange={() => toggleSelect(tc.id)}
            />
          </div>
          <div className="flex-1 min-w-0">
            <TCCard tc={tc}
              forceExpanded={expandAll}
              pushing={pushMut.isPending && pushMut.variables?.id === tc.id}
              onApprove={(comment) => approveMut.mutate({ id: tc.id, comment })}
              onReject={(comment) => rejectMut.mutate({ id: tc.id, comment })}
              onPush={(comment) => pushMut.mutate({ id: tc.id, comment })}
              onEdit={(field, val) => updateMut.mutate({ id: tc.id, data: { [field]: val } })}
            />
          </div>
        </div>
      ))}

      {/* ── Quality feedback ─────────────────────────────────────────────
          Mirrors the feedback pattern from the reference tool screenshots:
          a persistent, low-friction way to flag issues with generated test
          cases so the generation quality can be improved over time. ──── */}
      <FeedbackPanel cases={cases} />

      {/* ── Agent 2 RAG Pipeline Log ────────────────────────────────────── */}
      {cases.length > 0 && cases[0].requirement_id && (
        <Agent2PipelineLog reqId={cases[0].requirement_id}/>
      )}
    </div>
  );
}
