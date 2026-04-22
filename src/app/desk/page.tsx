"use client";

/**
 * /desk — the Desk Setup experience.
 *
 * Positioned as a pivot experiment (see STRATEGY.md §5): narrow the catalog
 * to "桌搭" and lean into Buildcores-style real-time PBR rendering instead
 * of fixing up rough 3D with an AI render pass.
 *
 * Layout: left catalog panel + center 3D canvas + right inspector panel.
 * On mobile the panels collapse into bottom drawers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import CatalogPanel from "@/components/desk/CatalogPanel";
import InspectorPanel from "@/components/desk/InspectorPanel";
import { useDeskStore, STARTER_PRESETS } from "@/lib/desk/store";

// Canvas only runs in the browser — skip SSR to avoid Three.js window refs
const DeskScene = dynamic(() => import("@/components/desk/DeskScene"), { ssr: false });

export default function DeskPage() {
  const items      = useDeskStore(s => s.items);
  const loadPreset = useDeskStore(s => s.loadPreset);
  const setEnv     = useDeskStore(s => s.setEnv);

  // Seed the first-visit experience: if nothing is placed, drop the
  // "极简白" preset so user sees a beautiful scene immediately.
  useEffect(() => {
    if (items.length === 0) {
      const tpl = STARTER_PRESETS[0];
      setEnv(tpl.env);
      loadPreset(tpl.items);
    }
    // Intentionally only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile: panels slide in/out
  const [mobilePanel, setMobilePanel] = useState<"none" | "catalog" | "inspector">("none");

  return (
    <div className="fixed inset-0 flex bg-[#0a0a0c] text-gray-100 overflow-hidden">
      {/* Left catalog (desktop) */}
      <div className="hidden md:block h-full">
        <CatalogPanel />
      </div>

      {/* Center: canvas + top bar */}
      <div className="flex-1 relative flex flex-col">
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
          <Link
            href="/"
            className="text-[11px] text-gray-400 hover:text-gray-200 pointer-events-auto"
          >
            ← 返回
          </Link>
          <div className="flex-1" />
          <div className="pointer-events-auto text-right">
            <h1 className="text-[13px] font-bold tracking-wide">🪑 桌搭工作台</h1>
            <p className="text-[9.5px] text-gray-500 mt-0.5">
              实时 PBR · 所见即所得
            </p>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <DeskScene />
        </div>

        {/* Mobile bottom bar */}
        <div className="md:hidden absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-3 flex gap-2">
          <button
            onClick={() => setMobilePanel("catalog")}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-medium bg-gray-900/80 backdrop-blur border border-gray-800 text-gray-200"
          >
            ＋ 添加
          </button>
          <button
            onClick={() => setMobilePanel("inspector")}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-medium bg-gray-900/80 backdrop-blur border border-gray-800 text-gray-200"
          >
            ⚙ 调整
          </button>
        </div>
      </div>

      {/* Right inspector (desktop) */}
      <div className="hidden md:block h-full">
        <InspectorPanel />
      </div>

      {/* Mobile drawers */}
      {mobilePanel !== "none" && (
        <div
          className="md:hidden fixed inset-0 z-20 flex items-end bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setMobilePanel("none"); }}
        >
          <div className="w-full h-[72vh] bg-[#0f0f12] rounded-t-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
              <span className="text-[12px] font-medium">
                {mobilePanel === "catalog" ? "家具库" : "调整"}
              </span>
              <button
                onClick={() => setMobilePanel("none")}
                className="text-gray-400 w-7 h-7"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {mobilePanel === "catalog"  && <CatalogPanel />}
              {mobilePanel === "inspector" && <InspectorPanel />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
