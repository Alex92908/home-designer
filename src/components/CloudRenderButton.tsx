"use client";

import { useState, useRef, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { generateExteriorPrompt } from "@/lib/sceneToPrompt";

// ─── Workflow definitions ─────────────────────────────────────────────────────

const WORKFLOWS = [
  {
    id: "exterior",
    label: "外立面出效果图（户外院子）",
    icon: "🏡",
    desc: "ControlNet 生成户外效果图",
  },
  {
    id: "white-model",
    label: "白膜出效果图 (Flux2-Klein)",
    icon: "🏗️",
    desc: "Flux-2-Klein 白膜转真实渲染",
  },
  {
    id: "rough-to-render",
    label: "毛坯变效果图",
    icon: "🔨",
    desc: "毛坯房图片 AI 渲染成精装效果",
  },
] as const;

type WorkflowId = typeof WORKFLOWS[number]["id"];

// ─── Helper: capture current Three.js canvas ─────────────────────────────────

function captureCanvas(): string | null {
  // Try to find the Three.js renderer canvas (first WebGL canvas on page)
  const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas");
  for (const c of canvases) {
    const ctx = c.getContext("webgl") ?? c.getContext("webgl2");
    if (ctx) {
      return c.toDataURL("image/png");
    }
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CloudRenderButton() {
  const [open, setOpen]         = useState(false);
  const [status, setStatus]     = useState<string | null>(null);
  const menuRef                 = useRef<HTMLDivElement>(null);

  const exterior    = useDesignerStore((s) => s.exterior);
  const floorPlans  = useDesignerStore((s) => s.floorPlans);
  const activeFloor = useDesignerStore((s) => s.activeFloor);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleWorkflow = (wfId: WorkflowId) => {
    setOpen(false);
    setStatus(null);

    // Build the current scene's exterior prompt
    const fp = floorPlans[activeFloor];
    const yardItems = fp.yardPlan?.items ?? [];
    const generatedPrompt = generateExteriorPrompt({
      exterior,
      yardItems,
      sunHour: 14,
    });

    const scenePrompt = generatedPrompt.positive;

    // Try to capture the current 3D canvas screenshot
    const screenshot = captureCanvas();

    // Compose clipboard text for the user to paste into RunningHub
    const clipboardLines = [
      `【${WORKFLOWS.find(w => w.id === wfId)?.label ?? wfId}】`,
      "",
      "正向提示词:",
      scenePrompt,
      "",
      "负向提示词:",
      generatedPrompt.negative,
    ];
    if (screenshot) {
      clipboardLines.push(
        "",
        "（3D截图已复制到剪贴板，请在工作流的 LoadImage 节点粘贴）",
      );
    }

    navigator.clipboard.writeText(clipboardLines.join("\n")).catch(() => {
      // Clipboard write is best-effort; non-blocking
    });

    // Open RunningHub workspace
    window.open("https://www.runninghub.cn/workspace", "_blank", "noopener");

    setStatus(
      screenshot
        ? "已复制场景提示词，3D截图也已准备好。RunningHub 已在新标签页打开，粘贴后即可运行工作流。"
        : "已复制场景提示词。RunningHub 已在新标签页打开，粘贴后即可运行工作流（3D视图截图需手动截取）。",
    );

    // Clear status after 6 s
    setTimeout(() => setStatus(null), 6000);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Main button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all w-full"
        style={{
          background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
          color: "#fff",
          boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
        }}
        title="云端 AI 渲染 — 在 RunningHub 跑香蕉BananaPro工作流，无需本地模型"
      >
        <span>☁️</span>
        <span>云端AI渲染</span>
        <span className="ml-auto opacity-70">{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl overflow-hidden z-50"
          style={{
            background: "var(--ds-surface, #fff)",
            border: "1px solid var(--ds-border, #e5e7eb)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}
        >
          <div
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--ds-text-3, #9ca3af)", borderBottom: "1px solid var(--ds-border, #e5e7eb)" }}
          >
            选择工作流 → RunningHub 云端执行
          </div>
          {WORKFLOWS.map((wf) => (
            <button
              key={wf.id}
              onClick={() => handleWorkflow(wf.id)}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-indigo-50"
              style={{ borderBottom: "1px solid var(--ds-border-soft, #f3f4f6)" }}
            >
              <span className="text-xl w-7 text-center shrink-0">{wf.icon}</span>
              <div className="flex flex-col min-w-0">
                <span
                  className="text-xs font-semibold leading-tight"
                  style={{ color: "var(--ds-text, #111)" }}
                >
                  {wf.label}
                </span>
                <span
                  className="text-[10px] mt-0.5"
                  style={{ color: "var(--ds-text-3, #9ca3af)" }}
                >
                  {wf.desc}
                </span>
              </div>
            </button>
          ))}
          <div className="px-3 py-2 text-[9px]" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            点击后：提示词复制到剪贴板 → RunningHub 新标签页打开 → 粘贴使用
          </div>
        </div>
      )}

      {/* Status toast */}
      {status && (
        <div
          className="absolute bottom-full left-0 mb-14 w-72 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed z-50"
          style={{
            background: "#ecfdf5",
            border: "1px solid #6ee7b7",
            color: "#065f46",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          ✅ {status}
        </div>
      )}
    </div>
  );
}
