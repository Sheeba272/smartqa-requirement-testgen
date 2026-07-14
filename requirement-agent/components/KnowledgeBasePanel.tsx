"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { api, KnowledgeDoc } from "@/lib/api";
import { Upload, BookOpen, Trash2, Loader2, FileType, FileText, CheckCircle, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { clsx } from "clsx";

const SOURCE_ICONS: Record<string, JSX.Element> = {
  upload: <FileType size={14} />,
  confluence: <BookOpen size={14} />,
  text: <FileText size={14} />,
};

export default function KnowledgeBasePanel() {
  const qc = useQueryClient();
  const [confluenceUrl, setConfluenceUrl] = useState("");

  const { data: docs, isLoading } = useQuery<KnowledgeDoc[]>({
    queryKey: ["knowledge"],
    queryFn: api.listKnowledge,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.uploadKnowledge(file),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      if (doc.status === "indexed") {
        toast.success(`"${doc.filename}" indexed (${doc.chunk_count} chunks)`);
      } else {
        toast.error(doc.error || "Indexing failed");
      }
    },
    onError: () => toast.error("Upload failed"),
  });

  const confluenceMut = useMutation({
    mutationFn: (page_url: string) => api.addConfluenceToKnowledge({ page_url }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      toast.success(`"${doc.filename}" indexed (${doc.chunk_count} chunks)`);
      setConfluenceUrl("");
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Could not fetch Confluence page"),
  });

  const deleteMut = useMutation({
    mutationFn: api.deleteKnowledge,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      toast.success("Removed from knowledge base");
    },
  });

  const dropzone = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/pdf": [".pdf"],
      "text/plain": [".txt", ".md"],
    },
    multiple: true,
    onDrop: (files) => files.forEach(f => uploadMut.mutate(f)),
  });

  return (
    <div className="space-y-4">
      <div className="card p-4 border-brand-200 bg-brand-50">
        <p className="text-xs font-semibold text-brand-800 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
          <BookOpen size={13}/> Contextual knowledge base
        </p>
        <p className="text-sm text-brand-900 leading-relaxed">
          Upload BRDs, Word docs, PDFs, or Confluence pages here. They're chunked and embedded
          into a separate reference corpus — Agent 1 retrieves relevant passages during validation
          to fill gaps in requirements (e.g. pulling acceptance criteria details from a BRD).
          These documents are <strong>never validated themselves</strong> and don't appear in your
          requirements list.
        </p>
      </div>

      <div {...dropzone.getRootProps()} className={clsx(
        "card p-8 flex flex-col items-center justify-center gap-2 cursor-pointer border-2 border-dashed transition-colors text-center",
        dropzone.isDragActive ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-300"
      )}>
        <input {...dropzone.getInputProps()} />
        {uploadMut.isPending
          ? <Loader2 size={24} className="text-brand-500 animate-spin"/>
          : <Upload size={24} className="text-ink-400" />}
        <p className="text-sm font-medium text-ink-600">Drop BRD / Word (.docx) / PDF / text files here</p>
        <p className="text-xs text-ink-400">Multiple files supported</p>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide flex items-center gap-1.5">
          <BookOpen size={13}/> Add Confluence page
        </p>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="https://your-org.atlassian.net/wiki/spaces/SPACE/pages/123456789/Title"
            value={confluenceUrl} onChange={e => setConfluenceUrl(e.target.value)} />
          <button className="btn-primary" onClick={() => confluenceMut.mutate(confluenceUrl)}
            disabled={confluenceMut.isPending || !confluenceUrl.trim()}>
            {confluenceMut.isPending ? <Loader2 size={14} className="animate-spin"/> : <BookOpen size={14}/>} Index
          </button>
        </div>
      </div>

      <div className="card p-4">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">
          Indexed documents {docs ? `(${docs.length})` : ""}
        </p>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 text-ink-400 py-4">
            <Loader2 size={14} className="animate-spin"/> Loading...
          </div>
        )}
        {docs?.length === 0 && (
          <p className="text-xs text-ink-400 text-center py-4">No documents indexed yet.</p>
        )}
        <ul className="space-y-2">
          {docs?.map(doc => (
            <li key={doc.id} className="flex items-center gap-3 py-2 border-b border-ink-100 last:border-0">
              <div className="w-7 h-7 rounded-lg bg-ink-100 flex items-center justify-center text-ink-500 flex-shrink-0">
                {SOURCE_ICONS[doc.source_type] || <FileText size={14}/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-700 truncate">{doc.filename}</p>
                <p className="text-xs text-ink-400">
                  {doc.chunk_count} chunks · {doc.char_count.toLocaleString()} chars
                  {doc.module ? ` · ${doc.module}` : ""}
                </p>
              </div>
              {doc.status === "indexed"
                ? <CheckCircle size={14} className="text-emerald-500 flex-shrink-0"/>
                : <span title={doc.error}><XCircle size={14} className="text-red-500 flex-shrink-0"/></span>}
              <button className="text-ink-400 hover:text-red-500 flex-shrink-0"
                onClick={() => deleteMut.mutate(doc.id)} title="Remove from knowledge base">
                <Trash2 size={14}/>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
