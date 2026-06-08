"use client";

/**
 * GlbPbrPanel — "我有GLB + 原图，帮我上PBR"
 *
 * Workflow:
 *   1. User uploads an existing GLB model (from TRELLIS, TripoSR, etc.)
 *   2. Reference image is taken from store OR user uploads one
 *   3. POST /api/pbr-texture → TripoAI "texture" task applies PBR maps
 *   4. User downloads the PBR-textured GLB or adds it straight to the yard
 *
 * What PBR adds to a plain GLB:
 *   • Albedo (diffuse) map  — baked surface color
 *   • Normal map            — micro-surface bump detail
 *   • Roughness map         — specular lobe width per texel
 *   • Metalness map         — dielectric vs. conductor response
 *   All four are embedded in the output GLB and auto-loaded by Three.js / useGLTF.
 */

import { useState, useRef, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import type { YardPrefab } from "@/lib/types";

type Stage = "idle" | "working" | "done" | "error";

export function GlbPbrPanel({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const referenceImageDataUrl = useDesignerStore(s => s.referenceImageDataUrl);
  const addYardItem           = useDesignerStore(s => s.addYardItem);

  const [glbSrc, setGlbSrc]         = useState<string | null>(null);
  const [glbName, setGlbName]       = useState("");
  const [refImg, setRefImg]         = useState<string | null>(referenceImageDataUrl ?? null);
  const [prompt, setPrompt]         = useState("villa building, realistic stone walls, concrete, glass windows");
  const [stage, setStage]           = useState<Stage>("idle");
  const [resultGlb, setResultGlb]   = useState<string | null>(null);
  const [backend, setBackend]       = useState("");
  const [backendNote, setBackendNote]   = useState("");
  const [trueRetexture, setTrueRetexture] = useState(false);
  const [errMsg, setErrMsg]         = useState("");
  const [noKeys, setNoKeys]         = useState(false);

  const glbRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  // ── File loaders ────────────────────────────────────────────────
  const loadGlb = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setGlbName(f.name);
    const reader = new FileReader();
    reader.onload = ev => setGlbSrc(ev.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  const loadImg = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setRefImg(ev.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  // ── Apply PBR — tries /api/pbr-texture first, then ComfyUI local ──
  const applyPbr = useCallback(async () => {
    if (!glbSrc || !refImg) { setErrMsg(t.glbPbr.needUploadBoth); return; }
    setStage("working");
    setErrMsg("");
    setNoKeys(false);
    try {
      // First try the cloud cascade (Meshy → TripoAI → Fal → Hunyuan3D HF)
      const res = await fetch("/api/pbr-texture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ glbBase64: glbSrc, imageBase64: refImg, prompt }),
      });
      const json = await res.json() as {
        glbBase64?: string;
        backend?: string;
        backendLabel?: string;
        note?: string;
        trueRetexture?: boolean;
        error?: string;
        message?: string;
      };
      if (res.status === 422 && json.error === "no_api_keys") {
        setNoKeys(true);
        setErrMsg(json.message ?? t.glbPbr.noApiKey);
        setStage("error");
        return;
      }
      if (res.ok && json.glbBase64) {
        setResultGlb(json.glbBase64);
        setBackend(json.backendLabel ?? json.backend ?? "");
        setBackendNote(json.note ?? "");
        setTrueRetexture(json.trueRetexture ?? false);
        setStage("done");
        return;
      }

      // Cloud failed — try ComfyUI local (free, no credits needed)
      console.log("[GlbPbrPanel] cloud failed, trying ComfyUI local…");
      const comfyRes = await fetch("/api/comfyui-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: refImg, mode: "auto" }),
      });
      const comfyJson = await comfyRes.json() as {
        glbBase64?: string; mode?: string; error?: string; message?: string;
      };

      if (comfyRes.status === 503) {
        // ComfyUI offline — throw combined error
        throw new Error((json.error ?? t.glbPbr.allCloudFailed) + "\n\n" + t.glbPbr.comfyNotRunning);
      }
      if (!comfyRes.ok || !comfyJson.glbBase64) {
        throw new Error(comfyJson.message ?? comfyJson.error ?? json.error ?? t.glbPbr.pbrGenFailed);
      }

      setResultGlb(comfyJson.glbBase64);
      setBackend(t.glbPbr.comfyBackend(comfyJson.mode ?? "auto"));
      setBackendNote(t.glbPbr.comfyNote);
      setTrueRetexture(false);
      setStage("done");

    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }, [glbSrc, refImg, prompt, t]);

  // ── Add PBR result to yard ───────────────────────────────────────
  const addToScene = useCallback(() => {
    if (!resultGlb) return;
    const prefab: YardPrefab = {
      id:         `pbr_${Date.now()}`,
      type:       "prefab",
      prefabKind: "glb_model",
      x: 200, z: 200, rot: 0, scale: 1,
      glbSrc:    resultGlb,
      partLabel: t.glbPbr.pbrModelLabel(glbName || "uploaded"),
    };
    addYardItem(prefab);
    onClose?.();
  }, [resultGlb, glbName, addYardItem, onClose, t]);

  // ── Download ─────────────────────────────────────────────────────
  const download = useCallback(() => {
    if (!resultGlb) return;
    const a = document.createElement("a");
    a.href = resultGlb;
    a.download = `pbr_${glbName || "model"}_${Date.now()}.glb`;
    a.click();
  }, [resultGlb, glbName]);

  return (
    <div style={{
      width: 400, maxHeight: "90vh", overflowY: "auto",
      background: "#FAFAFA", border: "1px solid #E0E0E0",
      borderRadius: 16, padding: 22,
      fontFamily: "sans-serif", fontSize: 13, color: "#222",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{t.glbPbr.title}</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
            {t.glbPbr.subtitle}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#AAA" }}>×</button>
        )}
      </div>

      {/* PBR explanation card */}
      <div style={{
        background: "#F0F9FF", border: "1px solid #BAE6FD",
        borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 11,
      }}>
        <b style={{ color: "#0369A1" }}>{t.glbPbr.whyPbr}</b>
        <div style={{ color: "#0C4A6E", marginTop: 4, lineHeight: 1.7 }}>
          {t.glbPbr.whyPbrBody1}<br />
          {t.glbPbr.whyPbrBody2a}<b>{t.glbPbr.whyPbrBody2b}</b>{t.glbPbr.whyPbrBody2c}
        </div>
      </div>

      {/* ── Step 1: Upload GLB ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.glbPbr.step1}</div>
        {glbSrc ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", background: "#F0FDF4",
            border: "1px solid #86EFAC", borderRadius: 8,
          }}>
            <span style={{ fontSize: 24 }}>📦</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {glbName}
              </div>
              <div style={{ fontSize: 10, color: "#16A34A" }}>
                {Math.round(glbSrc.length * 0.75 / 1024)} KB
              </div>
            </div>
            <button onClick={() => glbRef.current?.click()}
              style={{ background: "none", border: "1px solid #86EFAC", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "#166534" }}>
              {t.glbPbr.replace}
            </button>
          </div>
        ) : (
          <button onClick={() => glbRef.current?.click()} style={{
            width: "100%", padding: "20px 0",
            border: "2px dashed #C8C8C8", borderRadius: 10,
            background: "#F5F5F5", cursor: "pointer", color: "#888",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 28 }}>📦</span>
            <span style={{ fontSize: 12 }}>{t.glbPbr.uploadGlb}</span>
          </button>
        )}
        <input ref={glbRef} type="file" accept=".glb,.gltf" style={{ display: "none" }} onChange={loadGlb} />
      </div>

      {/* ── Step 2: Reference image ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {t.glbPbr.step2}
          {referenceImageDataUrl && !refImg && (
            <span style={{ fontSize: 10, color: "#7C3AED", marginLeft: 8, fontWeight: 400 }}>
              {t.glbPbr.autoLoadedRef}
            </span>
          )}
        </div>

        {refImg ? (
          <div style={{ position: "relative" }}>
            <img src={refImg} alt="ref" style={{
              width: "100%", borderRadius: 8,
              border: "1px solid #DDD", display: "block",
            }} />
            <button onClick={() => imgRef.current?.click()} style={{
              position: "absolute", bottom: 8, right: 8,
              background: "rgba(0,0,0,0.6)", color: "#fff",
              border: "none", borderRadius: 6, padding: "3px 10px",
              fontSize: 10, cursor: "pointer",
            }}>{t.glbPbr.replaceImg}</button>
          </div>
        ) : (
          <button onClick={() => imgRef.current?.click()} style={{
            width: "100%", padding: "20px 0",
            border: "2px dashed #C8C8C8", borderRadius: 10,
            background: "#F5F5F5", cursor: "pointer", color: "#888",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 28 }}>🖼</span>
            <span style={{ fontSize: 12 }}>{t.glbPbr.uploadVillaRef}</span>
          </button>
        )}
        <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={loadImg} />
      </div>

      {/* ── Step 3: texture prompt (for Meshy) ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {t.glbPbr.step3}
          <span style={{ fontSize: 10, color: "#7C3AED", marginLeft: 8, fontWeight: 400 }}>{t.glbPbr.step3Hint}</span>
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={2}
          style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid #E5E7EB", fontSize: 11, resize: "vertical",
            fontFamily: "sans-serif", color: "#374151", boxSizing: "border-box",
          }}
          placeholder="villa building, realistic stone walls, wood beams, glass windows…"
        />
      </div>

      {/* ── Working ── */}
      {stage === "working" && (
        <div style={{ textAlign: "center", padding: "20px 0", marginBottom: 12 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>⚙️</div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t.glbPbr.generating}</div>
          <div style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>
            {t.glbPbr.genBody1}<br />
            {t.glbPbr.genBody2}<br />
            {t.glbPbr.genBody3}
          </div>
          <div style={{ marginTop: 16, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: "#7C3AED", borderRadius: 2, width: "40%",
              animation: "slide 2s ease-in-out infinite",
            }} />
          </div>
          <style>{`@keyframes slide { 0%{margin-left:0} 50%{margin-left:60%} 100%{margin-left:0} }`}</style>
        </div>
      )}

      {/* ── Error / No Keys ── */}
      {stage === "error" && (
        <div style={{
          background: noKeys ? "#FFF7ED" : "#FEF2F2",
          border: `1px solid ${noKeys ? "#FED7AA" : "#FECACA"}`,
          borderRadius: 10, padding: "12px 14px", marginBottom: 12,
        }}>
          {noKeys ? (
            <>
              <div style={{ fontWeight: 700, color: "#92400E", marginBottom: 6 }}>
                {t.glbPbr.needKeyTitle}
              </div>
              <div style={{ fontSize: 11, color: "#78350F", lineHeight: 1.6, marginBottom: 10 }}>
                {t.glbPbr.needKeyDesc1}<code>.env.local</code>{t.glbPbr.needKeyDesc2}
              </div>
              <div style={{
                background: "#1E293B", color: "#E2E8F0",
                borderRadius: 8, padding: "10px 14px",
                fontFamily: "monospace", fontSize: 10, lineHeight: 2,
                marginBottom: 10,
              }}>
                <div style={{ color: "#94A3B8" }}>{t.glbPbr.keyComment1a}</div>
                <div style={{ color: "#94A3B8" }}>{t.glbPbr.keyComment1b}</div>
                <div>MESHY_API_KEY=msy_xxxx</div>
                <div style={{ marginTop: 6, color: "#94A3B8" }}>{t.glbPbr.keyComment2a}</div>
                <div style={{ color: "#94A3B8" }}>{t.glbPbr.keyComment2b}</div>
                <div>TRIPO_API_KEY=tsk_xxxx</div>
                <div style={{ marginTop: 6, color: "#94A3B8" }}>{t.glbPbr.keyComment3}</div>
                <div>FAL_API_KEY=xxxx:xxxx</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a href="https://app.meshy.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  {t.glbPbr.meshyFreeSignup}
                </a>
                <a href="https://platform.tripo3d.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  {t.glbPbr.tripoFreeSignup}
                </a>
                <a href="https://fal.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  {t.glbPbr.falSignup}
                </a>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>{t.glbPbr.textureFailed}</div>
              <div style={{ fontSize: 11, color: "#7F1D1D", lineHeight: 1.7, marginBottom: 8 }}>{errMsg}</div>
              {/* Credit exhaustion helpers */}
              {errMsg.includes("TripoAI") && errMsg.includes("用完") && (
                <a href="https://platform.tripo3d.ai/" target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", marginBottom: 6, padding: "6px 0", borderRadius: 8, border: "1px solid #DC2626", color: "#DC2626", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  {t.glbPbr.tripoTopUp}
                </a>
              )}
              {errMsg.includes("Fal.ai") && errMsg.includes("余额") && (
                <a href="https://fal.ai/dashboard/billing" target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", marginBottom: 6, padding: "6px 0", borderRadius: 8, border: "1px solid #DC2626", color: "#DC2626", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  {t.glbPbr.falTopUp}
                </a>
              )}
              <div style={{ fontSize: 10, color: "#7F1D1D", marginBottom: 8 }}>
                {t.glbPbr.addMeshyHintPre}<b>{t.glbPbr.addMeshyHintBold}</b>{t.glbPbr.addMeshyHintPost}
                <code style={{ display: "block", marginTop: 4, background: "#1E293B", color: "#E2E8F0", padding: "4px 8px", borderRadius: 4 }}>
                  MESHY_API_KEY=msy_xxxx
                </code>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href="https://app.meshy.ai/" target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, border: "1px solid #7F1D1D", color: "#7F1D1D", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  {t.glbPbr.meshyFreeSignup}
                </a>
                <button onClick={applyPbr} style={{
                  flex: 1, padding: "6px 0", borderRadius: 8,
                  background: "#DC2626", color: "#fff", border: "none", fontSize: 11,
                  fontWeight: 700, cursor: "pointer",
                }}>{t.glbPbr.retry}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Done ── */}
      {stage === "done" && resultGlb && (
        <div style={{
          background: "#F0FDF4", border: "1px solid #86EFAC",
          borderRadius: 10, padding: "12px 14px", marginBottom: 12,
        }}>
          <div style={{ fontWeight: 700, color: "#166534", marginBottom: 6, fontSize: 13 }}>
            {t.glbPbr.pbrSuccess}
          </div>
          {backend && (
            <div style={{
              display: "inline-block", fontSize: 10, background: "#DCFCE7",
              border: "1px solid #86EFAC", borderRadius: 6,
              padding: "2px 8px", color: "#166534", marginBottom: 8,
            }}>
              {backend}
            </div>
          )}
          {backendNote && (
            <div style={{
              fontSize: 10, color: trueRetexture ? "#15803D" : "#CA8A04",
              marginBottom: 8, padding: "6px 10px",
              background: trueRetexture ? "#DCFCE7" : "#FEF9C3",
              borderRadius: 6,
            }}>
              {trueRetexture ? "✅ " : "⚠️ "}{backendNote}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#15803D", marginBottom: 10, lineHeight: 1.6 }}>
            {t.glbPbr.doneBody1}<br />
            {t.glbPbr.doneBody2}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addToScene} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
              background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              {t.glbPbr.addToScene}
            </button>
            <button onClick={download} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
              background: "#15803D", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              {t.glbPbr.downloadGlb}
            </button>
          </div>
        </div>
      )}

      {/* ── Generate button (idle/error states) ── */}
      {stage !== "working" && stage !== "done" && (
        <button
          onClick={applyPbr}
          disabled={!glbSrc || !refImg}
          style={{
            width: "100%", padding: "12px 0",
            background: !glbSrc || !refImg ? "#9CA3AF" : "linear-gradient(135deg,#7C3AED,#4F46E5)",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 14, fontWeight: 700,
            cursor: !glbSrc || !refImg ? "not-allowed" : "pointer",
          }}
        >
          {t.glbPbr.generateBtn}
        </button>
      )}

      {/* Reset button on done */}
      {stage === "done" && (
        <button onClick={() => { setStage("idle"); setResultGlb(null); setGlbSrc(null); setGlbName(""); }}
          style={{
            width: "100%", marginTop: 8, padding: "8px 0",
            background: "transparent", border: "1px solid #D1D5DB",
            borderRadius: 8, fontSize: 12, cursor: "pointer", color: "#666",
          }}>
          {t.glbPbr.changeModel}
        </button>
      )}
    </div>
  );
}
