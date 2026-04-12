"use client";

import dynamic from "next/dynamic";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import ExteriorPanel from "@/components/ExteriorPanel";
import TopBar from "@/components/TopBar";
import ExportModal from "@/components/ExportModal";
import FloorPlan from "@/components/FloorPlan";
import FloorPlanAll from "@/components/FloorPlanAll";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

const RoomCanvas = dynamic(() => import("@/components/RoomCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-gray-900 w-full h-full">
      <div className="text-gray-400 text-sm animate-pulse">加载3D场景...</div>
    </div>
  ),
});

const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-gray-900 w-full h-full">
      <div className="text-gray-400 text-sm animate-pulse">加载外观场景...</div>
    </div>
  ),
});

export default function Home() {
  const viewMode = useDesignerStore((s) => s.viewMode);
  const t = useT();
  const isAll      = viewMode === "all";
  const isExterior = viewMode === "exterior";
  const is3d       = viewMode === "3d";
  const is2d       = viewMode === "2d";

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {!isAll && !isExterior && <LeftPanel />}
        <main className="flex-1 relative overflow-hidden">
          {is3d       && <RoomCanvas />}
          {isExterior && <HouseCanvas />}
          {isAll      && <FloorPlanAll />}
          {is2d       && <FloorPlan />}
        </main>
        {!isAll && !isExterior && <RightPanel />}
        {isExterior && <ExteriorPanel />}
      </div>
      <ExportModal />
      <footer className="h-6 bg-white border-t border-gray-100 flex items-center justify-center shrink-0">
        <span className="text-[10px] text-gray-400">{t.disclaimer}</span>
      </footer>
    </div>
  );
}
