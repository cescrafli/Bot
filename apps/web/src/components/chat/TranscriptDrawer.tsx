import React, { useRef, useEffect, useState } from "react";
import { X, Trash2, Download, MessageSquare, Copy, Check } from "lucide-react";

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

function renderInlineTokens(text: string): React.ReactNode[] {
  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<]+)|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // [Judul](url)
      const title = match[2];
      const url = match[3];
      elements.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-rose-400 hover:text-rose-300 underline font-medium break-all"
        >
          {title}
        </a>
      );
    } else if (match[4]) {
      // Raw URL
      const url = match[4];
      elements.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-rose-400 hover:text-rose-300 underline break-all"
        >
          {url}
        </a>
      );
    } else if (match[5]) {
      // **tebal**
      elements.push(
        <strong key={match.index} className="font-semibold text-white">
          {match[6]}
        </strong>
      );
    } else if (match[7]) {
      // `kode`
      elements.push(
        <code key={match.index} className="bg-slate-900/60 px-1 py-0.5 rounded text-[11px] font-mono text-rose-300">
          {match[8]}
        </code>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

function FormattedTranscriptText({ content }: { content: string }) {
  if (!content) return null;

  // Split content by lines to detect markdown tables, headings, and bullet points
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const currentLine = lines[i];
    const trimmed = currentLine.trim();

    // 1. Deteksi Tabel Markdown: baris yang diawali dan diakhiri dengan '|'
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const parseRow = (line: string) =>
          line
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());

        const headers = parseRow(tableLines[0]);
        const isSeparator = (line: string) => /^\|(\s*:?-+:?\s*\|)+$/.test(line);
        const dataLines = isSeparator(tableLines[1]) ? tableLines.slice(2) : tableLines.slice(1);
        const rows = dataLines.map(parseRow);

        blocks.push(
          <div
            key={`table-${blocks.length}`}
            className="my-2.5 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/70 shadow-sm no-scrollbar"
          >
            <table className="w-full text-[11px] text-left border-collapse min-w-[260px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04]">
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="px-2.5 py-1.5 font-bold text-rose-300">
                      {renderInlineTokens(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-2.5 py-1.5 text-slate-200">
                        {renderInlineTokens(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 2. Deteksi Heading
    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4
          key={`h3-${blocks.length}`}
          className="text-xs font-bold text-rose-300 mt-2.5 mb-1 flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
          <span>{renderInlineTokens(trimmed.replace(/^###\s+/, ""))}</span>
        </h4>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3
          key={`h2-${blocks.length}`}
          className="text-xs sm:text-sm font-bold text-white mt-3 mb-1 border-b border-white/10 pb-1"
        >
          {renderInlineTokens(trimmed.replace(/^##\s+/, ""))}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h2
          key={`h1-${blocks.length}`}
          className="text-sm font-extrabold text-white mt-3.5 mb-1.5"
        >
          {renderInlineTokens(trimmed.replace(/^#\s+/, ""))}
        </h2>
      );
      i++;
      continue;
    }

    // 3. Deteksi Bullet Points
    if (/^[*-]\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[*-]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[*-]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-1.5 space-y-1 pl-1">
          {listItems.map((item, itemIdx) => (
            <li key={itemIdx} className="flex items-start gap-1.5 text-xs text-slate-200 leading-relaxed">
              <span className="text-rose-400 select-none mt-0.5">•</span>
              <span className="flex-1">{renderInlineTokens(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 4. Paragraf Teks Biasa
    if (trimmed.length > 0) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-1 whitespace-pre-wrap leading-relaxed">
          {renderInlineTokens(currentLine)}
        </p>
      );
    }
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  isOpen,
  transcripts,
  onClose,
  onClear,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts, isOpen]);

  if (!isOpen) return null;

  const handleCopyBubble = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleExport = (format: "md" | "txt" = "md") => {
    const dateStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
    const wibFormatted = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "full",
      timeStyle: "medium",
    }).format(new Date());

    let content = "";
    if (format === "md") {
      content = `# Riwayat Percakapan Celyn AI\n\n- **Waktu Ekspor**: ${wibFormatted} WIB\n- **Total Pesan**: ${transcripts.length}\n\n---\n\n`;
      content += transcripts
        .map((t) => `### [${t.time}] ${t.speaker === "celyn" ? "✨ Celyn" : "👤 Anda"}\n\n${t.text}\n`)
        .join("\n---\n\n");
    } else {
      content = transcripts
        .map((t) => `[${t.time}] ${t.speaker === "celyn" ? "Celyn" : "Anda"}: ${t.text}`)
        .join("\n\n");
    }

    const blob = new Blob([content], {
      type: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `celyn-chat-${dateStr}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Backdrop overlay for quick tap-outside to close */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-45 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-lg md:max-w-xl h-[100dvh] glass-panel border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 safe-top safe-bottom">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <MessageSquare className="w-4 h-4 text-rose-400" />
            <span>Riwayat Percakapan</span>
          </div>
          <div className="flex items-center gap-1.5">
            {transcripts.length > 0 && (
              <>
                <button
                  onClick={() => handleExport("md")}
                  className="px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-xs border border-white/5"
                  title="Unduh Laporan Markdown (.md)"
                >
                  <Download className="w-3.5 h-3.5 text-rose-400" />
                  <span>.MD</span>
                </button>
                <button
                  onClick={onClear}
                  className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Hapus Riwayat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Tutup riwayat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Konten Chat */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 overscroll-contain no-scrollbar">
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
              className={`flex flex-col max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed group ${
                t.speaker === "celyn"
                  ? "self-start bg-slate-800/80 border border-rose-500/20 text-slate-100"
                  : "self-end ml-auto bg-rose-600/20 border border-rose-500/30 text-rose-100"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1 text-[10px] opacity-70">
                <span className="font-semibold">
                  {t.speaker === "celyn" ? "✨ Celyn" : "👤 Anda"}
                </span>
                <div className="flex items-center gap-1.5">
                  <span>{t.time}</span>
                  <button
                    onClick={() => handleCopyBubble(t.text, idx)}
                    className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Salin pesan ini"
                  >
                    {copiedIndex === idx ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                    )}
                  </button>
                </div>
              </div>
              <FormattedTranscriptText content={t.text} />
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
    </>
  );
};
