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
import type { YardPrefab } from "@/lib/types";

// ─── Part presets ─────────────────────────────────────────────────
// Common villa outdoor parts the user can generate with one click.
const PART_PRESETS = [
  { hint: "infinity pool",       emoji: "🏊", label: "泳池" },
  { hint: "pergola",             emoji: "⛺", label: "凉亭" },
  { hint: "outdoor kitchen",     emoji: "🍳", label: "户外厨房" },
  { hint: "gate entrance",       emoji: "🚪", label: "入口大门" },
  { hint: "garden fountain",     emoji: "⛲", label: "喷泉" },
  { hint: "car parking shelter", emoji: "🚗", label: "停车棚" },
  { hint: "stone path",          emoji: "🪨", label: "石径" },
  { hint: "luxury sun lounger",  emoji: "🛋", label: "躺椅" },
];

type GenState = "idle" | "generating" | "done" | "error";

export function Image3dGenerator({ onClose }: { onClose?: () => void }) {
  const referenceImage = useDesignerStore(s => s.referenceImageDataUrl);
  const addYardItem    = useDesignerStore(s => s.addYardItem);

  const [uploadedImg, setUploadedImg]   = useState<string | null>(null);
  const [partHint, setPartHint]         = useState("");
  const [state, setState]               = useState<GenState>("idle");
  const [errorMsg, setErrorMsg]         = useState("");
  const [previewGlb, setPreviewGlb]     = useState<string | null>(null);
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
    if (!activeImage) { setErrorMsg("请先上传参考图片"); setState("error"); return; }
    if (!partHint.trim()) { setErrorMsg("请选择或输入零件类型"); setState("error"); return; }
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
        throw new Error(json.error ?? "生成失败");
      }
      const src = json.glbUrl ?? json.glbBase64!;
      setPreviewGlb(src);
      setState("done");
      // Pre-fill label from hint
      if (!partLabel) setPartLabel(partHint);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, [activeImage, partHint, partLabel]);

  // ── Add to yard ───────────────────────────────────────────────────
  const addToScene = useCallback(() => {
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
      partLabel:   partLabel || partHint || "AI模型",
    };
    addYardItem(prefab);
    setState("idle");
    setPreviewGlb(null);
    onClose?.();
  }, [previewGlb, partColor, partLabel, partHint, addYardItem, onClose]);

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
          🤖 AI 生成 3D 零件
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
        🔬 使用开源模型：<b>Stable Fast 3D</b>（Stability AI）→ <b>TripoSR</b> 备用<br />
        均托管于 Hugging Face Spaces，完全免费，无需 API Key。
      </div>

      {/* Reference image */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>参考图片</div>
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
              换图
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
            + 点击上传参考图片
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      {/* Part presets */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>选择零件类型</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PART_PRESETS.map(p => (
            <button
              key={p.hint}
              onClick={() => { setPartHint(p.hint); setPartLabel(p.label); }}
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
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom input */}
      <input
        value={partHint}
        onChange={e => setPartHint(e.target.value)}
        placeholder="或自定义描述，如 'curved pool with infinity edge'"
        style={{
          width: "100%", boxSizing: "border-box",
          border: "1px solid #DDD", borderRadius: 8, padding: "8px 10px",
          fontSize: 12, marginBottom: 12, outline: "none",
        }}
      />

      {/* Color override */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontWeight: 600 }}>颜色覆盖</span>
        <input
          type="color"
          value={partColor}
          onChange={e => setPartColor(e.target.value)}
          style={{ width: 36, height: 26, border: "none", borderRadius: 4, cursor: "pointer" }}
        />
        <span style={{ fontSize: 11, color: "#888" }}>覆盖 GLB 原始材质色</span>
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
        {state === "generating" ? "⏳ 生成中（30-60秒）…" : "🚀 生成 3D 模型"}
      </button>

      {/* Error */}
      {state === "error" && (
        <div style={{ color: "#DC2626", fontSize: 11, marginBottom: 8 }}>
          ⚠ {errorMsg}
          <br />
          <span style={{ color: "#888" }}>HF Spaces 有时繁忙，可稍后重试</span>
        </div>
      )}

      {/* Done state — add to scene */}
      {state === "done" && previewGlb && (
        <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#166534", fontWeight: 600, marginBottom: 8 }}>
            ✅ GLB 生成成功！
          </div>
          <input
            value={partLabel}
            onChange={e => setPartLabel(e.target.value)}
            placeholder="零件名称（可选）"
            style={{
              width: "100%", boxSizing: "border-box",
              border: "1px solid #BBF7D0", borderRadius: 6, padding: "6px 8px",
              fontSize: 12, marginBottom: 8,
            }}
          />
          <button
            onClick={addToScene}
            style={{
              width: "100%", padding: "8px 0",
              background: "#16A34A", color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            ➕ 加入场景（可拖拽放置）
          </button>
        </div>
      )}

      {/* Pipeline diagram */}
      <div style={{ marginTop: 14, padding: "8px 10px", background: "#F8F8F8", borderRadius: 8, fontSize: 10, color: "#666", lineHeight: 1.7 }}>
        <b>变形金刚拆解流程：</b><br />
        参考图片 → 选部位 → SF3D/TripoSR → GLB<br />
        → 独立拖拽节点 → 换色/换位置 → AI渲染
      </div>
    </div>
  );
}
