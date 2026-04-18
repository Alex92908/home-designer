"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type RenderStyle = "photo" | "watercolor" | "sketch" | "magazine";
const STYLES: RenderStyle[] = ["photo", "watercolor", "sketch", "magazine"];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AiRenderModal({ open, onClose }: Props) {
  const t = useT();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [style, setStyle] = useState<RenderStyle>("photo");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Capture canvas screenshot when modal opens
  useEffect(() => {
    if (!open) {
      // Reset on close
      setResult(null);
      setError(null);
      setScreenshot(null);
      return;
    }

    // Small delay to ensure canvas is painted
    const t = setTimeout(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      if (!canvas) {
        setError("无法找到3D画面，请确保已切换到效果图或外观视图");
        return;
      }
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        setScreenshot(dataUrl);
      } catch {
        setError("无法捕获画面（可能是跨域或WebGL限制）");
      }
    }, 80);

    return () => clearTimeout(t);
  }, [open]);

  async function generate() {
    if (!screenshot || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: screenshot, style }),
      });
      const data: { url?: string; error?: string } = await res.json();
      if (data.url) {
        setResult(data.url);
      } else {
        setError(
          data.error === "no_key"
            ? t.aiRenderNoKey
            : (data.error ?? t.aiRenderError)
        );
      }
    } catch {
      setError(t.aiRenderError);
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    if (!result) return;
    try {
      const res = await fetch(result);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `ai-render-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(result, "_blank");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[8888] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(640px, 100%)", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-gray-800">{t.aiRenderTitle}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          {/* Screenshot preview */}
          {screenshot && !result && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                当前画面
              </p>
              <img
                src={screenshot}
                className="w-full rounded-xl object-cover border border-gray-100"
                style={{ maxHeight: 200 }}
                alt="当前3D截图"
              />
            </div>
          )}

          {/* Style selector */}
          {!result && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wider">
                {t.aiRenderStyle}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className="py-2.5 px-1 rounded-xl text-xs font-medium border transition-all"
                    style={{
                      borderColor: style === s ? "#6366f1" : "#e5e7eb",
                      background: style === s ? "#eef2ff" : "#fafafa",
                      color: style === s ? "#4f46e5" : "#6b7280",
                      transform: style === s ? "scale(1.02)" : "scale(1)",
                    }}
                  >
                    {(t.aiRenderStyles as Record<string, string>)[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Result image */}
          {result && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                {t.aiRenderResult}
              </p>
              <img
                src={result}
                className="w-full rounded-xl object-cover shadow-md"
                alt="AI生成效果图"
              />
            </div>
          )}

          {/* Loading spinner */}
          {loading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div
                className="w-10 h-10 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin"
              />
              <p className="text-sm text-gray-500">{t.aiRenderGenerating}</p>
              <p className="text-xs text-gray-400">约需 20–40 秒，请耐心等待…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-600 text-xs rounded-xl px-4 py-3 leading-relaxed">
              ⚠️ {error}
            </div>
          )}

          {/* Hint */}
          {!result && !loading && !error && (
            <p className="text-[11px] text-gray-400 leading-relaxed">{t.aiRenderDesc}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          {result ? (
            <>
              <button
                onClick={() => { setResult(null); setError(null); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
              >
                {t.aiRenderRetry}
              </button>
              <button
                onClick={download}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
              >
                {t.aiRenderDownload}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="py-2.5 px-5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
              >
                {t.aiRenderClose}
              </button>
              <button
                onClick={generate}
                disabled={loading || !screenshot}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
              >
                {loading ? t.aiRenderGenerating : t.aiRenderGenerate}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
