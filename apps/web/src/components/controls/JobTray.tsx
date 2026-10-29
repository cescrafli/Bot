import React from "react";
import { Download, CheckCircle2, AlertCircle, Loader2, FileText, Search, X } from "lucide-react";

export interface BackgroundJob {
  id: string;
  kind: "read" | "summarize" | "translate" | "paraphrase" | "edit" | "create" | "research" | "custom";
  stage: "queued" | "running" | "done" | "error" | "needs_input";
  progress: number;
  message?: string;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
}

interface JobTrayProps {
  jobs: BackgroundJob[];
  onDismissJob: (id: string) => void;
}

export const JobTray: React.FC<JobTrayProps> = ({ jobs, onDismissJob }) => {
  if (jobs.length === 0) return null;

  const getJobIcon = (kind: BackgroundJob["kind"]) => {
    if (kind === "research") return <Search className="w-4 h-4 text-cyan-400" />;
    return <FileText className="w-4 h-4 text-rose-400" />;
  };

  return (
    <div className="fixed bottom-24 right-3 left-3 sm:right-6 sm:left-auto z-40 flex flex-col gap-2.5 max-w-[min(24rem,calc(100vw-1.5rem))] w-full mx-auto sm:mx-0 pointer-events-auto">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="p-3.5 rounded-2xl glass-panel border border-white/10 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-300 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 rounded-lg bg-slate-800/80 border border-white/5 shrink-0">
                {getJobIcon(job.kind)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {job.fileName || (job.kind === "research" ? "Riset Web" : "Pemrosesan Dokumen")}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {job.message || (job.stage === "running" ? "Sedang diproses di latar belakang..." : "Selesai")}
                </p>
              </div>
            </div>

            <button
              onClick={() => onDismissJob(job.id)}
              className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Progress Bar */}
          {job.stage === "running" && (
            <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-rose-500 h-full transition-all duration-300 rounded-full"
                style={{ width: `${Math.round(Math.max(0.08, job.progress) * 100)}%` }}
              />
            </div>
          )}

          {/* Selesai / Tombol Unduh */}
          {job.stage === "done" && job.downloadUrl && (
            <div className="flex items-center justify-between pt-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Siap diunduh</span>
              </span>
              <a
                href={job.downloadUrl}
                download={job.fileName || "dokumen_celyn"}
                className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh</span>
              </a>
            </div>
          )}

          {/* Error Message */}
          {job.stage === "error" && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-400 pt-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{job.error || "Gagal memproses"}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
