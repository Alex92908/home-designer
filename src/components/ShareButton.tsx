"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { buildShareUrl, type ViewSnapshot } from "@/lib/shareUrl";

type CopyState = "idle" | "copying" | "done" | "error";

export default function ShareButton() {
  const [state, setState] = useState<CopyState>("idle");

  const exterior    = useDesignerStore(s => s.exterior);
  const floorPlans  = useDesignerStore(s => s.floorPlans);

  const handleShare = async () => {
    if (state === "copying") return;
    setState("copying");

    try {
      // Build a lean snapshot — strip interior furniture (placedItems) to
      // keep the URL short. The view page only needs exterior + yard + dims.
      const floors: ViewSnapshot["floors"] = floorPlans.map(fp => ({
        enabledRooms: fp.enabledRooms,
        roomLayout: fp.roomLayout,
        roomDimensions: fp.roomDimensions,
        roomShapes: fp.roomShapes as Record<string, unknown> | undefined,
        yardPlan: fp.yardPlan,
      }));

      const snapshot: ViewSnapshot = { v: 1, exterior, floors };
      const url = await buildShareUrl(snapshot);

      await navigator.clipboard.writeText(url);
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      console.error("[ShareButton] failed:", err);
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };

  const labels: Record<CopyState, string> = {
    idle:    "🔗 分享",
    copying: "⏳",
    done:    "✅ 链接已复制",
    error:   "❌ 复制失败",
  };

  return (
    <button
      onClick={handleShare}
      disabled={state === "copying"}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all shrink-0"
      style={{
        border: state === "done"
          ? "1px solid #34D399"
          : "1px solid var(--ds-border)",
        color: state === "done"
          ? "#059669"
          : "var(--ds-text-2)",
        background: state === "done"
          ? "#ECFDF5"
          : "var(--ds-surface)",
      }}
      title="生成分享链接并复制到剪贴板"
    >
      {labels[state]}
    </button>
  );
}
