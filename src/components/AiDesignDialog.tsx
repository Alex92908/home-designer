"use client";

/**
 * 全局「文生设计」入口 —— 右下角常驻按钮 + 下拉面板（与 AiEntryMenu 同款样式）。
 * 用自然语言描述住宅 → /api/ai-design → applyAiDesign 直接落到画布。
 *
 *   ✨ 生成设计   —— mode "create"：从零重建整套住宅
 *   🔧 增量微调   —— mode "edit"  ：在当前设计上只改你提到的部分
 *   ⚙️ 设置       —— 头部齿轮：主动配/换大模型 API Key（不再靠点生成时突然弹窗）
 *
 * 全部逻辑走共享 hook useAiDesign。BYOK：密钥只存浏览器本地、随请求转发、不落服务端。
 */
import { useState, useRef, useEffect } from "react";
import { useAiDesign } from "@/lib/useAiDesign";
import { getAiKey, getSelectedProvider } from "@/lib/aiKeys";
import { useLocale } from "@/lib/i18n";
import ApiKeyPromptModal from "./ApiKeyPromptModal";

export default function AiDesignDialog() {
  const en = useLocale() === "en";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const {
    aiInput, setAiInput, aiImage, setAiImage, aiLoading, aiStatus, aiError, aiSummary,
    clearMessages, generate, keyPrompt, onKeySave, onKeyClose, onKeyRemove, configureKey,
  } = useAiDesign();
  const fileRef = useRef<HTMLInputElement>(null);

  // 读取参考图并压到 ≤1280px 的 JPEG data URL——原图直接 base64 会把请求/
  // token 撑爆，视觉模型也用不到那么高的分辨率。
  const pickImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      setAiImage(canvas.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(url);
      if (aiError || aiSummary) clearMessages();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  // 点外部关闭（生成中或 key 弹窗开着时不关，避免误触打断）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (aiLoading || keyPrompt) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, aiLoading, keyPrompt]);

  const placeholder = en
    ? "e.g. A 3-storey modern minimal villa, ground floor open living + kitchen, top floor master suite, with a rooftop terrace"
    : "例如：一栋三层现代极简别墅，一楼开放式客厅+厨房，顶层主卧套间，带天台露台";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold shadow-lg transition-all active:scale-95 hover:scale-105"
        style={{ background: "linear-gradient(135deg, #0d9488, #2dd4bf)", backdropFilter: "blur(6px)" }}
        title={en ? "Describe your home, AI builds the layout" : "用一句话描述，AI 直接生成户型配置"}
      >
        <span>🏠</span>
        <span>{en ? "Text to Design" : "文生设计"}</span>
        <span className="ml-0.5 opacity-70">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-80 rounded-2xl overflow-hidden z-50 text-left"
          style={{ background: "var(--ds-surface, #fff)", border: "1px solid var(--ds-border, #e5e7eb)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        >
          {/* 头：标题 + ⚙️ 设置（配/换 API Key） */}
          <div
            className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--ds-text-3, #9ca3af)", borderBottom: "1px solid var(--ds-border, #e5e7eb)" }}
          >
            <span>{en ? "Text → Design" : "文字生成设计"}</span>
            <button
              onClick={configureKey}
              title={en ? "Configure model API Key" : "配置大模型 API Key"}
              className="text-sm opacity-70 hover:opacity-100"
            >
              ⚙️
            </button>
          </div>

          <div className="p-3 flex flex-col gap-2.5">
            <textarea
              value={aiInput}
              onChange={(e) => { setAiInput(e.target.value); if (aiError || aiSummary) clearMessages(); }}
              rows={4}
              placeholder={placeholder}
              disabled={aiLoading}
              className="w-full resize-none rounded-lg px-2.5 py-2 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-teal-300 disabled:opacity-60"
              style={{ border: "1px solid var(--ds-border, #e5e7eb)", background: "var(--ds-surface-2, #fafafa)", color: "var(--ds-text, #111)" }}
            />

            {/* 参考房间照片：传一张图 → 视觉模型按图复刻这间房（家具/材质/窗） */}
            <div className="flex items-center gap-2">
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }}
              />
              {aiImage ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={aiImage} alt="" className="w-12 h-9 object-cover rounded-md shrink-0"
                    style={{ border: "1px solid var(--ds-border, #e5e7eb)" }} />
                  <span className="text-[10px] truncate flex-1" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                    {en ? "Reference photo attached — AI will rebuild this room" : "已附参考图 · AI 将按图复刻这间房"}
                  </span>
                  <button onClick={() => setAiImage(null)} disabled={aiLoading}
                    className="shrink-0 text-xs opacity-60 hover:opacity-100" title={en ? "Remove photo" : "移除参考图"}>✕</button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-50"
                  style={{ border: "1px dashed var(--ds-border, #d1d5db)", color: "var(--ds-text-2, #4b5563)" }}
                  title={en ? "Upload a reference room photo and rebuild it here" : "传一张参考房间照片，AI 在这里复刻搭建"}
                >
                  📷 {en ? "Reference photo" : "参考图复刻"}
                </button>
              )}
            </div>

            {/* 带参考图时「微调」是常用路径（把照片复刻进现有住宅）→ 升为主按钮；
                「生成设计」会整屋重建只剩这一间，降为次按钮免得误触。 */}
            <div className="flex gap-2">
              <button
                onClick={() => generate(aiImage ? "edit" : "create")}
                disabled={aiLoading || (!aiInput.trim() && !aiImage)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #0d9488, #2dd4bf)" }}
              >
                {aiLoading ? "⏳" : aiImage ? "🔧" : "✨"}{" "}
                {aiImage ? (en ? "Rebuild into current home" : "复刻进当前住宅") : (en ? "Generate" : "生成设计")}
              </button>
              <button
                onClick={() => generate(aiImage ? "create" : "edit")}
                disabled={aiLoading || (!aiInput.trim() && !aiImage)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                style={{ border: "1px solid var(--ds-border, #e5e7eb)", color: "var(--ds-text-2, #4b5563)" }}
                title={aiImage
                  ? (en ? "Rebuild from scratch — the home will contain ONLY this room" : "从零重建——整个住宅会只剩照片这一间")
                  : (en ? "Tweak the current design without rebuilding" : "在当前设计上增量修改，不重建")}
              >
                {aiImage ? (en ? "✨ Rebuild all" : "✨ 整屋重建") : (en ? "🔧 Tweak" : "🔧 微调")}
              </button>
            </div>

            <p className="text-[10px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
              {aiImage
                ? (en
                    ? "“Rebuild into current home” adds/replaces just this room · “Rebuild all” wipes the whole home."
                    : "「复刻进当前住宅」只新增/替换这一间 ·「整屋重建」会清掉现有住宅只剩这间。")
                : (en
                    ? "“Generate” rebuilds from scratch · “Tweak” edits the current home incrementally."
                    : "「生成设计」从零重建 ·「微调」在当前住宅上只改你说的部分。")}
            </p>

            {aiLoading && (
              <div
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed"
                style={{ background: "#f0fdfa", border: "1px solid #99f6e4", color: "#0f766e" }}
              >
                <span
                  className="inline-block w-3 h-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin"
                  aria-hidden
                />
                <span>{aiStatus ?? (en ? "Working…" : "处理中…")}</span>
              </div>
            )}
            {aiSummary && (
              <div className="rounded-lg px-2.5 py-2 text-[11px] leading-relaxed" style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46" }}>
                ✅ {aiSummary}
              </div>
            )}
            {aiError && (
              <div className="rounded-lg px-2.5 py-2 text-[11px] leading-relaxed" style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b" }}>
                ⚠️ {aiError}
              </div>
            )}
          </div>
        </div>
      )}

      {keyPrompt && (
        <ApiKeyPromptModal
          initialProvider={getSelectedProvider()}
          getSavedKey={getAiKey}
          onSave={onKeySave}
          onClose={onKeyClose}
          onRemove={onKeyRemove}
        />
      )}
    </div>
  );
}
