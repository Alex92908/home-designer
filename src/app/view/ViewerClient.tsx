"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { decodeSnapshot, type ViewSnapshot } from "@/lib/shareUrl";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

// Lazy-load the heavy 3D canvas
const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => <CanvasLoading />,
});

function CanvasLoading() {
  const t = useT();
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
      {t.viewer.rendering}
    </div>
  );
}

// ─── Status screens ───────────────────────────────────────────────────────────
function ErrorScreen() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 gap-4">
      <div className="text-5xl">😞</div>
      <div className="text-gray-300 font-semibold">{t.viewer.errorTitle}</div>
      <div className="text-gray-500 text-sm">{t.viewer.errorDesc}</div>
      <a
        href="/"
        className="mt-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
        style={{ background: "#007AFF" }}
      >
        {t.viewer.goToDesigner}
      </a>
    </div>
  );
}

// ─── Main viewer ──────────────────────────────────────────────────────────────
export default function ViewerClient() {
  const t = useT();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(null);

  // Store setters
  const setExterior  = useDesignerStore(s => s.setExterior);
  const setViewMode  = useDesignerStore(s => s.setViewMode);
  const setActiveFloor = useDesignerStore(s => s.setActiveFloor);

  useEffect(() => {
    const encoded = searchParams.get("d");
    if (!encoded) { setStatus("error"); return; }

    decodeSnapshot(encoded)
      .then(data => {
        setSnapshot(data);

        // ── Hydrate the store with shared state ──
        setExterior(data.exterior);
        setViewMode("exterior");
        setActiveFloor(0);

        // Restore yard plan into floor 0 via store internals
        if (data.floors[0]?.yardPlan) {
          // Replace yardPlan items by directly patching the store
          useDesignerStore.setState(s => {
            const plans = [...s.floorPlans];
            plans[0] = {
              ...plans[0],
              yardPlan: data.floors[0].yardPlan,
              enabledRooms: (data.floors[0].enabledRooms as never[]) ?? plans[0].enabledRooms,
              roomLayout: (data.floors[0].roomLayout as never) ?? plans[0].roomLayout,
              roomDimensions: (data.floors[0].roomDimensions as never) ?? plans[0].roomDimensions,
            };
            return { floorPlans: plans };
          });
        }

        setStatus("ready");
      })
      .catch(err => {
        console.error("[ViewerClient] decode failed:", err);
        setStatus("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
        {t.viewer.parsing}
      </div>
    );
  }
  if (status === "error") return <ErrorScreen />;

  const encodedParam = searchParams.get("d") ?? "";
  const editorUrl = `/?loadView=${encodedParam}`;

  return (
    <div className="relative h-screen bg-gray-900 overflow-hidden">
      {/* ── Top banner ── */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2.5"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Logo + badge */}
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center text-sm shrink-0"
            style={{ background: "#007AFF" }}
          >
            🏠
          </div>
          <span className="text-white text-sm font-semibold tracking-tight">{t.viewer.appName}</span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)" }}
          >
            {t.viewer.readOnly}
          </span>
          {snapshot?.name && (
            <span className="text-white/70 text-xs ml-1">· {snapshot.name}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {t.viewer.designerHome}
          </a>
          <a
            href={editorUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
          >
            {t.viewer.editInDesigner}
          </a>
        </div>
      </div>

      {/* ── 3D Canvas ── */}
      <HouseCanvas />

      {/* ── Bottom info strip ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-3 px-4 py-2"
        style={{
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="text-gray-400 text-[11px]">
          {snapshot?.exterior.floors ?? 1} {t.viewer.floors} ·{" "}
          {snapshot?.exterior.roofStyle ?? ""} {t.viewer.roof} ·{" "}
          {snapshot?.exterior.wallMaterial ?? ""}
        </span>
        <span className="text-gray-600 text-[11px]">{t.viewer.dragRotate}</span>
      </div>
    </div>
  );
}
