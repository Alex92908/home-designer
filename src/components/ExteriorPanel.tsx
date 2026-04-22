"use client";

import { useDesignerStore } from "@/lib/store";
import type { RoofStyle, WallMaterialType } from "@/lib/types";
import { useT } from "@/lib/i18n";

// NOTE: Exterior wall decor (壁灯/门牌/信箱/爬藤…) lives per-room and is
// edited via RightPanel while in room view, not here. See
// `src/components/RightPanel.tsx::ExteriorDecorSection`.

// ─── Presets ────────────────────────────────────────────────
const PRESETS: {
  id: string; label: string; icon: string;
  roofStyle: RoofStyle; roofColor: string;
  wallMaterial: WallMaterialType; wallColor: string; accentColor: string;
}[] = [
  { id:"modern",        label:"现代简约", icon:"🏢", roofStyle:"flat",    roofColor:"#3A3A3A", wallMaterial:"render",   wallColor:"#F2EEE6", accentColor:"#2A2A2A" },
  { id:"mediterranean", label:"地中海",   icon:"🏛️", roofStyle:"hip",     roofColor:"#B83820", wallMaterial:"render",   wallColor:"#FFF8E8", accentColor:"#9B6B3A" },
  { id:"chinese",       label:"中式传统", icon:"🏯", roofStyle:"chinese", roofColor:"#1E2238", wallMaterial:"render",   wallColor:"#F0E8D0", accentColor:"#882020" },
  { id:"european",      label:"欧式古典", icon:"🏰", roofStyle:"mansard", roofColor:"#4A5870", wallMaterial:"brick",    wallColor:"#E8D8C0", accentColor:"#7A7050" },
  { id:"industrial",    label:"工业风",   icon:"🏗️", roofStyle:"gable",   roofColor:"#3C4848", wallMaterial:"concrete", wallColor:"#787878", accentColor:"#E84000" },
  { id:"japanese",      label:"日式和风", icon:"⛩️", roofStyle:"chinese", roofColor:"#181818", wallMaterial:"wood",     wallColor:"#F0EDE8", accentColor:"#282828" },
  { id:"modern_villa",  label:"现代别墅", icon:"🏡", roofStyle:"gable",   roofColor:"#2A4060", wallMaterial:"render",   wallColor:"#FFFFFF", accentColor:"#2A4060" },
  { id:"rustic",        label:"乡村田园", icon:"🌾", roofStyle:"hip",     roofColor:"#6B4820", wallMaterial:"wood",     wallColor:"#D4B880", accentColor:"#5A3818" },
];

const ROOF_STYLES: { id: RoofStyle; label: string; icon: string; desc: string }[] = [
  { id:"flat",    label:"平屋顶", icon:"▬",  desc:"现代简约" },
  { id:"gable",   label:"两坡顶", icon:"🔺", desc:"经典通用" },
  { id:"hip",     label:"四坡顶", icon:"◆",  desc:"稳重大气" },
  { id:"mansard", label:"法式顶", icon:"🏛️", desc:"欧式古典" },
  { id:"chinese", label:"中式顶", icon:"⛩️", desc:"飞檐翘角" },
];

const WALL_MATERIALS: { id: WallMaterialType; label: string; color: string; desc: string }[] = [
  { id:"render",   label:"涂料", color:"#F5F0E8", desc:"光滑抹灰" },
  { id:"brick",    label:"砖墙", color:"#C87050", desc:"质朴温暖" },
  { id:"stone",    label:"石材", color:"#9A9280", desc:"厚重自然" },
  { id:"wood",     label:"木饰", color:"#9A6A3A", desc:"温润亲切" },
  { id:"concrete", label:"清水", color:"#888888", desc:"硬核极简" },
];

const YARD_PRESETS: { id: "minimal" | "garden" | "pool" | "full"; label: string; icon: string; desc: string }[] = [
  { id:"minimal", label:"极简",   icon:"🌿", desc:"路径+花台" },
  { id:"garden",  label:"花园",   icon:"🌸", desc:"花圃+喷泉" },
  { id:"pool",    label:"泳池",   icon:"🏊", desc:"泳池+棕榈" },
  { id:"full",    label:"豪华",   icon:"🏆", desc:"泳池+凉亭+喷泉" },
];

// ─── Color swatch ────────────────────────────────────────────
function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer shrink-0" />
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className="text-[10px] font-mono text-gray-300">{value}</span>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────
export default function ExteriorPanel() {
  const exterior    = useDesignerStore(s => s.exterior);
  const setExterior = useDesignerStore(s => s.setExterior);
  const t = useT();

  const hasMovedOutdoor = Object.keys(exterior.outdoorPositions ?? {}).length > 0;
  const resetOutdoorPositions = () => setExterior({ outdoorPositions: {} });

  const applyPreset = (p: typeof PRESETS[0]) => {
    setExterior({
      preset: p.id,
      roofStyle: p.roofStyle,
      roofColor: p.roofColor,
      wallMaterial: p.wallMaterial,
      wallColor: p.wallColor,
      accentColor: p.accentColor,
    });
  };

  return (
    <aside className="w-64 shrink-0 h-full bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
        <div className="text-xs font-black text-gray-800">{t.extTitle}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {exterior.floors} {t.extFloorUnit} · {t.extRoofLabels[exterior.roofStyle] ?? exterior.roofStyle}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Style presets ── */}
        <div className="px-3 pt-3">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extPresets}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p)}
                className={`relative flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border-2 text-center transition-all ${
                  exterior.preset === p.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-transparent bg-gray-50 hover:border-gray-200"
                }`}>
                <div className="w-full h-6 rounded-lg flex overflow-hidden gap-px mb-0.5">
                  <div className="flex-1" style={{ background: p.wallColor }} />
                  <div className="w-5"   style={{ background: p.roofColor }} />
                  <div className="w-3"   style={{ background: p.accentColor }} />
                </div>
                <span className="text-sm leading-none">{p.icon}</span>
                <span className="text-[10px] font-semibold text-gray-700 leading-tight">{t.extPresetLabels[p.id] ?? p.label}</span>
                {exterior.preset === p.id && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-[7px]">✓</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Floors ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extFloors}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setExterior({ preset: "custom", floors: Math.max(1, exterior.floors - 1) })}
              className="w-8 h-8 rounded-xl border border-gray-200 text-gray-600 font-bold hover:border-blue-400 hover:text-blue-600 transition-colors">−</button>
            <div className="flex-1 text-center">
              <span className="text-2xl font-black text-gray-800">{exterior.floors}</span>
              <span className="text-xs text-gray-400 ml-1">{t.extFloorUnit}</span>
            </div>
            <button onClick={() => setExterior({ preset: "custom", floors: Math.min(6, exterior.floors + 1) })}
              className="w-8 h-8 rounded-xl border border-gray-200 text-gray-600 font-bold hover:border-blue-400 hover:text-blue-600 transition-colors">＋</button>
          </div>
          <div className="flex gap-1 mt-2">
            {[1,2,3,4,5,6].map(n => (
              <button key={n} onClick={() => setExterior({ preset: "custom", floors: n })}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-colors ${
                  exterior.floors === n ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}>{n}</button>
            ))}
          </div>
        </div>

        {/* ── Roof style ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extRoofStyle}</div>
          <div className="flex flex-col gap-1">
            {ROOF_STYLES.map(r => (
              <button key={r.id}
                onClick={() => setExterior({ preset: "custom", roofStyle: r.id })}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${
                  exterior.roofStyle === r.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-100 hover:border-gray-200 bg-gray-50"
                }`}>
                <span className="text-lg w-6 text-center">{r.icon}</span>
                <span className="flex-1 text-xs font-semibold text-gray-700">{t.extRoofLabels[r.id] ?? r.label}</span>
                <span className="text-[10px] text-gray-400">{t.extRoofDescs[r.id] ?? r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Wall material ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extWallMaterial}</div>
          <div className="grid grid-cols-5 gap-1">
            {WALL_MATERIALS.map(m => (
              <button key={m.id} onClick={() => setExterior({ preset: "custom", wallMaterial: m.id })}
                title={m.desc}
                className={`flex flex-col items-center gap-1 py-1.5 rounded-xl border-2 transition-all ${
                  exterior.wallMaterial === m.id
                    ? "border-blue-500"
                    : "border-transparent hover:border-gray-200"
                }`}>
                <div className="w-7 h-7 rounded-lg border border-gray-200" style={{ background: m.color }} />
                <span className="text-[9px] text-gray-600 font-medium">{t.extWallLabels[m.id] ?? m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Colors ── */}
        <div className="px-3 pt-4 flex flex-col gap-3">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t.extColors}</div>
          <ColorSwatch label={t.extWallColor} value={exterior.wallColor}
            onChange={v => setExterior({ preset: "custom", wallColor: v })} />
          <ColorSwatch label={t.extRoofColor} value={exterior.roofColor}
            onChange={v => setExterior({ preset: "custom", roofColor: v })} />
          <ColorSwatch label={t.extAccentColor} value={exterior.accentColor}
            onChange={v => setExterior({ preset: "custom", accentColor: v })} />
        </div>

        {/* ── Yard presets ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extYardPreset}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {YARD_PRESETS.map(y => (
              <button key={y.id}
                onClick={() => setExterior({ yardPreset: y.id })}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border-2 text-center transition-all ${
                  (exterior.yardPreset ?? "garden") === y.id
                    ? "border-green-500 bg-green-50"
                    : "border-transparent bg-gray-50 hover:border-gray-200"
                }`}>
                <span className="text-xl">{y.icon}</span>
                <span className="text-[10px] font-semibold text-gray-700">{t.extYardLabels[y.id] ?? y.label}</span>
                <span className="text-[9px] text-gray-400">{t.extYardDescs[y.id] ?? y.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Drag hint + reset ── */}
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl" style={{ background: "#EBF5FF", border: "1px solid #CCE4FF" }}>
          <div className="text-[10px] font-bold mb-0.5" style={{ color: "#0055B3" }}>
            🖱️ {t.extDragHint ?? "Drag outdoor elements to reposition"}
          </div>
          <div className="text-[9px]" style={{ color: "#3B82C4" }}>
            {t.extDragDesc ?? "Hover pool / pergola / kitchen / fountain to grab & move"}
          </div>
          {hasMovedOutdoor && (
            <button
              onClick={resetOutdoorPositions}
              className="mt-1.5 text-[9px] font-semibold px-2 py-0.5 rounded-md transition-all"
              style={{ background: "#DBEAFE", color: "#1D4ED8", border: "1px solid #93C5FD" }}
            >
              ↺ {t.extResetPositions ?? "Reset positions"}
            </button>
          )}
        </div>

        {/* ── Parking & Driveway ── */}
        <div className="px-3 pt-4 pb-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">{t.extParking}</div>
          <button
            onClick={() => setExterior({ showParking: !exterior.showParking })}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all ${
              exterior.showParking
                ? "border-blue-500 bg-blue-50"
                : "border-gray-100 bg-gray-50 hover:border-gray-200"
            }`}
          >
            <span className="text-lg">🚗</span>
            <div className="flex-1 text-left">
              <div className="text-xs font-semibold text-gray-700">{t.extParking}</div>
              <div className="text-[9px] text-gray-400">{t.extParkingDesc}</div>
            </div>
            <div className={`w-8 h-4 rounded-full transition-colors ${exterior.showParking ? "bg-blue-500" : "bg-gray-200"}`}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full mt-0.25 transition-transform shadow ${exterior.showParking ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
          </button>
        </div>
      </div>
    </aside>
  );
}
