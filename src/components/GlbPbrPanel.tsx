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
import type { YardPrefab } from "@/lib/types";

type Stage = "idle" | "working" | "done" | "error";

export function GlbPbrPanel({ onClose }: { onClose?: () => void }) {
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
    if (!glbSrc || !refImg) { setErrMsg("请先上传 GLB 和参考图"); return; }
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
        setErrMsg(json.message ?? "未配置 API Key");
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
        throw new Error((json.error ?? "所有云端服务失败") + "\n\n💡 本地 ComfyUI 未运行");
      }
      if (!comfyRes.ok || !comfyJson.glbBase64) {
        throw new Error(comfyJson.message ?? comfyJson.error ?? json.error ?? "PBR 生成失败");
      }

      setResultGlb(comfyJson.glbBase64);
      setBackend(`ComfyUI 本地 (${comfyJson.mode ?? "auto"})`);
      setBackendNote("本地 ComfyUI 生成，从参考图重建新模型 + 纹理");
      setTrueRetexture(false);
      setStage("done");

    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }, [glbSrc, refImg, prompt]);

  // ── Add PBR result to yard ───────────────────────────────────────
  const addToScene = useCallback(() => {
    if (!resultGlb) return;
    const prefab: YardPrefab = {
      id:         `pbr_${Date.now()}`,
      type:       "prefab",
      prefabKind: "glb_model",
      x: 200, z: 200, rot: 0, scale: 1,
      glbSrc:    resultGlb,
      partLabel: `PBR模型 (${glbName || "uploaded"})`,
    };
    addYardItem(prefab);
    onClose?.();
  }, [resultGlb, glbName, addYardItem, onClose]);

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
          <div style={{ fontWeight: 700, fontSize: 15 }}>🎨 GLB + 原图 → PBR 贴图</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
            给现有 GLB 模型上 PBR：Albedo · Normal · Roughness · Metalness
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
        <b style={{ color: "#0369A1" }}>为什么需要 PBR？</b>
        <div style={{ color: "#0C4A6E", marginTop: 4, lineHeight: 1.7 }}>
          TripoSR / TRELLIS 默认输出的 GLB 仅含顶点色，在自然光下显得"塑料感"。<br />
          PBR 为模型追加 <b>法线图（凹凸细节）+ 粗糙度图（高光）+ 金属度图</b>，
          渲染效果提升一个等级。
        </div>
      </div>

      {/* ── Step 1: Upload GLB ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Step 1 · 上传 GLB 模型</div>
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
              换
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
            <span style={{ fontSize: 12 }}>点击上传 .glb 文件</span>
          </button>
        )}
        <input ref={glbRef} type="file" accept=".glb,.gltf" style={{ display: "none" }} onChange={loadGlb} />
      </div>

      {/* ── Step 2: Reference image ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Step 2 · 参考图片
          {referenceImageDataUrl && !refImg && (
            <span style={{ fontSize: 10, color: "#7C3AED", marginLeft: 8, fontWeight: 400 }}>
              （已自动载入工作区参考图）
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
            }}>换图</button>
          </div>
        ) : (
          <button onClick={() => imgRef.current?.click()} style={{
            width: "100%", padding: "20px 0",
            border: "2px dashed #C8C8C8", borderRadius: 10,
            background: "#F5F5F5", cursor: "pointer", color: "#888",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 28 }}>🖼</span>
            <span style={{ fontSize: 12 }}>上传别墅参考图（用于贴图参考）</span>
          </button>
        )}
        <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={loadImg} />
      </div>

      {/* ── Step 3: texture prompt (for Meshy) ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Step 3 · 材质描述
          <span style={{ fontSize: 10, color: "#7C3AED", marginLeft: 8, fontWeight: 400 }}>（Meshy AI 需要此描述生成贴图）</span>
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
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>正在生成 PBR 贴图…</div>
          <div style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>
            上传 GLB + 参考图<br />
            AI 分析材质、光泽、细节<br />
            生成：法线 · 粗糙度 · 金属度 · Albedo
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
                🔑 需要配置 API Key
              </div>
              <div style={{ fontSize: 11, color: "#78350F", lineHeight: 1.6, marginBottom: 10 }}>
                三种模式，任选其一在 <code>.env.local</code> 配置：
              </div>
              <div style={{
                background: "#1E293B", color: "#E2E8F0",
                borderRadius: 8, padding: "10px 14px",
                fontFamily: "monospace", fontSize: 10, lineHeight: 2,
                marginBottom: 10,
              }}>
                <div style={{ color: "#94A3B8" }}># ① Meshy AI — 真实重贴图（推荐）</div>
                <div style={{ color: "#94A3B8" }}>#    保留原始几何，免费 200 credits</div>
                <div>MESHY_API_KEY=msy_xxxx</div>
                <div style={{ marginTop: 6, color: "#94A3B8" }}># ② TripoAI — 300 free credits/month</div>
                <div style={{ color: "#94A3B8" }}>#    从参考图重建新模型+PBR</div>
                <div>TRIPO_API_KEY=tsk_xxxx</div>
                <div style={{ marginTop: 6, color: "#94A3B8" }}># ③ Fal.ai — 按量付费</div>
                <div>FAL_API_KEY=xxxx:xxxx</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a href="https://app.meshy.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  Meshy AI 免费注册 →
                </a>
                <a href="https://platform.tripo3d.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  Tripo3D 免费注册 →
                </a>
                <a href="https://fal.ai/" target="_blank" rel="noopener noreferrer"
                  style={{
                    flex: 1, textAlign: "center", padding: "6px 0", minWidth: 100,
                    borderRadius: 8, border: "1px solid #D97706",
                    color: "#92400E", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>
                  Fal.ai 注册 →
                </a>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>⚠ 贴图失败</div>
              <div style={{ fontSize: 11, color: "#7F1D1D", lineHeight: 1.7, marginBottom: 8 }}>{errMsg}</div>
              {/* Credit exhaustion helpers */}
              {errMsg.includes("TripoAI") && errMsg.includes("用完") && (
                <a href="https://platform.tripo3d.ai/" target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", marginBottom: 6, padding: "6px 0", borderRadius: 8, border: "1px solid #DC2626", color: "#DC2626", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  TripoAI 充值 / 等待每月重置 →
                </a>
              )}
              {errMsg.includes("Fal.ai") && errMsg.includes("余额") && (
                <a href="https://fal.ai/dashboard/billing" target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", marginBottom: 6, padding: "6px 0", borderRadius: 8, border: "1px solid #DC2626", color: "#DC2626", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  Fal.ai 充值 →
                </a>
              )}
              <div style={{ fontSize: 10, color: "#7F1D1D", marginBottom: 8 }}>
                💡 添加 <b>Meshy AI 免费账户</b>（保留原始几何，免费 200 credits）：
                <code style={{ display: "block", marginTop: 4, background: "#1E293B", color: "#E2E8F0", padding: "4px 8px", borderRadius: 4 }}>
                  MESHY_API_KEY=msy_xxxx
                </code>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href="https://app.meshy.ai/" target="_blank" rel="noopener noreferrer"
                  style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, border: "1px solid #7F1D1D", color: "#7F1D1D", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  Meshy AI 免费注册 →
                </a>
                <button onClick={applyPbr} style={{
                  flex: 1, padding: "6px 0", borderRadius: 8,
                  background: "#DC2626", color: "#fff", border: "none", fontSize: 11,
                  fontWeight: 700, cursor: "pointer",
                }}>🔄 重试</button>
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
            ✅ PBR 贴图成功！
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
            已生成包含 Albedo · Normal · Roughness · Metalness 的完整 PBR GLB。<br />
            在 Three.js 中光照效果将显著改善。
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addToScene} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
              background: "#16A34A", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              ➕ 加入场景
            </button>
            <button onClick={download} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
              background: "#15803D", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              ⬇ 下载 PBR GLB
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
          🎨 生成 PBR 贴图
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
          ↩ 换一个模型
        </button>
      )}
    </div>
  );
}
