import React, { useState } from "react";
import { ParsedDocument } from "@celyn/shared";
import {
  X,
  Download,
  RotateCcw,
  Sliders,
  Sparkles,
  Eye,
  EyeOff,
  Maximize2,
} from "lucide-react";

interface LivePhotoStageProps {
  doc: ParsedDocument | null;
  isVisible: boolean;
  statusText?: string | null;
  isProcessing?: boolean;
  onClose: () => void;
  onOpenStudio?: () => void;
  onReset?: () => void;
  onDownload?: () => void;
  onQuickAction?: (instruction: string) => void;
}

export const LivePhotoStage: React.FC<LivePhotoStageProps> = ({
  doc,
  isVisible,
  statusText,
  isProcessing = false,
  onClose,
  onOpenStudio,
  onReset,
  onDownload,
  onQuickAction,
}) => {
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible || !doc || !doc.previewDataUrl) return null;

  const currentDisplayUrl =
    isComparingOriginal && doc.originalPreviewDataUrl
      ? doc.originalPreviewDataUrl
      : doc.previewDataUrl;

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
      return;
    }
    const a = document.createElement("a");
    a.href = doc.previewDataUrl || "";
    const baseName = doc.fileName.replace(/\.[^/.]+$/, "");
    a.download = `${baseName}_edited.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      className={`fixed z-40 transition-all duration-300 ease-out pointer-events-auto ${
        isExpanded
          ? "inset-4 sm:inset-12 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          : "top-20 right-4 sm:right-6 w-[280px] sm:w-[320px] max-w-[calc(100vw-2rem)]"
      }`}
    >
      <div
        className={`w-full glass-panel luxury-blur-panel rounded-2xl border border-white/15 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          isExpanded ? "max-w-2xl max-h-[85vh]" : ""
        }`}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900/80 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse shrink-0" />
            <p className="text-xs font-bold text-white truncate">{doc.fileName}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title={isExpanded ? "Perkecil Tampilan" : "Perbesar Tampilan"}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Sembunyikan Foto (Hide)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Status Perubahan Terakhir */}
        {statusText && (
          <div className="px-3.5 py-1.5 bg-gradient-to-r from-rose-500/20 via-purple-500/20 to-indigo-500/20 border-b border-white/5 flex items-center gap-1.5 text-[10px] text-rose-200">
            <Sparkles className="w-3 h-3 text-rose-400 shrink-0" />
            <span className="truncate font-medium">{statusText}</span>
          </div>
        )}

        {/* Area Gambar */}
        <div
          className={`relative bg-slate-950/90 flex items-center justify-center overflow-hidden p-2 select-none ${
            isExpanded ? "h-[50vh] sm:h-[60vh]" : "h-48 sm:h-56"
          }`}
        >
          <img
            src={currentDisplayUrl}
            alt={doc.fileName}
            className="max-h-full max-w-full rounded-xl object-contain shadow-lg transition-transform duration-200"
          />

          {/* Badge Perbandingan Foto Asli */}
          {isComparingOriginal && (
            <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-amber-500/80 text-black text-[9px] font-bold shadow tracking-wide uppercase">
              Foto Asli
            </div>
          )}

          {/* Indikator Memproses Visual */}
          {(isProcessing || (statusText && statusText.includes("Sedang memproses"))) && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-white text-xs font-medium z-10 animate-in fade-in duration-150">
              <span className="w-6 h-6 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-rose-200">Memproses Foto...</span>
            </div>
          )}
        </div>

        {/* Quick Action Chips */}
        {onQuickAction && (
          <div className="px-3 py-1.5 bg-slate-950/70 border-t border-white/5 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            <span className="text-[10px] text-slate-400 shrink-0 font-medium">Aksi Cepat:</span>
            <button
              type="button"
              onClick={() => onQuickAction("ubah warna rambutnya jadi warna putih semuanya")}
              className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-rose-500/20 hover:text-rose-200 text-slate-300 text-[10px] border border-white/10 shrink-0 transition-colors cursor-pointer"
            >
              💇 Rambut Putih
            </button>
            <button
              type="button"
              onClick={() => onQuickAction("ganti latar belakang foto ini jadi warna biru pasfoto")}
              className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-blue-500/20 hover:text-blue-200 text-slate-300 text-[10px] border border-white/10 shrink-0 transition-colors cursor-pointer"
            >
              🟦 Latar Biru
            </button>
            <button
              type="button"
              onClick={() => onQuickAction("ubah foto ini menjadi hitam putih monokrom")}
              className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-purple-500/20 hover:text-purple-200 text-slate-300 text-[10px] border border-white/10 shrink-0 transition-colors cursor-pointer"
            >
              🎞️ Hitam Putih
            </button>
          </div>
        )}

        {/* Footer Tombol Aksi */}
        <div className="p-2.5 bg-slate-900/80 border-t border-white/10 flex items-center justify-between gap-1.5 text-xs">
          {/* Tombol Tahan untuk Bandingkan Foto Asli */}
          {doc.originalPreviewDataUrl && (
            <button
              type="button"
              onMouseDown={() => setIsComparingOriginal(true)}
              onMouseUp={() => setIsComparingOriginal(false)}
              onMouseLeave={() => setIsComparingOriginal(false)}
              onTouchStart={() => setIsComparingOriginal(true)}
              onTouchEnd={() => setIsComparingOriginal(false)}
              className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer border border-white/10 active:bg-amber-500/20 active:text-amber-200"
              title="Tahan tombol ini untuk melihat foto asli sebelum diedit"
            >
              {isComparingOriginal ? (
                <EyeOff className="w-3 h-3 text-amber-300" />
              ) : (
                <Eye className="w-3 h-3 text-slate-400" />
              )}
              <span>{isComparingOriginal ? "Lepas: Hasil Edit" : "Tahan: Lihat Asli"}</span>
            </button>
          )}

          <div className="flex items-center gap-1 ml-auto">
            {onReset && doc.originalPreviewDataUrl && (
              <button
                type="button"
                onClick={onReset}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer border border-white/5"
                title="Kembalikan ke Foto Asli (Reset/Undo)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {onOpenStudio && (
              <button
                type="button"
                onClick={onOpenStudio}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-purple-200 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer border border-white/10"
                title="Buka Slider Studio Manual"
              >
                <Sliders className="w-3 h-3 text-purple-300" />
                <span className="hidden sm:inline">Studio</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white font-bold text-[10px] flex items-center gap-1 shadow transition-all cursor-pointer"
              title="Unduh Hasil Foto"
            >
              <Download className="w-3 h-3" />
              <span>Unduh</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
