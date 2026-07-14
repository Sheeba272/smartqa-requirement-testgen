"use client";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { api, RequirementCreate } from "@/lib/api";
import { useDropzone } from "react-dropzone";
import toast from "react-hot-toast";
import {
  Upload, Link, FileText, Settings2, Loader2, FileSpreadsheet, BookOpen,
  ClipboardPaste, FileType, CheckCircle2, ArrowRight, AlertTriangle
} from "lucide-react";
import { clsx } from "clsx";

const MODULES = [
  "Procurement (SAP MM)", "Finance (SAP FI)", "Authentication",
  "Inventory (SAP MM)", "Sales & Distribution", "Production Planning",
  "HR / Payroll", "Reporting & BI", "Integration / Middleware", "Cutover & Migration",
  "Others",
];
const TEMPLATES = ["Detailed steps", "BDD (Given-When-Then)", "Mind-map style", "Risk-based", "Exploratory charter"];
const TC_TYPES = ["Positive + Negative", "Positive only", "Negative only", "Positive + Negative + Edge"];
const PRIORITIES = ["P1 - Critical", "P2 - High", "P3 - Medium", "P4 - Low"];

// Input source modes — matches "Inputs: JIRA user story link / Paste / BRD Word doc /
// Confluence page / Other sources" plus bulk CSV upload for multi-requirement intake.
type Mode = "paste" | "jira" | "doc" | "confluence" | "other" | "bulk";

const MODE_TABS: { key: Mode; label: string; icon: JSX.Element }[] = [
  { key: "paste",      label: "Paste story",   icon: <ClipboardPaste size={13}/> },
  { key: "jira",       label: "JIRA link",      icon: <Link size={13}/> },
  { key: "doc",        label: "BRD / Word doc", icon: <FileType size={13}/> },
  { key: "confluence", label: "Confluence",     icon: <BookOpen size={13}/> },
  { key: "other",      label: "Other source",   icon: <FileText size={13}/> },
  { key: "bulk",       label: "Bulk CSV",       icon: <FileSpreadsheet size={13}/> },
];

export default function RequirementForm({ onCreated, onGoToKnowledgeBase }: {
  onCreated: (id: string) => void;
  onGoToKnowledgeBase?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("paste");
  const [jiraUrl, setJiraUrl] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [otherText, setOtherText] = useState("");
  const [otherTitle, setOtherTitle] = useState("");
  const [fetching, setFetching] = useState(false);
  // Tracks whether the current form content was just pulled in from JIRA/
  // Confluence/Other, so we can show a confirmation banner instead of
  // silently jumping the user to a different tab.
  const [loadedFrom, setLoadedFrom] = useState<string>("");
  const [jiraAutoSplit, setJiraAutoSplit] = useState(false);
  const [confluenceFetched, setConfluenceFetched] = useState<string[]>([]);
  const [confluenceFetchErrors, setConfluenceFetchErrors] = useState<{url: string; error: string}[]>([]);
  const [customModule, setCustomModule] = useState("");
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<RequirementCreate>({
    defaultValues: { source_type: "paste", tc_template: "Detailed steps", tc_type: "Positive + Negative", priority: "P3 - Medium" }
  });

  const watchedTitle = watch("title");
  const watchedStory = watch("story_body");
  const watchedModule = watch("module");
  // When user picks "Others", sync the custom text input back into form state
  useEffect(() => {
    if (watchedModule === "Others" && customModule.trim()) {
      setValue("module", customModule.trim());
    }
  }, [customModule, watchedModule, setValue]);

  // Check Ollama/model availability up front so a missing model surfaces
  // immediately instead of after a long stalled validation request.
  const { data: ollamaStatus } = useQuery({
    queryKey: ["ollama-status"],
    queryFn: api.getOllamaStatus,
    retry: false,
    refetchInterval: 30000,
  });
  const modelMissing = ollamaStatus?.ollama_running && !ollamaStatus.chat_model_pulled;
  const ollamaDown = ollamaStatus && !ollamaStatus.ollama_running;

  const createMut = useMutation({
    mutationFn: api.createRequirement,
    onSuccess: (data) => {
      toast.success("Requirement saved. Running Agent 1...");
      qc.invalidateQueries({ queryKey: ["requirements"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated(data.id);
      reset();
      setLoadedFrom("");
    },
    onError: () => toast.error("Failed to create requirement"),
  });

  // ── Bulk CSV/Excel dropzone ──────────────────────────────────────────────
  const [bulkUploaded, setBulkUploaded] = useState<{ id: string; title: string }[]>([]);
  const [bulkValidating, setBulkValidating] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ validated: number; errors: { requirement_id: string; error: string }[] } | null>(null);

  const bulkDropzone = useDropzone({
    accept: { "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    maxFiles: 1,
    onDrop: async (files) => {
      if (!files[0]) return;
      const tid = toast.loading("Uploading bulk requirements...");
      try {
        const reqs = await api.bulkUpload(files[0]);
        toast.success(`${reqs.length} requirements uploaded`, { id: tid });
        qc.invalidateQueries({ queryKey: ["requirements"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        setBulkUploaded(reqs.map(r => ({ id: r.id, title: r.title })));
        setBulkResult(null);
      } catch { toast.error("Upload failed", { id: tid }); }
    }
  });

  const validateAllUploaded = async () => {
    if (bulkUploaded.length === 0) return;
    setBulkValidating(true);
    const tid = toast.loading(`Validating ${bulkUploaded.length} requirements...`);
    try {
      const result = await api.bulkValidate(bulkUploaded.map(r => r.id));
      setBulkResult({ validated: result.validated.length, errors: result.errors });
      qc.invalidateQueries({ queryKey: ["requirements"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (result.errors.length === 0) {
        toast.success(`All ${result.validated.length} validated`, { id: tid });
      } else {
        toast.error(`${result.validated.length} validated, ${result.errors.length} failed`, { id: tid });
      }
    } catch {
      toast.error("Bulk validation failed", { id: tid });
    } finally {
      setBulkValidating(false);
    }
  };

  // ── BRD / Word doc dropzone — indexes into Knowledge Base, prefills title ─
  const docDropzone = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/pdf": [".pdf"],
      "text/plain": [".txt", ".md"],
    },
    maxFiles: 1,
    onDrop: async (files) => {
      if (!files[0]) return;
      const tid = toast.loading("Reading document...");
      try {
        const doc = await api.uploadKnowledge(files[0]);
        if (doc.status === "indexed") {
          toast.success(
            `"${doc.filename}" indexed (${doc.chunk_count} chunks). Now paste the user story below.`,
            { id: tid, duration: 5000 }
          );
          setValue("title", doc.filename.replace(/\.(docx|pdf|txt|md)$/i, ""));
          setMode("paste");
        } else {
          toast.error(doc.error || "Could not extract text from this file", { id: tid });
        }
      } catch {
        toast.error("Upload failed", { id: tid });
      }
    }
  });

  const fetchJira = async () => {
    if (!jiraUrl.trim()) { toast.error("Enter a JIRA URL"); return; }
    setFetching(true);
    setJiraAutoSplit(false);
    setConfluenceFetched([]);
    setConfluenceFetchErrors([]);
    try {
      const data = await api.fetchFromJira({ story_url: jiraUrl });
      setValue("title", data.title || "");
      setValue("story_body", data.story_body || "");
      setValue("acceptance_criteria", data.acceptance_criteria || "");
      setValue("pre_conditions", data.pre_conditions || "");
      setValue("module", data.module || "");
      setValue("priority", data.priority || "P3 - Medium");
      setValue("source_ref", data.issue_key || "");
      setValue("source_type", "jira");
      setLoadedFrom(`JIRA ${data.issue_key || ""}`);
      // The backend only fills pre_conditions when it auto-split a combined
      // AS/WANT/SO THAT/GIVEN/WHEN/THEN block (real ticket had no separate
      // AC field) — surface that so the user knows to double-check the split.
      setJiraAutoSplit(!!data.pre_conditions);
      setConfluenceFetched(data.confluence_pages_fetched || []);
      setConfluenceFetchErrors(data.confluence_fetch_errors || []);
      toast.success(`Loaded ${data.issue_key}`);
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Could not fetch JIRA story — check backend JIRA_BASE_URL/EMAIL/API_TOKEN in .env, or switch to Paste story instead"); }
    finally { setFetching(false); }
  };

  const fetchConfluence = async () => {
    if (!confluenceUrl.trim()) { toast.error("Enter a Confluence page URL"); return; }
    setFetching(true);
    try {
      const data = await api.fetchFromConfluence({ page_url: confluenceUrl });
      setValue("title", data.title || "");
      setValue("story_body", data.story_body || "");
      setValue("module", data.module || "");
      setValue("source_ref", data.source_ref || "");
      setValue("source_type", "confluence");
      setLoadedFrom(`Confluence — ${data.title || "page"}`);
      toast.success(`Loaded "${data.title}"`);
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Could not fetch Confluence page — check backend credentials, or switch to Paste story instead"); }
    finally { setFetching(false); }
  };

  const useOtherSource = async () => {
    if (!otherText.trim()) { toast.error("Paste some text first"); return; }
    setFetching(true);
    try {
      const data = await api.fromOtherSource({ text: otherText, title: otherTitle, as_knowledge: false });
      setValue("title", data.title || otherTitle || "");
      setValue("story_body", data.story_body || "");
      setValue("acceptance_criteria", data.acceptance_criteria || "");
      setValue("edge_cases", data.edge_cases || "");
      setValue("pre_conditions", data.pre_conditions || "");
      setValue("module", data.module || "");
      setLoadedFrom("Other source");
      const fieldsFound = [data.acceptance_criteria, data.edge_cases, data.pre_conditions].filter(Boolean).length;
      toast.success(fieldsFound > 0 ? `Content parsed into ${fieldsFound + 1} fields — review below` : "Loaded — review the fields below");
    } catch {
      toast.error("Could not process text");
    } finally { setFetching(false); }
  };

  const onSubmit = (data: RequirementCreate) => {
    createMut.mutate({ ...data, source_type: data.source_type || mode });
  };

  // The editable story form — shown beneath EVERY input tab (except bulk),
  // so fetched JIRA/Confluence/Other content appears immediately in place
  // instead of silently switching to a different tab.
  const storyForm = (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {loadedFrom && (watchedTitle || watchedStory) && (
        <div className="card p-3 border-emerald-200 bg-emerald-50 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0"/>
          <p className="text-sm text-emerald-800">
            Loaded from <strong>{loadedFrom}</strong> — review and edit below before validating.
          </p>
        </div>
      )}

      {jiraAutoSplit && (
        <div className="card p-3 border-blue-200 bg-blue-50 flex items-start gap-2 animate-fade-in">
          <AlertTriangle size={16} className="text-blue-600 flex-shrink-0 mt-0.5"/>
          <p className="text-sm text-blue-800">
            <strong>Auto-split from a combined format.</strong> This ticket had no separate
            "Acceptance Criteria" field — the description used a single AS/I WANT/SO THAT/
            GIVEN/WHEN/THEN block instead. We split it into Story body, Pre-conditions, and
            Acceptance criteria as a best-effort guess — please review each field below
            carefully, since the split may not be perfect.
          </p>
        </div>
      )}

      {(confluenceFetched.length > 0 || confluenceFetchErrors.length > 0) && (
        <div className="card p-3 border-ink-200 bg-ink-50 flex items-start gap-2 animate-fade-in">
          <Link size={16} className="text-ink-500 flex-shrink-0 mt-0.5"/>
          <div className="text-sm text-ink-700">
            {confluenceFetched.length > 0 && (
              <p>
                <strong>{confluenceFetched.length} linked Confluence page{confluenceFetched.length > 1 ? "s" : ""}</strong>{" "}
                found in this ticket's description {confluenceFetched.length > 1 ? "were" : "was"} fetched automatically
                and appended to the story body below.
              </p>
            )}
            {confluenceFetchErrors.length > 0 && (
              <div className={confluenceFetched.length > 0 ? "mt-1.5" : ""}>
                <p className="text-amber-700">
                  <strong>{confluenceFetchErrors.length} linked Confluence page{confluenceFetchErrors.length > 1 ? "s" : ""}</strong>{" "}
                  could not be fetched automatically:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {confluenceFetchErrors.map((err, i) => (
                    <li key={i} className="text-xs text-amber-600">
                      {err.url.includes("CONFLUENCE") || err.error.includes("Confluence credentials") ? (
                        <>Confluence credentials not configured — set <code className="bg-amber-100 px-1 rounded">CONFLUENCE_BASE_URL</code>, <code className="bg-amber-100 px-1 rounded">CONFLUENCE_EMAIL</code>, <code className="bg-amber-100 px-1 rounded">CONFLUENCE_API_TOKEN</code> in <code className="bg-amber-100 px-1 rounded">backend/.env</code> to fetch this automatically next time. You can open the link manually: <a href={err.url} target="_blank" rel="noopener noreferrer" className="underline">{err.url}</a></>
                      ) : (
                        <>{err.url} — {err.error}</>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide flex items-center gap-1.5">
          <FileText size={13}/> Story details
        </p>
        <div>
          <label className="label">Story title *</label>
          <input className="input" placeholder="e.g. ME23N purchase order display"
            {...register("title", { required: "Title is required" })} />
          {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Module</label>
            <select className="input" {...register("module")}
              onChange={e => {
                setValue("module", e.target.value);
                if (e.target.value !== "Others") setCustomModule("");
              }}>
              <option value="">Select module</option>
              {MODULES.map(m => <option key={m}>{m}</option>)}
            </select>
            {watchedModule === "Others" && (
              <input
                className="input mt-2"
                placeholder="Enter custom module name..."
                value={customModule}
                onChange={e => {
                  setCustomModule(e.target.value);
                  setValue("module", e.target.value || "Others");
                }}
              />
            )}
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" {...register("priority")}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">User story body (As a / I want / So that)</label>
          <textarea rows={4} className="input" placeholder="As a procurement officer, I want to display purchase orders via ME23N, so that I can review PO details for approval or audit purposes."
            {...register("story_body")} />
        </div>
        <div>
          <label className="label">Acceptance criteria</label>
          <textarea rows={4} className="input" placeholder={"1. System displays PO header and all line items\n2. All fields are read-only — no edit possible\n3. User can navigate to related GR documents\n4. Performance: screen loads in < 3 seconds"}
            {...register("acceptance_criteria")} />
        </div>
        <div>
          <label className="label">Edge cases / negative scenarios</label>
          <textarea rows={2} className="input" placeholder="Invalid PO number, PO from different company code, user without MM display authorisation"
            {...register("edge_cases")} />
        </div>
        <div>
          <label className="label">Pre-conditions</label>
          <textarea rows={2} className="input" placeholder="User has MM display authorisation (role SAP_MM_DISPLAY). Valid PO numbers exist in the system."
            {...register("pre_conditions")} />
        </div>
      </div>

      <button type="submit" disabled={createMut.isPending} className="btn-primary w-full justify-center py-3">
        {createMut.isPending
          ? <><Loader2 size={15} className="animate-spin"/> Saving...</>
          : <>Run Agent 1 — Validate requirement →</>}
      </button>
    </form>
  );

  return (
    <div className="space-y-4">
      {ollamaDown && (
        <div className="card p-3 border-red-200 bg-red-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5"/>
          <div className="text-sm text-red-900">
            <p><strong>Ollama is not running.</strong> Start it by running <code className="bg-red-100 px-1 rounded">ollama serve</code> in a terminal, then refresh.</p>
          </div>
        </div>
      )}
      {!ollamaDown && ollamaStatus && ollamaStatus.error && (
        <div className="card p-3 border-amber-200 bg-amber-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5"/>
          <div className="text-sm text-amber-900 space-y-1">
            <p><strong>Model setup needed.</strong> Run these commands in a terminal, then restart the backend:</p>
            {ollamaStatus.error.split(" | ").map((cmd: string, i: number) => (
              <p key={i}><code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{cmd}</code></p>
            ))}
            {ollamaStatus.available_models?.length > 0 && (
              <p className="text-xs text-amber-700">Currently installed: <strong>{ollamaStatus.available_models.join(", ")}</strong></p>
            )}
          </div>
        </div>
      )}
      {!ollamaDown && ollamaStatus && !ollamaStatus.error && ollamaStatus.agent1_model && (
        <div className="card p-2.5 border-emerald-200 bg-emerald-50 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"/>
          <p className="text-xs text-emerald-700">
            <strong>Agent 1:</strong> {ollamaStatus.agent1_model}
            {ollamaStatus.agent2_model && ollamaStatus.agent2_model !== ollamaStatus.agent1_model && (
              <> &nbsp;·&nbsp; <strong>Agent 2:</strong> {ollamaStatus.agent2_model}</>
            )}
          </p>
        </div>
      )}
      {/* ── Source picker ──────────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">
          Where is this requirement coming from?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MODE_TABS.map(({ key, label, icon }) => {
            const descriptions: Record<string, string> = {
              paste: "Type or paste directly",
              jira: "Fetch from JIRA URL",
              doc: "Upload BRD/Word doc",
              confluence: "Pull from Confluence",
              other: "Paste any text source",
              bulk: "Upload CSV/Excel file",
            };
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key as Mode)}
                className={clsx(
                  "flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                  mode === key
                    ? "border-brand-400 bg-brand-50 shadow-sm"
                    : "border-ink-200 bg-white hover:border-brand-200 hover:bg-brand-50/30"
                )}
              >
                <span className={clsx("flex items-center gap-1.5 text-xs font-semibold", mode === key ? "text-brand-700" : "text-ink-600")}>
                  {icon} {label}
                </span>
                <span className="text-[10px] text-ink-400 leading-tight">{descriptions[key] || ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "jira" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">Enter your JIRA story URL — fetched details appear in the form below this box</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="https://your-org.atlassian.net/browse/PROJ-1234"
              value={jiraUrl} onChange={e => setJiraUrl(e.target.value)} />
            <button className="btn-primary" onClick={fetchJira} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <Link size={14}/>} Fetch
            </button>
          </div>
          <p className="text-xs text-ink-400">
            Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in backend .env — if not configured,
            just type the story directly into the fields below instead.
          </p>
        </div>
      )}

      {mode === "confluence" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">Enter a Confluence page URL — its content pre-fills the form below this box</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="https://your-org.atlassian.net/wiki/spaces/SPACE/pages/123456789/Title"
              value={confluenceUrl} onChange={e => setConfluenceUrl(e.target.value)} />
            <button className="btn-primary" onClick={fetchConfluence} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <BookOpen size={14}/>} Fetch
            </button>
          </div>
          <p className="text-xs text-ink-400">Confluence Cloud shares Atlassian auth with JIRA (same email + API token)</p>
        </div>
      )}

      {mode === "doc" && (
        <div className="space-y-3">
          <div {...docDropzone.getRootProps()} className={clsx(
            "card p-8 flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed transition-colors text-center",
            docDropzone.isDragActive ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-300"
          )}>
            <input {...docDropzone.getInputProps()} />
            <FileType size={24} className="text-ink-400" />
            <p className="text-sm font-medium text-ink-600">Drop a BRD / Word (.docx) / PDF here</p>
            <p className="text-xs text-ink-400 max-w-md">
              The document is indexed as contextual knowledge for Agent 1's RAG. After upload,
              you'll be switched to "Paste story" — type the specific user story you want
              validated, and Agent 1 will use this document as supporting context.
            </p>
          </div>
          {onGoToKnowledgeBase && (
            <button type="button" onClick={onGoToKnowledgeBase}
              className="w-full card p-3 flex items-center justify-between text-left hover:border-brand-300 transition-colors group">
              <span className="text-xs text-ink-500">
                Want to manage, view, or delete uploaded documents? Use the dedicated <strong>Knowledge base</strong> page.
              </span>
              <ArrowRight size={14} className="text-brand-500 flex-shrink-0 group-hover:translate-x-0.5 transition-transform"/>
            </button>
          )}
        </div>
      )}

      {mode === "other" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">
            Paste content from any other source (email thread, design doc, raw notes).
            This pre-fills the form below this box — review and edit before validating.
          </p>
          <input className="input" placeholder="Title (optional)"
            value={otherTitle} onChange={e => setOtherTitle(e.target.value)} />
          <textarea rows={5} className="input" placeholder="Paste raw text here..."
            value={otherText} onChange={e => setOtherText(e.target.value)} />
          <button className="btn-primary" onClick={useOtherSource} disabled={fetching}>
            {fetching ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Use this text
          </button>
        </div>
      )}

      {mode === "bulk" && (
        <div className="space-y-3">
          <div {...bulkDropzone.getRootProps()} className={clsx(
            "card p-8 flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed transition-colors text-center",
            bulkDropzone.isDragActive ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-300"
          )}>
            <input {...bulkDropzone.getInputProps()} />
            <Upload size={24} className="text-ink-400" />
            <p className="text-sm font-medium text-ink-600">Drop CSV or Excel file here</p>
            <p className="text-xs text-ink-400">Columns: title, module, story_body, acceptance_criteria, edge_cases, priority</p>
          </div>

          {bulkUploaded.length > 0 && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-700">{bulkUploaded.length} requirements uploaded</p>
                <button className="btn-primary text-xs" onClick={validateAllUploaded} disabled={bulkValidating}>
                  {bulkValidating ? <Loader2 size={13} className="animate-spin"/> : <CheckCircle2 size={13}/>}
                  {bulkValidating ? "Validating..." : "Validate all"}
                </button>
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {bulkUploaded.map(r => (
                  <li key={r.id} className="text-xs text-ink-500 truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-ink-300 flex-shrink-0"/>{r.title}
                  </li>
                ))}
              </ul>
              {bulkResult && (
                <div className="pt-2 border-t border-ink-100 text-xs space-y-1">
                  <p className="text-emerald-700">{bulkResult.validated} validated successfully</p>
                  {bulkResult.errors.map((e, i) => (
                    <p key={i} className="text-amber-700">{e.requirement_id}: {e.error}</p>
                  ))}
                  {bulkResult.errors.length === 0 && (
                    <p className="text-ink-500">Open the sidebar or dashboard to review scores, or head to the Test Case Agent to generate test cases for all of them at once.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Story form shown under every tab except bulk (which is self-contained) and doc
          (which switches to paste automatically after a successful upload) */}
      {mode !== "bulk" && mode !== "doc" && storyForm}
    </div>
  );
}
