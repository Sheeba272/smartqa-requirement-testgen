"use client";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, DirectTCGenerateRequestV2, TestCase, TCCategory, Complexity, TCTemplate } from "@/lib/api";
import toast from "react-hot-toast";
import {
  FileText, Link2, Settings2, Loader2, Sparkles, ArrowRight,
  ClipboardPaste, BookOpen, FileType, CheckCircle2, AlertTriangle, FileSpreadsheet, Upload
} from "lucide-react";
import { clsx } from "clsx";

const MODULES = [
  "Procurement (SAP MM)", "Finance (SAP FI)", "Authentication",
  "Inventory (SAP MM)", "Sales & Distribution", "Production Planning",
  "HR / Payroll", "Reporting & BI", "Integration / Middleware", "Cutover & Migration",
];
const PRIORITIES = ["P1 - Critical", "P2 - High", "P3 - Medium", "P4 - Low"];

const TC_CATEGORY_OPTIONS: { key: TCCategory; label: string; hint: string }[] = [
  { key: "positive",       label: "Positive",       hint: "Happy path & valid boundaries" },
  { key: "negative",       label: "Negative",       hint: "Invalid input, missing data" },
  { key: "boundary",       label: "Boundary",       hint: "Min/max limits, off-by-one" },
  { key: "error_handling", label: "Error Handling", hint: "System/network errors" },
  { key: "integration",    label: "Integration",    hint: "Cross-module effects" },
];

const COMPLEXITY_OPTIONS: { key: Complexity; label: string; hint: string }[] = [
  { key: "simple",   label: "Simple",   hint: "3-4 high-level steps" },
  { key: "medium",   label: "Medium",   hint: "4-6 steps, specific values" },
  { key: "detailed", label: "Detailed", hint: "6-10 granular steps, full data" },
];

const TEMPLATE_OPTIONS: TCTemplate[] = [
  "Detailed Test Case", "BDD Format", "Organization Template", "Zephyr Template",
];

type Mode = "paste" | "jira" | "doc" | "confluence" | "other" | "reqid" | "bulk" | "bulkcsv";

const MODE_TABS: { key: Mode; label: string; icon: JSX.Element }[] = [
  { key: "paste",      label: "Paste story",        icon: <ClipboardPaste size={13}/> },
  { key: "jira",       label: "JIRA link",           icon: <Link2 size={13}/> },
  { key: "doc",        label: "BRD / Word doc",      icon: <FileType size={13}/> },
  { key: "confluence", label: "Confluence",          icon: <BookOpen size={13}/> },
  { key: "other",      label: "Other source",        icon: <FileText size={13}/> },
  { key: "reqid",      label: "From Agent 1 ID",     icon: <ArrowRight size={13}/> },
  { key: "bulk",       label: "Bulk from Agent 1",   icon: <FileSpreadsheet size={13}/> },
  { key: "bulkcsv",    label: "Bulk CSV / Excel",    icon: <Upload size={13}/> },
];

type FormValues = {
  title: string;
  module?: string;
  priority?: string;
  story_body?: string;
  acceptance_criteria?: string;
  edge_cases?: string;
};

// ── Bulk CSV / Excel upload panel for testcase agent ─────────────────────────
function BulkCsvUploadPanel({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ count: number; titles: string[] } | null>(null);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("http://localhost:8000/api/requirements/bulk-upload", {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || "Upload failed");
      }
      const reqs: any[] = await resp.json();
      setResult({ count: reqs.length, titles: reqs.slice(0, 5).map(r => r.title) });
      if (reqs.length > 0) onDone();
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <p className="text-xs text-ink-500">
        Upload a CSV or Excel file of requirements. Supported columns:{" "}
        <code className="bg-ink-100 px-1 rounded">Requirement_ID / title</code>,{" "}
        <code className="bg-ink-100 px-1 rounded">Module</code>,{" "}
        <code className="bg-ink-100 px-1 rounded">User_Story / story_body</code>,{" "}
        <code className="bg-ink-100 px-1 rounded">Acceptance_Criteria</code>,{" "}
        <code className="bg-ink-100 px-1 rounded">Edge_Cases</code>,{" "}
        <code className="bg-ink-100 px-1 rounded">Priority</code>
      </p>
      <label
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${dragging ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-300"}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
        {uploading ? <Loader2 size={22} className="animate-spin text-brand-400"/> : <Upload size={22} className="text-ink-400"/>}
        <p className="text-sm text-ink-500">{uploading ? "Uploading..." : "Drop CSV or Excel file here"}</p>
        <p className="text-xs text-ink-400">or click to browse</p>
        <input type="file" className="hidden" accept=".csv,.xlsx,.xls"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }}/>
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {result && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1">
          <p className="font-bold">{result.count} requirement{result.count !== 1 ? "s" : ""} uploaded successfully</p>
          {result.titles.map((t, i) => <p key={i} className="text-emerald-600">• {t}</p>)}
          {result.count > 5 && <p className="text-emerald-500">…and {result.count - 5} more</p>}
          <p className="text-emerald-600 mt-1">Switch to "Bulk from Agent 1" to generate test cases for all of them.</p>
        </div>
      )}
    </div>
  );
}

export default function StoryInputForm({ onGenerated }: { onGenerated: (reqId: string, cases: TestCase[]) => void }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [reqIdInput, setReqIdInput] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [otherText, setOtherText] = useState("");
  const [otherTitle, setOtherTitle] = useState("");
  const [fetching, setFetching] = useState(false);
  const [loadingFromReq, setLoadingFromReq] = useState(false);
  // Tracks where the current form content came from, so we can show a
  // confirmation banner instead of silently switching tabs.
  const [loadedFrom, setLoadedFrom] = useState<string>("");

  // ── Generation options state ─────────────────────────────────────────────
  const [tcTypes, setTcTypes] = useState<TCCategory[]>(["positive", "negative"]);
  const [complexity, setComplexity] = useState<Complexity>("medium");
  const [template, setTemplate] = useState<TCTemplate>("Detailed Test Case");
  const [namingConvention, setNamingConvention] = useState("TC_Module_001");

  // ── Bulk generate (from Agent 1's validated requirements) ────────────────
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkGenResult, setBulkGenResult] = useState<{ count: number; errors: { requirement_id: string; error: string }[] } | null>(null);

  const { data: validatedReqs, isLoading: loadingValidated } = useQuery({
    queryKey: ["requirements-for-bulk-tc"],
    queryFn: () => api.listRequirements({ status: "validated", limit: 100 }),
    enabled: mode === "bulk",
  });

  const toggleBulkSelected = (id: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const generateForSelected = async () => {
    if (bulkSelected.size === 0) return;
    setBulkGenerating(true);
    setBulkGenResult(null);
    const tid = toast.loading(`Generating test cases for ${bulkSelected.size} requirements...`);
    try {
      const result = await api.bulkGenerateTestCases(Array.from(bulkSelected), {
        tc_types: tcTypes, complexity, template, naming_convention: namingConvention,
      });
      setBulkGenResult({ count: result.testcases.length, errors: result.errors });
      if (result.errors.length === 0) {
        toast.success(`${result.testcases.length} test cases generated`, { id: tid });
      } else {
        toast.error(`${result.testcases.length} generated, ${result.errors.length} failed`, { id: tid });
      }
      if (result.testcases.length > 0) onGenerated(result.testcases[0]?.requirement_id || "", result.testcases);
    } catch {
      toast.error("Bulk generation failed", { id: tid });
    } finally {
      setBulkGenerating(false);
    }
  };

  const { register, handleSubmit, setValue, watch, reset } = useForm<FormValues>({
    defaultValues: {}
  });

  const watchedTitle = watch("title");
  const watchedStory = watch("story_body");

  // Check Ollama/model availability up front so a missing model surfaces
  // immediately instead of after a long stalled generation request.
  const { data: ollamaStatus } = useQuery({
    queryKey: ["ollama-status"],
    queryFn: api.getOllamaStatus,
    retry: false,
    refetchInterval: 30000,
  });
  const isAnthropic = ollamaStatus?.provider === "anthropic";
  const modelMissing = !isAnthropic && ollamaStatus?.ollama_running && !ollamaStatus.chat_model_pulled;
  const ollamaDown = !isAnthropic && ollamaStatus && !ollamaStatus.ollama_running;
  const anthropicMissingKey = isAnthropic && ollamaStatus && !ollamaStatus.configured;

  const generateMut = useMutation({
    mutationFn: api.generateDirectV2,
    onSuccess: (cases) => {
      toast.success(`${cases.length} test cases generated`);
      onGenerated(cases[0]?.requirement_id || "", cases);
      reset();
      setLoadedFrom("");
    },
    onError: (e: any) => {
      if (e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "")) {
        const modelName = ollamaStatus?.agent2_model || ollamaStatus?.model || "the configured model";
        toast.error(
          `${modelName} did not respond within the timeout window. This usually means Ollama is busy, ` +
          `the model isn't loaded yet (first call after a restart can take longer while it loads into memory), ` +
          `or the machine is under heavy load. ` +
          "Test cases have been generated using the structured fallback — check the results below. " +
          "If you see 'AI model unavailable' in the Notes field, that confirms fallback was used.",
          { duration: 8000 }
        );
      } else if (!e?.response) {
        toast.error("Could not reach the backend at :8001 — make sure run_backend.bat is running.");
      } else {
        toast.error(e?.response?.data?.detail || "Generation failed — check the backend terminal for details.");
      }
    },
  });

  const toggleTcType = (key: TCCategory) => {
    setTcTypes(prev => prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]);
  };

  const onSubmit = (data: FormValues) => {
    if (!data.title?.trim() && !data.story_body?.trim()) {
      toast.error("Enter at least a title or story body");
      return;
    }
    if (tcTypes.length === 0) {
      toast.error("Select at least one test case type");
      return;
    }
    const payload: DirectTCGenerateRequestV2 = {
      ...data,
      options: {
        tc_types: tcTypes,
        complexity,
        template,
        naming_convention: namingConvention || "TC_Module_001",
      },
    };
    generateMut.mutate(payload);
  };

  // ── Input source handlers — mirror the Requirement Agent ─────────────────
  const fetchJira = async () => {
    if (!jiraUrl.trim()) { toast.error("Enter a JIRA URL"); return; }
    setFetching(true);
    try {
      const data = await api.fetchFromJira({ story_url: jiraUrl });
      setValue("title", data.title || "");
      setValue("story_body", data.story_body || "");
      setValue("acceptance_criteria", data.acceptance_criteria || "");
      setValue("module", data.module || "");
      setValue("priority", data.priority || "P3 - Medium");
      setLoadedFrom(`JIRA ${data.issue_key || ""}`);
      toast.success(`Loaded ${data.issue_key}`);
    } catch (e: any) { toast.error(e?.response?.data?.detail || "Could not fetch JIRA story — check backend credentials, or switch to Paste story instead"); }
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
      setValue("module", data.module || "");
      setLoadedFrom("Other source");
      toast.success("Loaded — scroll down to review");
    } catch {
      toast.error("Could not process text");
    } finally { setFetching(false); }
  };

  const handleFromReqId = async () => {
    const id = reqIdInput.trim();
    if (!id) { toast.error("Paste a requirement ID"); return; }
    setLoadingFromReq(true);
    try {
      const req = await api.getRequirement(id);
      if (req.status === "rejected") {
        toast.error("This requirement was rejected by Agent 1 — fix it there first");
        return;
      }
      setValue("title", req.title || "");
      setValue("story_body", req.story_body || "");
      setValue("acceptance_criteria", req.acceptance_criteria || "");
      setValue("edge_cases", req.edge_cases || "");
      setValue("module", req.module || "");
      setLoadedFrom(`Agent 1 — ${req.req_id}`);
      toast.success(`Loaded ${req.req_id} — review below and generate`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Could not find that requirement ID");
    } finally {
      setLoadingFromReq(false);
    }
  };

  return (
    <div className="space-y-4">
      {anthropicMissingKey && (
        <div className="card p-3 border-red-200 bg-red-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5"/>
          <p className="text-sm text-red-900">
            <strong>Anthropic API key not set.</strong> Open <code className="bg-red-100 px-1 rounded">backend/.env</code> and set <code className="bg-red-100 px-1 rounded">ANTHROPIC_API_KEY</code>.
          </p>
        </div>
      )}
      {ollamaDown && (
        <div className="card p-3 border-red-200 bg-red-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5"/>
          <p className="text-sm text-red-900"><strong>Ollama is not running.</strong> Run <code className="bg-red-100 px-1 rounded">ollama serve</code> in a terminal.</p>
        </div>
      )}
      {!ollamaDown && ollamaStatus && ollamaStatus.error && (
        <div className="card p-3 border-amber-200 bg-amber-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5"/>
          <div className="text-sm text-amber-900 space-y-1">
            <p><strong>Model setup needed:</strong></p>
            {ollamaStatus.error.split(" | ").map((cmd: string, i: number) => (
              <p key={i}><code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">{cmd}</code></p>
            ))}
            {(ollamaStatus.available_models?.length ?? 0) > 0 && (
              <p className="text-xs text-amber-700">Installed: <strong>{ollamaStatus.available_models?.join(", ")}</strong></p>
            )}
          </div>
        </div>
      )}
      {!ollamaDown && ollamaStatus && !ollamaStatus.error && ollamaStatus.agent2_model && (
        <div className="card p-2.5 border-emerald-200 bg-emerald-50 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"/>
          <p className="text-xs text-emerald-700"><strong>Agent 2:</strong> {ollamaStatus.agent2_model} · Test case generation ready</p>
        </div>
      )}
      {ollamaStatus && !ollamaStatus.jira_configured && (
        <div className="card p-3 border-blue-200 bg-blue-50 flex items-start gap-2">
          <AlertTriangle size={16} className="text-blue-500 flex-shrink-0 mt-0.5"/>
          <p className="text-sm text-blue-900">
            <strong>JIRA not configured.</strong> You can generate and approve test cases,
            but "Push to JIRA" will save locally instead of pushing.
            To enable: open <code className="bg-blue-100 px-1 py-0.5 rounded">backend/.env</code> and
            set <code className="bg-blue-100 px-1 py-0.5 rounded">JIRA_BASE_URL</code>,{" "}
            <code className="bg-blue-100 px-1 py-0.5 rounded">JIRA_EMAIL</code>, and{" "}
            <code className="bg-blue-100 px-1 py-0.5 rounded">JIRA_API_TOKEN</code>, then restart the backend.
          </p>
        </div>
      )}
      <div>
        <label className="label">How are you adding this story?</label>
        <select
          className="input"
          value={mode}
          onChange={e => setMode(e.target.value as Mode)}
        >
          {MODE_TABS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {mode === "reqid" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">
            In the <strong>Requirement Validation Agent</strong> (port 3002), validate a requirement,
            then click <strong>"Copy ID"</strong> on it. Paste that ID here and click Load — the
            story, acceptance criteria, and edge cases will appear in the form below this box.
          </p>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-xs" placeholder="e.g. 7e4c9f12-3a8b-4d21-9f6e-..."
              value={reqIdInput} onChange={e => setReqIdInput(e.target.value)} />
            <button className="btn-primary" onClick={handleFromReqId} disabled={loadingFromReq}>
              {loadingFromReq ? <Loader2 size={14} className="animate-spin"/> : <ArrowRight size={14}/>}
              Load
            </button>
          </div>
        </div>
      )}

      {mode === "bulk" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">
            Generate test cases for every <strong>validated</strong> requirement from the Requirement
            Validation Agent at once, using the test case type / complexity / template settings below.
          </p>

          {loadingValidated && (
            <div className="flex items-center gap-2 text-xs text-ink-400 py-4 justify-center">
              <Loader2 size={14} className="animate-spin"/> Loading validated requirements...
            </div>
          )}

          {!loadingValidated && (!validatedReqs || validatedReqs.length === 0) && (
            <p className="text-xs text-ink-400 py-4 text-center">
              No validated requirements yet — validate some in the Requirement Validation Agent first.
            </p>
          )}

          {!loadingValidated && validatedReqs && validatedReqs.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <button type="button" className="text-xs text-brand-600 underline"
                  onClick={() => setBulkSelected(new Set(validatedReqs.map(r => r.id)))}>
                  Select all ({validatedReqs.length})
                </button>
                {bulkSelected.size > 0 && (
                  <button type="button" className="text-xs text-ink-400 underline"
                    onClick={() => setBulkSelected(new Set())}>
                    Clear selection
                  </button>
                )}
              </div>
              <ul className="space-y-1 max-h-52 overflow-y-auto border border-ink-100 rounded-lg p-2">
                {validatedReqs.map(r => (
                  <li key={r.id}>
                    <label className="flex items-center gap-2 text-xs text-ink-600 py-1 cursor-pointer hover:bg-ink-50 rounded px-1">
                      <input type="checkbox" checked={bulkSelected.has(r.id)}
                        onChange={() => toggleBulkSelected(r.id)} />
                      <span className="truncate">{r.title}</span>
                      {r.module && <span className="text-ink-400 flex-shrink-0">— {r.module}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <button className="btn-primary w-full justify-center text-xs" onClick={generateForSelected}
                disabled={bulkSelected.size === 0 || bulkGenerating}>
                {bulkGenerating ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
                {bulkGenerating ? "Generating..." : `Generate for ${bulkSelected.size || ""} selected`}
              </button>
              {bulkGenResult && (
                <div className="pt-2 border-t border-ink-100 text-xs space-y-1">
                  <p className="text-emerald-700">{bulkGenResult.count} test cases generated</p>
                  {bulkGenResult.errors.map((e, i) => (
                    <p key={i} className="text-amber-700">{e.requirement_id}: {e.error}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === "bulkcsv" && (
        <BulkCsvUploadPanel onDone={() => setMode("bulk")}/>
      )}

      {mode === "jira" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">Enter your JIRA story URL to pre-fill the form below</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="https://your-org.atlassian.net/browse/PROJ-1234"
              value={jiraUrl} onChange={e => setJiraUrl(e.target.value)} />
            <button className="btn-primary" onClick={fetchJira} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <Link2 size={14}/>} Fetch
            </button>
          </div>
        </div>
      )}

      {mode === "confluence" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">Enter a Confluence page URL to pre-fill the form below</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="https://your-org.atlassian.net/wiki/spaces/SPACE/pages/123456789/Title"
              value={confluenceUrl} onChange={e => setConfluenceUrl(e.target.value)} />
            <button className="btn-primary" onClick={fetchConfluence} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <BookOpen size={14}/>} Fetch
            </button>
          </div>
        </div>
      )}

      {mode === "doc" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">
            BRD/Word/PDF documents are managed in the <strong>Requirement Validation Agent's
            Knowledge Base page</strong> — they're indexed there and become available as shared
            RAG context for both agents (same backend, same database).
          </p>
          <a href="http://localhost:3001" target="_blank" rel="noopener noreferrer"
            className="btn-primary inline-flex w-fit">
            Open Requirement Validation Agent (port 3002) <ArrowRight size={14}/>
          </a>
          <p className="text-xs text-ink-400">
            Once there: use the <strong>"Knowledge base"</strong> button in its top navigation bar
            (next to Dashboard). After uploading, come back here and paste the specific user story
            text into the form below — Agent 2 will use the uploaded document as supporting context
            automatically.
          </p>
        </div>
      )}

      {mode === "other" && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-ink-500">Paste content from any other source — pre-fills the form below</p>
          <input className="input" placeholder="Title (optional)"
            value={otherTitle} onChange={e => setOtherTitle(e.target.value)} />
          <textarea rows={5} className="input" placeholder="Paste raw text here..."
            value={otherText} onChange={e => setOtherText(e.target.value)} />
          <button className="btn-primary" onClick={useOtherSource} disabled={fetching}>
            {fetching ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Use this text
          </button>
        </div>
      )}

      {/* ── Test Case Generation Options ─────────────────────────────────
          Shared between single-story and bulk modes — moved outside the
          form since it's plain local state, not react-hook-form fields. */}
      <div className="card p-4 space-y-4">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide flex items-center gap-1.5">
          <Settings2 size={13}/> Test case generation options
        </p>

        <div>
          <label className="label mb-2">Test case type (select one or more)</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TC_CATEGORY_OPTIONS.map(opt => (
              <label key={opt.key} className={clsx(
                "flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors text-sm",
                tcTypes.includes(opt.key) ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:bg-ink-50"
              )}>
                <input type="checkbox" className="mt-0.5"
                  checked={tcTypes.includes(opt.key)}
                  onChange={() => toggleTcType(opt.key)} />
                <div>
                  <div className="font-medium text-ink-700">{opt.label}</div>
                  <div className="text-xs text-ink-400">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label mb-2">Complexity</label>
          <div className="grid grid-cols-3 gap-2">
            {COMPLEXITY_OPTIONS.map(opt => (
              <label key={opt.key} className={clsx(
                "flex flex-col gap-0.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors text-sm",
                complexity === opt.key ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:bg-ink-50"
              )}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="complexity" checked={complexity === opt.key}
                    onChange={() => setComplexity(opt.key)} />
                  <span className="font-medium text-ink-700">{opt.label}</span>
                </div>
                <span className="text-xs text-ink-400 pl-5">{opt.hint}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Template selection</label>
            <select className="input" value={template} onChange={e => setTemplate(e.target.value as TCTemplate)}>
              {TEMPLATE_OPTIONS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Naming convention</label>
            <input className="input" placeholder="TC_Login_001"
              value={namingConvention} onChange={e => setNamingConvention(e.target.value)} />
            <p className="text-xs text-ink-400 mt-1">e.g. TC_Login_001, TC_Order_Validation_002</p>
          </div>
        </div>
      </div>

      {mode !== "bulk" && (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {loadedFrom && (watchedTitle || watchedStory) && (
          <div className="card p-3 border-emerald-200 bg-emerald-50 flex items-center gap-2 animate-fade-in">
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0"/>
            <p className="text-sm text-emerald-800">
              Loaded from <strong>{loadedFrom}</strong> — review and edit below before generating.
            </p>
          </div>
        )}

        <div className="card p-4 space-y-3">
          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide flex items-center gap-1.5">
            <FileText size={13}/> User story / validated requirement
          </p>
          <div>
            <label className="label">Story title *</label>
            <input className="input" placeholder="e.g. ME23N purchase order display"
              {...register("title", { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Module</label>
              <select className="input" {...register("module")}>
                <option value="">Select module</option>
                {MODULES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="input" {...register("priority")} defaultValue="P3 - Medium">
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
            <textarea rows={4} className="input" placeholder={"1. System displays PO header and all line items\n2. All fields are read-only\n3. User can navigate to related GR documents\n4. Performance: screen loads in < 3 seconds"}
              {...register("acceptance_criteria")} />
          </div>
          <div>
            <label className="label">Edge cases / negative scenarios</label>
            <textarea rows={2} className="input" placeholder="Invalid PO number, PO from different company code, user without MM display authorisation"
              {...register("edge_cases")} />
          </div>
        </div>

        <button type="submit" disabled={generateMut.isPending} className="btn-primary w-full justify-center py-3">
          {generateMut.isPending
            ? <><Loader2 size={15} className="animate-spin"/> Generating test cases...</>
            : <><Sparkles size={14}/> Generate test cases →</>}
        </button>
      </form>
      )}
    </div>
  );
}
