import React, { useRef, useEffect } from "react";
import { X, Trash2, Download, MessageSquare } from "lucide-react";

interface TranscriptItem {
  speaker: "user" | "celyn";
  text: string;
  time: string;
}

interface TranscriptDrawerProps {
  isOpen: boolean;
  transcripts: TranscriptItem[];
  onClose: () => void;
  onClear: () => void;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  isOpen,
  transcripts,
  onClose,
  onClear,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, isOpen]);

  if (!isOpen) return null;

  const handleExport = () => {
    const textContent = transcripts
      .map((t) => `[${t.time}] ${t.speaker === "celyn" ? "Celyn" : "Anda"}: ${t.text}`)
      .join("\n\n");
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `celyn-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-md glass-panel border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 safe-top safe-bottom">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <MessageSquare className="w-4 h-4 text-rose-400" />
          <span>Riwayat Percakapan</span>
        </div>
        <div className="flex items-center gap-1.5">
          {transcripts.length > 0 && (
            <>
              <button
                onClick={handleExport}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Download Riwayat Teks"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={onClear}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                title="Hapus Riwayat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Konten Chat */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 text-xs py-10">
            <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
            <p>Belum ada percakapan.</p>
            <p className="text-[11px] mt-1 text-slate-600">
              Mulai sesi dan ucapkan sesuatu ke Celyn untuk melihat transkrip.
            </p>
          </div>
        ) : (
          transcripts.map((t, idx) => (
            <div
              key={idx}
              className={`flex flex-col max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                t.speaker === "celyn"
                  ? "self-start bg-slate-800/80 border border-rose-500/20 text-slate-100"
                  : "self-end ml-auto bg-rose-600/20 border border-rose-500/30 text-rose-100"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1 text-[10px] opacity-70">
                <span className="font-semibold">
                  {t.speaker === "celyn" ? "✨ Celyn" : "👤 Anda"}
                </span>
                <span>{t.time}</span>
              </div>
              <p className="whitespace-pre-wrap">{t.text}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
