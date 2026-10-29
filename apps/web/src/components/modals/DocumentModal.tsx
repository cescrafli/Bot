import React, { useState, useRef } from "react";
import {
  X,
  FileText,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Trash2,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Globe,
  Image as ImageIcon,
  HelpCircle,
  Check,
} from "lucide-react";
import { ParsedDocument, DocumentKind } from "@celyn/shared";

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeDocuments: ParsedDocument[];
  onUploadDocument: (file: File) => Promise<any>;
  onRemoveDocument: (fileName: string) => void;
  onGenerateDocument: (
    kind: DocumentKind,
    title: string,
    instruction: string
  ) => Promise<any>;
  isUploading: boolean;
  isGenerating: boolean;
  statusMessage: string | null;
}

export const DocumentModal: React.FC<DocumentModalProps> = ({
  isOpen,
  onClose,
  activeDocuments,
  onUploadDocument,
  onRemoveDocument,
  onGenerateDocument,
  isUploading,
  isGenerating,
  statusMessage,
}) => {
  const [activeTab, setActiveTab] = useState<"read" | "create">("read");
  const [selectedKind, setSelectedKind] = useState<DocumentKind>("pdf");
  const [docTitle, setDocTitle] = useState("");
  const [docInstruction, setDocInstruction] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<ParsedDocument | null>(null);
  const [editOperation, setEditOperation] = useState<"edit" | "translate" | "summarize" | "paraphrase">("edit");
  const [editLanguage, setEditLanguage] = useState("English");
  const [editInstruction, setEditInstruction] = useState("");
  const [isProcessingInPlace, setIsProcessingInPlace] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setErrorMessage(null);
    try {
      for (const file of files) {
        if (file.size > 500 * 1024 * 1024) {
          throw new Error(
            `Ukuran file '${file.name}' (${(file.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas upload maksimal 500 MB.`
          );
        }
        await onUploadDocument(file);
      }
    } catch (err: any) {
      const msg = err?.message || "Gagal mengunggah dokumen.";
      if (msg.includes("PASSWORD_REQUIRED") || msg.toLowerCase().includes("password")) {
        setErrorMessage(
          "File ini dilindungi password sehingga tidak dapat saya buka. Silakan kirim versi tanpa password atau buka enkripsinya terlebih dahulu."
        );
      } else if (
        msg.includes("LEGACY_FORMAT") ||
        // Match ".doc" but NOT ".docx" / ".docm" / ".dotx"
        /\.doc(?!x|m)(\b|")/i.test(msg) ||
        // Match ".xls" but NOT ".xlsx" / ".xlsm" / ".xlsb"
        /\.xls(?!x|m|b)(\b|")/i.test(msg)
      ) {
        setErrorMessage(
          "Format file ini tidak dapat dibaca. Coba konversi ke format modern (.docx atau .xlsx) lalu kirim lagi."
        );
      } else if (msg.includes("413") || msg.toLowerCase().includes("too large") || msg.toLowerCase().includes("melebihi batas")) {
        setErrorMessage(
          msg.includes("melebihi batas")
            ? msg
            : "Ukuran file terlalu besar untuk diproses serverless (maksimal 4.5 MB per file). Harap gunakan file dokumen di bawah 4.5 MB."
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleProcessInPlace = async (doc: ParsedDocument) => {
    setIsProcessingInPlace(true);
    setErrorMessage(null);
    try {
      const password = localStorage.getItem("celyn_auth_password") || "admin";
      const token = localStorage.getItem("celyn_auth_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-admin-password": password,
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/documents/process", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fileName: doc.fileName,
          operation: editOperation,
          originalContent: doc.markdownContent,
          instruction: editInstruction.trim() || `Lakukan operasi ${editOperation} pada dokumen ini`,
          targetLanguage: editOperation === "translate" ? editLanguage : undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || `Gagal memproses dokumen (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let downloadFileName = `edited_${doc.fileName}`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          downloadFileName = decodeURIComponent(match[1].replace(/['"]/g, ""));
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setEditingDoc(null);
      setEditInstruction("");
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal memproses dokumen in-place.");
    } finally {
      setIsProcessingInPlace(false);
    }
  };

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim()) {
      setErrorMessage("Judul dokumen wajib diisi.");
      return;
    }

    setErrorMessage(null);
    try {
      await onGenerateDocument(
        selectedKind,
        docTitle.trim(),
        docInstruction.trim() || `Buat dokumen ${selectedKind.toUpperCase()} berdasarkan obrolan`
      );
      setDocTitle("");
      setDocInstruction("");
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal membuat dokumen.");
    }
  };

  const getDocIcon = (name: string, mime: string) => {
    const lower = name.toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower) || mime.startsWith("image/")) {
      return <ImageIcon className="w-5 h-5 text-purple-400" />;
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet")) {
      return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
    }
    return <FileText className="w-5 h-5 text-rose-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto glass-panel rounded-2xl border border-white/10 shadow-2xl p-4 sm:p-6 relative no-scrollbar">
        {/* Tombol Tutup */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Modal */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/20 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <span>Manajemen Dokumen Celyn</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                FOTO • PDF • WORD • EXCEL
              </span>
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Unggah referensi & foto untuk sesi atau minta Celyn melakukan riset profesional
            </p>
          </div>
        </div>

        {/* Tab Pilihan */}
        <div className="flex items-center gap-2 p-1 bg-slate-900/60 rounded-xl border border-white/5 mb-5">
          <button
            onClick={() => {
              setActiveTab("read");
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === "read"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Unggah & Baca Dokumen</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("create");
              setErrorMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === "create"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Research</span>
          </button>
        </div>

        {/* Banner Pesan / Status (Deduplikasi: sembunyikan jika sudah ada errorMessage) */}
        {statusMessage && !errorMessage && (
          <div
            className={`mb-4 p-3 rounded-xl flex items-center gap-2.5 text-xs animate-in fade-in ${
              statusMessage.toLowerCase().includes("gagal") ||
              statusMessage.toLowerCase().includes("error") ||
              statusMessage.toLowerCase().includes("tidak didukung")
                ? "bg-red-500/10 border border-red-500/20 text-red-300"
                : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
            }`}
          >
            {isUploading || isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin text-rose-400 shrink-0" />
            ) : statusMessage.toLowerCase().includes("gagal") ||
              statusMessage.toLowerCase().includes("error") ||
              statusMessage.toLowerCase().includes("tidak didukung") ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2.5 text-xs text-red-300 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* TAB 1: UNGGAH & BACA DOKUMEN */}
        {activeTab === "read" && (
          <div className="space-y-4">
            {/* Area Unggah File */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-white/10 hover:border-rose-500/40 hover:bg-rose-500/5 rounded-2xl p-6 text-center cursor-pointer transition-all group"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.xlsx,.xls,.xlsm,.xlsb,.csv,.tsv,.docx,.doc,.docm,.dotx,.txt,.md,.rtf,image/*"
                onChange={handleFileChange}
                className="hidden"
                disabled={isUploading}
              />
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-800/60 group-hover:bg-rose-500/20 text-slate-300 group-hover:text-rose-300 flex items-center justify-center transition-all">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <UploadCloud className="w-6 h-6" />
                )}
              </div>
              <p className="text-xs sm:text-sm font-semibold text-white mb-1">
                {isUploading ? "Memproses Dokumen/Foto (Vision OCR)..." : "Klik untuk pilih file foto atau dokumen (Bisa banyak file)"}
              </p>
              <p className="text-[11px] text-slate-400">
                Mendukung Foto (PNG, JPG, WEBP, GIF), PDF, Excel (.xlsx, .xls, .csv), Word (.docx, .doc), dan Teks (.txt) — hingga 500 MB/file
              </p>
            </div>

            {/* Banner Mode Upload-then-Wait */}
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-white/5 text-[11px] text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span>
                <strong>Mode Tenang Aktif:</strong> File yang diunggah langsung siap dianalisis tanpa memotong suara Celyn. Anda bisa mengetik pertanyaan terlebih dahulu atau langsung berbicara saat siap.
              </span>
            </div>

            {/* Daftar Dokumen Sesi Aktif */}
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                Dokumen Sesi Aktif ({activeDocuments.length})
              </h4>

              {activeDocuments.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-900/40 border border-white/5 text-center text-xs text-slate-400">
                  Belum ada dokumen yang diunggah untuk sesi ini. Anda dapat mengunggah file PDF sebanyak apa pun tanpa batasan.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeDocuments.map((doc, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex flex-col gap-2.5 transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-lg bg-slate-800/60 shrink-0">
                            {getDocIcon(doc.fileName, doc.mimeType)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {doc.fileName}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                              <span>{doc.characterCount.toLocaleString()} karakter</span>
                              {doc.usedOcr && (
                                <span className="px-1.5 py-[1px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  OCR Vision
                                </span>
                              )}
                              {doc.truncated && (
                                <span className="px-1.5 py-[1px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  Diringkas
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (editingDoc?.fileName === doc.fileName) {
                                setEditingDoc(null);
                              } else {
                                setEditingDoc(doc);
                                setEditInstruction("");
                              }
                            }}
                            className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                              editingDoc?.fileName === doc.fileName
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                            }`}
                            title="Edit / Proses dokumen in-place"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Edit In-Place</span>
                          </button>

                          <button
                            onClick={() => onRemoveDocument(doc.fileName)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                            title="Hapus dari konteks sesi"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Inline In-Place Document Editor */}
                      {editingDoc?.fileName === doc.fileName && (
                        <div className="mt-1 p-3 rounded-xl bg-slate-950/70 border border-rose-500/20 space-y-3 animate-in fade-in">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-rose-300 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Proses & Edit Dokumen In-Place</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Format: {doc.fileName.split(".").pop()?.toUpperCase()}
                            </span>
                          </div>

                          {/* Operasi */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {(["edit", "translate", "summarize", "paraphrase"] as const).map((op) => (
                              <button
                                key={op}
                                type="button"
                                onClick={() => setEditOperation(op)}
                                className={`py-1 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                  editOperation === op
                                    ? "bg-rose-500/30 text-rose-200 border border-rose-500/50"
                                    : "bg-slate-900/60 text-slate-400 hover:text-white border border-white/5"
                                }`}
                              >
                                {op === "edit"
                                  ? "Edit / Revisi"
                                  : op === "translate"
                                  ? "Terjemahkan"
                                  : op === "summarize"
                                  ? "Ringkas"
                                  : "Parafrase"}
                              </button>
                            ))}
                          </div>

                          {editOperation === "translate" && (
                            <div>
                              <label className="block text-[10px] font-medium text-slate-400 mb-1">
                                Bahasa Tujuan
                              </label>
                              <input
                                type="text"
                                value={editLanguage}
                                onChange={(e) => setEditLanguage(e.target.value)}
                                placeholder="Contoh: Bahasa Inggris, Bahasa Jepang, dll."
                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-white text-xs focus:outline-none focus:border-rose-500/50"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] font-medium text-slate-400 mb-1">
                              Instruksi Perubahan (Opsional)
                            </label>
                            <textarea
                              value={editInstruction}
                              onChange={(e) => setEditInstruction(e.target.value)}
                              placeholder="Contoh: Ubah tanggal jadi 2026, revisi anggaran di tabel menjadi 10jt, atau perbaiki tata bahasa."
                              rows={2}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50 resize-none"
                            />
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingDoc(null)}
                              className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              disabled={isProcessingInPlace}
                              onClick={() => handleProcessInPlace(doc)}
                              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shadow"
                            >
                              {isProcessingInPlace ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Sedang Memproses...</span>
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Terapkan & Unduh Hasil</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: RESEARCH (INTERAKTIF BERSAMA CELYN) */}
        {activeTab === "create" && (
          <form onSubmit={handleGenerateSubmit} className="space-y-4">
            {/* Sapaan & Panduan Celyn Avatar */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-500/10 via-pink-500/10 to-purple-500/10 border border-rose-500/20 flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md shadow-rose-500/30 ring-2 ring-rose-400/30">
                ✨
              </div>
              <div className="text-xs">
                <p className="font-bold text-white mb-0.5">Celyn Research Assistant</p>
                <p className="text-slate-300 leading-relaxed">
                  Aku siap membantumu melakukan riset mendalam tingkat ahli dan langsung menyusunnya ke dalam file siap pakai. Jawab pertanyaan di bawah ini ya:
                </p>
              </div>
            </div>

            {/* Pertanyaan 1: Format File */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-bold flex items-center justify-center border border-rose-500/30">
                  1
                </span>
                <label className="text-xs font-bold text-white">
                  Mau dibentuk ke format apa dokumennya?
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedKind("pdf")}
                  className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                    selectedKind === "pdf"
                      ? "bg-rose-500/20 border-rose-500/50 text-white shadow ring-1 ring-rose-500/30"
                      : "bg-slate-900/40 border-white/5 text-slate-400 hover:text-white"
                  }`}
                >
                  <FileText className="w-5 h-5 mx-auto mb-1 text-rose-400" />
                  <p className="text-xs font-bold">PDF (.pdf)</p>
                  <p className="text-[10px] text-slate-400">Laporan Resmi</p>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedKind("docx")}
                  className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                    selectedKind === "docx"
                      ? "bg-blue-500/20 border-blue-500/50 text-white shadow ring-1 ring-blue-500/30"
                      : "bg-slate-900/40 border-white/5 text-slate-400 hover:text-white"
                  }`}
                >
                  <FileText className="w-5 h-5 mx-auto mb-1 text-blue-400" />
                  <p className="text-xs font-bold">Word (.docx)</p>
                  <p className="text-[10px] text-slate-400">Bisa Diedit</p>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedKind("xlsx")}
                  className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                    selectedKind === "xlsx"
                      ? "bg-emerald-500/20 border-emerald-500/50 text-white shadow ring-1 ring-emerald-500/30"
                      : "bg-slate-900/40 border-white/5 text-slate-400 hover:text-white"
                  }`}
                >
                  <FileSpreadsheet className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
                  <p className="text-xs font-bold">Excel (.xlsx)</p>
                  <p className="text-[10px] text-slate-400">Tabel & Rumus</p>
                </button>
              </div>
            </div>

            {/* Pertanyaan 2: Judul Riset / Dokumen */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-bold flex items-center justify-center border border-rose-500/30">
                  2
                </span>
                <label className="text-xs font-bold text-white">
                  Lalu, apa judul atau topik yang ingin kamu teliti?
                </label>
              </div>

              {/* Rekomendasi Topik Cepat */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  "Analisis Saham & Valuasi Emiten",
                  "Kajian Hukum & Kepatuhan Regulasi",
                  "Riset Pasar & Analisis Kompetitor",
                  "Evaluasi Arsitektur Sistem AI",
                ].map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() => setDocTitle(sugg)}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 border border-white/5 transition-all cursor-pointer"
                  >
                    + {sugg}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Contoh: Analisis Fundamental Saham Sektor Perbankan 2026"
                className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50 transition-colors"
                disabled={isGenerating}
              />
            </div>

            {/* Pertanyaan 3: Instruksi & Fokus Analisis */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-bold flex items-center justify-center border border-rose-500/30">
                  3
                </span>
                <label className="text-xs font-bold text-white">
                  Instruksi atau fokus analisis apa yang wajib diteliti secara mendalam?
                </label>
              </div>

              {/* Rekomendasi Fokus Cepat */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  "Rangkum seluruh obrolan sesi aktif kita",
                  "Fokus metrik fundamental, valuasi PER/PBV, dan risiko",
                  "Sertakan perbandingan tabel data komparatif riil",
                ].map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() => setDocInstruction(sugg)}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 border border-white/5 transition-all cursor-pointer"
                  >
                    + {sugg}
                  </button>
                ))}
              </div>

              <textarea
                value={docInstruction}
                onChange={(e) => setDocInstruction(e.target.value)}
                placeholder="Tuliskan poin-poin yang wajib dimuat, misalnya: analisis valuasi, katalis pertumbuhan, risiko utama, dan rekomendasi strategis."
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/60 border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50 transition-colors resize-none"
                disabled={isGenerating}
              />
            </div>

            {/* Tombol Eksekusi Riset */}
            <button
              type="submit"
              disabled={isGenerating}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white font-bold text-xs shadow-lg shadow-rose-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Celyn Sedang Melakukan Riset Mendalam...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Mulai Riset Profesional & Buat Dokumen ({selectedKind.toUpperCase()})</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
