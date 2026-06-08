"use client";

/**
 * Image3dGenerator — "Transformer decomposition" panel.
 *
 * Workflow:
 *   1. User uploads a reference photo (or uses the one already in the store).
 *   2. They type what PART they want to extract: "pool", "pergola", "gate"…
 *   3. We call POST /api/image-to-3d (TripoSR / SF3D open-source models).
 *   4. The returned .glb is added to the yard plan as a draggable "glb_model"
 *      prefab — independently positionable, scalable, and colourable.
 *
 * "Transformer decomposition" = each part is a *separate* GLB node in R3F,
 * not a slice of a monolithic mesh.  This gives full per-part editability.
 */

import { useState, useRef, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import type { YardPrefab } from "@/lib/types";

// ─── Part presets ─────────────────────────────────────────────────
// Common villa outdoor parts the user can generate with one click.
type PartLabelKey = "presetPool" | "presetPergola" | "presetKitchen" | "presetGate"
  | "presetFountain" | "presetCarport" | "presetPath" | "presetLounger";
const PART_PRESETS: { hint: string; emoji: string; labelKey: PartLabelKey }[] = [
  { hint: "infinity pool",       emoji: "🏊", labelKey: "presetPool" },
  { hint: "pergola",             emoji: "⛺", labelKey: "presetPergola" },
  { hint: "outdoor kitchen",     emoji: "🍳", labelKey: "presetKitchen" },
  { hint: "gate entrance",       emoji: "🚪", labelKey: "presetGate" },
  { hint: "garden fountain",     emoji: "⛲", labelKey: "presetFountain" },
  { hint: "car parking shelter", emoji: "🚗", labelKey: "presetCarport" },
  { hint: "stone path",          emoji: "🪨", labelKey: "presetPath" },
  { hint: "luxury sun lounger",  emoji: "🛋", labelKey: "presetLounger" },
];

type GenState = "idle" | "generating" | "done" | "error";

export function Image3dGenerator({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const referenceImage   = useDesignerStore(s => s.referenceImageDataUrl);
  const addYardItem      = useDesignerStore(s => s.addYardItem);
  const requestAiRender  = useDesignerStore(s => s.requestAiRender);

  const [uploadedImg, setUploadedImg]   = useState<string | null>(null);
  const [partHint, setPartHint]         = useState("");
  const [state, setState]               = useState<GenState>("idle");
  const [errorMsg, setErrorMsg]         = useState("");
  const [previewGlb, setPreviewGlb]     = useState<string | null>(null);
  const [savedGlbUrl, setSavedGlbUrl]   = useState<string | null>(null);
  const [partColor, setPartColor]       = useState("#D4B896");
  const [partLabel, setPartLabel]       = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Active image (uploaded > store reference > null) ────────────
  const activeImage = uploadedImg ?? referenceImage ?? null;

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setUploadedImg(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  // ── Generate ─────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!activeImage) { setErrorMsg(t.image3d.needUploadImg); setState("error"); return; }
    if (!partHint.trim()) { setErrorMsg(t.image3d.needPartType); setState("error"); return; }
    setState("generating");
    setErrorMsg("");
    setPreviewGlb(null);

    try {
      const res = await fetch("/api/image-to-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: activeImage, partHint: partHint.trim() }),
      });
      const json = await res.json() as {
        glbBase64?: string; glbUrl?: string; error?: string; details?: string[];
      };
      if (!res.ok || (!json.glbBase64 && !json.glbUrl)) {
        throw new Error(json.error ?? t.image3d.genFailed);
      }
      const src = json.glbUrl ?? json.glbBase64!;
      setPreviewGlb(src);
      if (json.glbUrl) setSavedGlbUrl(json.glbUrl);
      setState("done");
      // Pre-fill label from hint
      if (!partLabel) setPartLabel(partHint);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, [activeImage, partHint, partLabel, t]);

  // ── Add to yard ───────────────────────────────────────────────────
  const addToScene = useCallback((andRender = false) => {
    if (!previewGlb) return;
    const prefab: YardPrefab = {
      id:          `glb_${Date.now()}`,
      type:        "prefab",
      prefabKind:  "glb_model",
      x:           200,  // 2 m to the right of house center — user can drag
      z:           300,
      rot:         0,
      scale:       1,
      glbSrc:      previewGlb,
      partColor:   partColor !== "#D4B896" ? partColor : undefined,
      partLabel:   partLabel || partHint || t.image3d.aiModelFallback,
    };
    addYardItem(prefab);
    setState("idle");
    setPreviewGlb(null);
    if (andRender) {
      // Give R3F one frame to mount the new GLB before the modal captures
      setTimeout(() => requestAiRender(), 300);
    }
    onClose?.();
  }, [previewGlb, partColor, partLabel, partHint, addYardItem, requestAiRender, onClose, t]);

  return (
    <div style={{
      width: 340,
      background: "#FAFAFA",
      border: "1px solid #E0E0E0",
      borderRadius: 14,
      padding: 20,
      fontFamily: "sans-serif",
      fontSize: 13,
      color: "#222",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {t.image3d.title}
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>
            ×
          </button>
        )}
      </div>

      {/* Model info */}
      <div style={{
        background: "#EFF6FF", border: "1px solid #BFDBFE",
        borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, color: "#1E40AF",
      }}>
        {t.image3d.modelInfo1a}<b>{t.image3d.modelInfo1b}</b>{t.image3d.modelInfo1c}<b>{t.image3d.modelInfo1d}</b>{t.image3d.modelInfo1e}<br />
        {t.image3d.modelInfo2}
      </div>

      {/* Reference image */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.image3d.referenceImage}</div>
        {activeImage ? (
          <div style={{ position: "relative" }}>
            <img
              src={activeImage}
              alt="reference"
              style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #DDD" }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                position: "absolute", bottom: 6, right: 6,
                background: "rgba(0,0,0,0.55)", color: "#fff",
                border: "none", borderRadius: 6, padding: "3px 8px",
                fontSize: 10, cursor: "pointer",
              }}
            >
              {t.image3d.replaceImg}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              width: "100%", height: 80, border: "2px dashed #C0C0C0",
              borderRadius: 8, background: "#F5F5F5", cursor: "pointer",
              color: "#888", fontSize: 13,
            }}
          >
            {t.image3d.uploadRef}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      {/* Part presets */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.image3d.selectPartType}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PART_PRESETS.map(p => (
            <button
              key={p.hint}
              onClick={() => { setPartHint(p.hint); setPartLabel(t.image3d[p.labelKey]); }}
              style={{
                padding: "5px 10px",
                borderRadius: 20,
                border: `1px solid ${partHint === p.hint ? "#3B82F6" : "#DDD"}`,
                background: partHint === p.hint ? "#EFF6FF" : "#FFF",
                color: partHint === p.hint ? "#1D4ED8" : "#444",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {p.emoji} {t.image3d[p.labelKey]}
            </button>
          ))}
        </div>
      </div>

      {/* Custom input */}
      <input
        value={partHint}
        onChange={e => setPartHint(e.target.value)}
        placeholder={t.image3d.customPlaceholder}
        style={{
          width: "100%", boxSizing: "border-box",
          border: "1px solid #DDD", borderRadius: 8, padding: "8px 10px",
          fontSize: 12, marginBottom: 12, outline: "none",
        }}
      />

      {/* Color override */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontWeight: 600 }}>{t.image3d.colorOverride}</span>
        <input
          type="color"
          value={partColor}
          onChange={e => setPartColor(e.target.value)}
          style={{ width: 36, height: 26, border: "none", borderRadius: 4, cursor: "pointer" }}
        />
        <span style={{ fontSize: 11, color: "#888" }}>{t.image3d.colorOverrideHint}</span>
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={state === "generating"}
        style={{
          width: "100%", padding: "10px 0",
          background: state === "generating" ? "#9CA3AF" : "#2563EB",
          color: "#fff", border: "none", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: state === "generating" ? "not-allowed" : "pointer",
          marginBottom: 10,
        }}
      >
        {state === "generating" ? t.image3d.generating : t.image3d.generateBtn}
      </button>

      {/* Error */}
      {state === "error" && (
        <div style={{ color: "#DC2626", fontSize: 11, marginBottom: 8 }}>
          ⚠ {errorMsg}
          <br />
          <span style={{ color: "#888" }}>{t.image3d.hfBusy}</span>
        </div>
      )}

      {/* Done state — add to scene */}
      {state === "done" && previewGlb && (
        <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#166534", fontWeight: 600, marginBottom: 8 }}>
            {t.image3d.glbSuccess}
          </div>
          <input
            value={partLabel}
            onChange={e => setPartLabel(e.target.value)}
            placeholder={t.image3d.partNamePlaceholder}
            style={{
              width: "100%", boxSizing: "border-box",
              border: "1px solid #BBF7D0", borderRadius: 6, padding: "6px 8px",
              fontSize: 12, marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => addToScene(false)}
              style={{
                flex: 1, padding: "8px 0",
                background: "#16A34A", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t.image3d.addToScene}
            </button>
            <button
              onClick={() => addToScene(true)}
              style={{
                flex: 1, padding: "8px 0",
                background: "#7C3AED", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t.image3d.addAndRender}
            </button>
          </div>

          {/* 本地保存 + 下载 */}
          <div style={{
            borderTop: "1px solid #BBF7D0", paddingTop: 8,
            display: "flex", gap: 6, alignItems: "center",
          }}>
            {savedGlbUrl && (
              <div style={{ flex: 1, fontSize: 9, color: "#15803D", fontFamily: "monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={`public${savedGlbUrl}`}>
                💾 public{savedGlbUrl}
              </div>
            )}
            <button
              onClick={() => {
                const a = document.createElement("a");
                a.href = savedGlbUrl ?? previewGlb!;
                a.download = `sf3d_${partLabel || partHint}_${Date.now()}.glb`;
                a.click();
              }}
              style={{
                padding: "5px 12px", borderRadius: 6,
                border: "1px solid #16A34A", background: "#fff",
                color: "#16A34A", fontSize: 10, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t.image3d.downloadGlb}
            </button>
          </div>
        </div>
      )}

      {/* Pipeline diagram */}
      <div style={{ marginTop: 14, padding: "8px 10px", background: "#F8F8F8", borderRadius: 8, fontSize: 10, color: "#666", lineHeight: 1.7 }}>
        <b>{t.image3d.pipelineTitle}</b><br />
        {t.image3d.pipeline1}<br />
        {t.image3d.pipeline2}
      </div>
    </div>
  );
}
