import React, { useCallback } from "react";
import {
  X,
  FileText,
  FileSpreadsheet,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export interface ActiveDocJob {
  id: string;
  /** Display title (e.g. "Laporan IHSG Oktober") */
  title: string;
  /** Filename with extension (e.g. "Laporan_IHSG.pdf") */
  fileName: string;
  /** Document kind */
  kind: "pdf" | "docx" | "xlsx";
  /** Current phase */
  stage: "processing" | "done" | "error";
  /** Human-readable progress/status text */
  message: string;
  /** Blob ready for download (only when stage === "done") */
  blob?: Blob;
  /** Error details (only when stage === "error") */
  error?: string;
}

interface DocumentActionPillProps {
  job: ActiveDocJob | null;
  onDismiss: () => void;
}

const KIND_COLORS: Record<string, string> = {
  pdf: "from-rose-500 to-rose-600",
  docx: "from-blue-500 to-blue-600",
  xlsx: "from-emerald-500 to-emerald-600",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  pdf: <FileText className="w-4 h-4" />,
  docx: <FileText className="w-4 h-4" />,
  xlsx: <FileSpreadsheet className="w-4 h-4" />,
};

export const DocumentActionPill: React.FC<DocumentActionPillProps> = ({
  job,
  onDismiss,
}) => {
  const handleDownload = useCallback(() => {
    if (!job?.blob) return;
    const url = window.URL.createObjectURL(job.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = job.fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  }, [job]);

  if (!job) return null;

  const gradientClass = KIND_COLORS[job.kind] ?? "from-slate-500 to-slate-600";
  const kindIcon = KIND_ICONS[job.kind] ?? <FileText className="w-4 h-4" />;

  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl shadow-2xl border border-white/10 animate-in fade-in slide-in-from-bottom-3 duration-300 max-w-[min(420px,calc(100vw-2rem))] w-full mx-auto"
      style={{
        background: "rgba(10, 12, 20, 0.85)",
        backdropFilter: "blur(20px)",
      }}
      role="status"
      aria-live="polite"
    >
      {/* Kind icon badge */}
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br ${gradientClass} shrink-0 text-white shadow-md`}
      >
        {job.stage === "processing" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : job.stage === "error" ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          kindIcon
        )}
      </div>

      {/* Text section */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-white truncate leading-tight">
          {job.title || job.fileName}
        </p>
        <p
          className={`text-[10px] truncate leading-tight mt-0.5 ${
            job.stage === "error"
              ? "text-rose-400"
              : job.stage === "done"
              ? "text-emerald-400"
              : "text-slate-400"
          }`}
        >
          {job.stage === "done"
            ? "Siap diunduh"
            : job.stage === "error"
            ? job.error || "Gagal membuat dokumen"
            : job.message || "Memproses..."}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        {job.stage === "done" && job.blob && (
          <button
            onClick={handleDownload}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r ${gradientClass} text-white text-[11px] font-semibold shadow-md hover:opacity-90 active:scale-95 transition-all cursor-pointer`}
            title="Unduh file"
          >
            <Download className="w-3.5 h-3.5" />
            Unduh
          </button>
        )}

        {job.stage === "done" && (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        )}

        <button
          onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Tutup"
          aria-label="Tutup notifikasi dokumen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
