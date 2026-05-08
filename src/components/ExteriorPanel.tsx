"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import type { RoofStyle, WallMaterialType, WallZone } from "@/lib/types";
import { useT } from "@/lib/i18n";
import CloudRenderButton from "./CloudRenderButton";
import DesignVariants from "./DesignVariants";
import { PROJECT_TEMPLATES } from "@/lib/projectTemplates";
import FacadeEditor from "./FacadeEditor";
import type { FaceName } from "./FacadeEditor";

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

// ─── Exterior wall material catalog ─────────────────────────
// Much richer than the old 5-button strip.
// Each entry: visual card with gradient thumbnail + click to apply.
interface ExtMat {
  id: string;          // unique key
  label: string;
  type: WallMaterialType;
  color: string;       // primary display color
  thumb: string;       // CSS background for the thumbnail strip
  desc: string;
}
const EXT_MATERIALS: ExtMat[] = [
  // ── 涂料 (render / painted plaster) ──────────────────────
  { id:"render-cream",   label:"奶油涂料",   type:"render",   color:"#F5F0E8", thumb:"linear-gradient(135deg,#F9F5EF,#EDE5D8)", desc:"经典暖白，百搭" },
  { id:"render-white",   label:"纯白涂料",   type:"render",   color:"#FFFFFF", thumb:"linear-gradient(135deg,#FFFFFF,#E8E8E8)", desc:"极简纯白" },
  { id:"render-gray",    label:"浅灰涂料",   type:"render",   color:"#D8D5CF", thumb:"linear-gradient(135deg,#E0DDD8,#C8C5BF)", desc:"中性高级灰" },
  { id:"render-warm",    label:"杏仁色",     type:"render",   color:"#EDD9B4", thumb:"linear-gradient(135deg,#F2E4C2,#D8C498)", desc:"温暖地中海" },
  { id:"render-terra",   label:"赭石涂料",   type:"render",   color:"#C47850", thumb:"linear-gradient(135deg,#D08560,#A86040)", desc:"热带橙赭" },
  { id:"render-moss",    label:"苔绿涂料",   type:"render",   color:"#7A9870", thumb:"linear-gradient(135deg,#8AAA80,#6A8860)", desc:"自然气息" },
  // ── 砖墙 (brick) ─────────────────────────────────────────
  { id:"brick-red",      label:"红砖",       type:"brick",    color:"#B05030", thumb:"repeating-linear-gradient(0deg,#B05030 0,#B05030 8px,#D0A080 8px,#D0A080 10px),repeating-linear-gradient(90deg,transparent 0,transparent 24px,#D0A080 24px,#D0A080 26px)", desc:"传统清水红砖" },
  { id:"brick-white",    label:"白砖",       type:"brick",    color:"#E8E4DF", thumb:"repeating-linear-gradient(0deg,#DDD9D4 0,#DDD9D4 8px,#F5F2EE 8px,#F5F2EE 10px),repeating-linear-gradient(90deg,transparent 0,transparent 24px,#F5F2EE 24px,#F5F2EE 26px)", desc:"清爽白色砖墙" },
  { id:"brick-charcoal", label:"深灰砖",     type:"brick",    color:"#4A4A48", thumb:"repeating-linear-gradient(0deg,#3C3C3A 0,#3C3C3A 8px,#5C5C58 8px,#5C5C58 10px)", desc:"现代工业暗砖" },
  { id:"brick-aged",     label:"仿古砖",     type:"brick",    color:"#8C6040", thumb:"repeating-linear-gradient(0deg,#7C5030 0,#7C5030 8px,#A07850 8px,#A07850 10px)", desc:"做旧质感" },
  // ── 石材 (stone) ─────────────────────────────────────────
  { id:"stone-sand",     label:"砂岩",       type:"stone",    color:"#D4C4A0", thumb:"linear-gradient(135deg,#D8C8A8 25%,#C8B890 50%,#D4C4A0 75%)", desc:"自然砂岩" },
  { id:"stone-slate",    label:"板岩",       type:"stone",    color:"#787870", thumb:"linear-gradient(120deg,#707068 20%,#606058 40%,#888880 60%,#686860 80%)", desc:"深灰板岩" },
  { id:"stone-marble",   label:"大理石",     type:"stone",    color:"#EEEAE4", thumb:"linear-gradient(135deg,#F5F2EC,#E0DCD4,#F2EEEA)", desc:"高贵白大理石" },
  { id:"stone-granite",  label:"花岗岩",     type:"stone",    color:"#9A9088", thumb:"linear-gradient(135deg,#A09890 20%,#888078 50%,#9C9088 80%)", desc:"厚重花岗岩" },
  // ── 木饰面 (wood) ─────────────────────────────────────────
  { id:"wood-cedar",     label:"雪松木",     type:"wood",     color:"#A06030", thumb:"repeating-linear-gradient(90deg,#A06030 0,#A06030 18px,#8A5028 18px,#8A5028 20px)", desc:"竖纹深棕雪松" },
  { id:"wood-pine",      label:"浅松木",     type:"wood",     color:"#D4A870", thumb:"repeating-linear-gradient(90deg,#D4A870 0,#D4A870 18px,#C09050 18px,#C09050 20px)", desc:"温润浅松" },
  { id:"wood-dark",      label:"碳化木",     type:"wood",     color:"#3C2818", thumb:"repeating-linear-gradient(90deg,#3C2818 0,#3C2818 18px,#2C1808 18px,#2C1808 20px)", desc:"日式碳化深棕" },
  // ── 清水混凝土 (concrete) ──────────────────────────────────
  { id:"concrete-smooth",label:"光面清水",   type:"concrete", color:"#909090", thumb:"linear-gradient(135deg,#969696,#808080,#949494)", desc:"极简光面混凝土" },
  { id:"concrete-board", label:"木纹清水",   type:"concrete", color:"#7C7870", thumb:"repeating-linear-gradient(0deg,#7C7870 0,#7C7870 14px,#6C6860 14px,#6C6860 16px)", desc:"木模板纹理" },
  { id:"concrete-raw",   label:"毛面混凝土", type:"concrete", color:"#666462", thumb:"linear-gradient(135deg,#706E6A 10%,#5C5A58 40%,#6E6C68 70%)", desc:"粗犷工业感" },
];

// ─── Combination / multi-zone wall presets ──────────────────
interface ComboPreset {
  id: string;
  label: string;
  icon: string;
  desc: string;
  zones: WallZone[];
  /** CSS gradient for the thumbnail strip (bottom→top) */
  thumb: string;
}

const COMBO_PRESETS: ComboPreset[] = [
  {
    id: "brick-glass",
    label: "砖+玻璃",
    icon: "🧱",
    desc: "砖石底部 + 落地玻璃幕墙",
    thumb: "linear-gradient(to top, #B05030 0%, #B05030 40%, #CBE8F5 40%, #CBE8F5 100%)",
    zones: [
      { material: "brick",  color: "#B05030", heightFraction: 0.40 },
      { material: "glass",  color: "#CBE8F5", heightFraction: 0.60 },
    ],
  },
  {
    id: "brick-wood",
    label: "砖+木饰面",
    icon: "🪵",
    desc: "红砖基座 + 雪松木挂板",
    thumb: "linear-gradient(to top, #B05030 0%, #B05030 35%, #A06030 35%, #A06030 100%)",
    zones: [
      { material: "brick", color: "#B05030", heightFraction: 0.35 },
      { material: "wood",  color: "#A06030", heightFraction: 0.65 },
    ],
  },
  {
    id: "stone-glass",
    label: "石材+玻璃",
    icon: "💎",
    desc: "毛石基础 + 玻璃上墙",
    thumb: "linear-gradient(to top, #9A9088 0%, #9A9088 45%, #CBE8F5 45%, #CBE8F5 100%)",
    zones: [
      { material: "stone", color: "#9A9088", heightFraction: 0.45 },
      { material: "glass", color: "#CBE8F5", heightFraction: 0.55 },
    ],
  },
  {
    id: "stone-wood",
    label: "石材+木",
    icon: "🏡",
    desc: "花岗岩基座 + 松木挂板",
    thumb: "linear-gradient(to top, #787870 0%, #787870 45%, #D4A870 45%, #D4A870 100%)",
    zones: [
      { material: "stone", color: "#787870", heightFraction: 0.45 },
      { material: "wood",  color: "#D4A870", heightFraction: 0.55 },
    ],
  },
  {
    id: "concrete-glass",
    label: "混凝土+玻璃",
    icon: "🏢",
    desc: "清水混凝土 + 玻璃幕墙",
    thumb: "linear-gradient(to top, #909090 0%, #909090 50%, #CBE8F5 50%, #CBE8F5 100%)",
    zones: [
      { material: "concrete", color: "#909090", heightFraction: 0.50 },
      { material: "glass",    color: "#CBE8F5", heightFraction: 0.50 },
    ],
  },
  {
    id: "render-stone",
    label: "涂料+石材",
    icon: "🏛️",
    desc: "地中海涂料 + 石材基座",
    thumb: "linear-gradient(to top, #D4C4A0 0%, #D4C4A0 30%, #FFF8E8 30%, #FFF8E8 100%)",
    zones: [
      { material: "stone",  color: "#D4C4A0", heightFraction: 0.30 },
      { material: "render", color: "#FFF8E8", heightFraction: 0.70 },
    ],
  },
  {
    id: "wood-house",
    label: "全木屋",
    icon: "🌲",
    desc: "全外墙木饰面 · 日式/田园",
    thumb: "repeating-linear-gradient(90deg,#A06030 0,#A06030 14px,#8A5028 14px,#8A5028 16px)",
    zones: [
      { material: "wood", color: "#A06030", heightFraction: 1.0 },
    ],
  },
  {
    id: "full-glass",
    label: "全玻璃",
    icon: "🔮",
    desc: "四面通透玻璃幕墙 · 现代极简",
    thumb: "linear-gradient(135deg, #CBE8F5 0%, #9DC8E8 50%, #CBE8F5 100%)",
    zones: [
      { material: "glass", color: "#CBE8F5", heightFraction: 1.0 },
    ],
  },
  {
    id: "brick-render-wood",
    label: "三段式",
    icon: "🏗️",
    desc: "砖基 + 涂料中段 + 木饰上部",
    thumb: "linear-gradient(to top, #B05030 0%, #B05030 25%, #F5F0E8 25%, #F5F0E8 65%, #A06030 65%, #A06030 100%)",
    zones: [
      { material: "brick",  color: "#B05030", heightFraction: 0.25 },
      { material: "render", color: "#F5F0E8", heightFraction: 0.40 },
      { material: "wood",   color: "#A06030", heightFraction: 0.35 },
    ],
  },
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

type WallFace = "front" | "back" | "left" | "right";
const FACE_LABELS: Record<WallFace, string> = { front:"前墙", back:"后墙", left:"左墙", right:"右墙" };

// ─── Main panel ──────────────────────────────────────────────
export default function ExteriorPanel() {
  const exterior              = useDesignerStore(s => s.exterior);
  const setExterior           = useDesignerStore(s => s.setExterior);
  const applyProjectTemplate  = useDesignerStore(s => s.applyProjectTemplate);
  const viewMode              = useDesignerStore(s => s.viewMode);
  const setViewMode           = useDesignerStore(s => s.setViewMode);
  const t = useT();

  // "分面材质" mode — which face is currently selected for per-face editing
  const [perFaceEnabled, setPerFaceEnabled] = useState(
    !!(exterior.faceMaterials && Object.keys(exterior.faceMaterials).length > 0)
  );
  const [activeFace, setActiveFace] = useState<WallFace>("front");
  const [activeFacadeFace, setActiveFacadeFace] = useState<FaceName>("front");

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
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 text-xs font-black text-gray-800">{t.extTitle}</div>
          {/* Back to floor plan */}
          <button
            onClick={() => setViewMode("all")}
            className="text-[9px] px-2 py-0.5 rounded-full"
            style={{ background: "#EEF2FF", color: "#4F46E5" }}
            title="回到全局平面图"
          >
            ← 全局图
          </button>
        </div>
        <div className="text-[10px] text-gray-400 mb-2">
          {exterior.floors} {t.extFloorUnit} · {t.extRoofLabels[exterior.roofStyle] ?? exterior.roofStyle}
        </div>
        {/* Sub-mode toggle: 3D外观 vs 2D院子 */}
        <div className="flex gap-1 p-0.5 rounded-xl" style={{ background: "#F3F4F6" }}>
          <button
            onClick={() => setViewMode("exterior")}
            className="flex-1 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={viewMode === "exterior" || viewMode === "global3d"
              ? { background: "#fff", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
              : { color: "#6B7280" }}
          >
            🏠 3D外观
          </button>
          <button
            onClick={() => setViewMode("yard2d")}
            className="flex-1 py-1 rounded-lg text-[10px] font-bold transition-all"
            style={viewMode === "yard2d"
              ? { background: "#fff", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
              : { color: "#6B7280" }}
          >
            🌿 2D院子
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── 项目模板 — one-click full villa setup ── */}
        <div className="px-3 pt-3">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            ✨ 项目模板
          </div>
          <div className="flex flex-col gap-1.5">
            {PROJECT_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => applyProjectTemplate(tpl.id)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all hover:shadow-sm active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.8), rgba(245,242,238,0.6))",
                  border: "1px solid #E5E7EB",
                }}
              >
                {/* Color palette strip */}
                <div className="flex flex-col gap-px shrink-0">
                  <div className="w-5 h-5 rounded-lg overflow-hidden flex">
                    <div className="flex-1" style={{ background: tpl.palette[0] }} />
                    <div className="w-2"    style={{ background: tpl.palette[1] }} />
                    <div className="w-1.5"  style={{ background: tpl.palette[2] }} />
                  </div>
                </div>
                <span className="text-xl shrink-0">{tpl.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-gray-800 truncate">{tpl.name}</div>
                  <div className="text-[9px] text-gray-400 truncate">{tpl.description}</div>
                </div>
                <div className="text-[10px] font-bold text-gray-400 shrink-0">{tpl.areaSqm}㎡</div>
              </button>
            ))}
          </div>
          <div className="mt-1.5 mb-0.5 border-t border-gray-100" />
        </div>

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

        {/* ── 平面形状 ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">平面形状</div>
          <div className="grid grid-cols-4 gap-1">
            {(["rect","L","U","T"] as const).map(shape => {
              const icons = { rect:"□", L:"⌐", U:"⊔", T:"⊤" };
              return (
                <button key={shape}
                  onClick={() => setExterior({ footprintShape: shape })}
                  className={`py-1.5 rounded-xl border-2 text-sm font-bold transition-all ${
                    (exterior.footprintShape ?? "rect") === shape
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-transparent bg-gray-100 text-gray-600 hover:border-gray-300"
                  }`}>
                  {icons[shape]}
                </button>
              );
            })}
          </div>
          {(exterior.footprintShape && exterior.footprintShape !== "rect") && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-gray-500">翼比</span>
                <span className="font-mono text-gray-700">{((exterior.wingRatio ?? 0.5) * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0.3} max={0.7} step={0.05}
                value={exterior.wingRatio ?? 0.5}
                onChange={e => setExterior({ wingRatio: parseFloat(e.target.value) })}
                className="w-full accent-blue-500" />
            </div>
          )}
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

        {/* ── 外墙材质 — rich material catalog ── */}
        <div className="px-3 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">外墙材质</div>
            <button
              onClick={() => {
                const next = !perFaceEnabled;
                setPerFaceEnabled(next);
                if (next) {
                  // initialise all faces to current global material
                  setExterior({ faceMaterials: { front: exterior.wallColor, back: exterior.wallColor, left: exterior.wallColor, right: exterior.wallColor },
                    faceMaterialTypes: { front: exterior.wallMaterial, back: exterior.wallMaterial, left: exterior.wallMaterial, right: exterior.wallMaterial } });
                } else {
                  setExterior({ faceMaterials: {}, faceMaterialTypes: {} });
                }
              }}
              className="text-[9px] px-2 py-0.5 rounded-full transition-colors"
              style={perFaceEnabled
                ? { background: "#4F46E5", color: "#fff" }
                : { background: "#EEF2FF", color: "#4F46E5" }}
            >
              {perFaceEnabled ? "✓ 分面" : "分面"}
            </button>
          </div>

          {/* Per-face tab selector */}
          {perFaceEnabled && (
            <div className="flex gap-1 mb-2">
              {(["front","back","left","right"] as const).map(face => (
                <button key={face}
                  onClick={() => setActiveFace(face)}
                  className="flex-1 py-1 rounded-lg text-[9px] font-bold transition-colors"
                  style={activeFace === face
                    ? { background: "#4F46E5", color: "#fff" }
                    : { background: "#F3F4F6", color: "#6B7280" }}
                >
                  {FACE_LABELS[face]}
                </button>
              ))}
            </div>
          )}

          {/* Material catalog grid — either applies to all walls or the selected face */}
          <div className="grid grid-cols-3 gap-1.5">
            {EXT_MATERIALS.map(m => {
              const isSelected = perFaceEnabled
                ? (exterior.faceMaterials?.[activeFace] === m.color && (exterior.faceMaterialTypes?.[activeFace] ?? exterior.wallMaterial) === m.type)
                : (exterior.wallColor === m.color && exterior.wallMaterial === m.type);
              return (
                <button key={m.id}
                  title={m.desc}
                  onClick={() => {
                    if (perFaceEnabled) {
                      setExterior({
                        preset: "custom",
                        faceMaterials: { ...(exterior.faceMaterials ?? {}), [activeFace]: m.color },
                        faceMaterialTypes: { ...(exterior.faceMaterialTypes ?? {}), [activeFace]: m.type },
                      });
                    } else {
                      setExterior({ preset: "custom", wallMaterial: m.type, wallColor: m.color });
                    }
                  }}
                  className={`flex flex-col gap-1 p-1.5 rounded-xl border-2 transition-all text-left ${
                    isSelected ? "border-blue-500 shadow-sm" : "border-transparent hover:border-gray-200"
                  }`}
                >
                  {/* Texture thumbnail */}
                  <div className="w-full h-8 rounded-lg border border-gray-100"
                    style={{ background: m.thumb }} />
                  <div className="text-[9px] font-medium text-gray-700 leading-tight truncate">{m.label}</div>
                </button>
              );
            })}
          </div>

          {/* Fine-tune color for the current selection */}
          <div className="mt-3 flex flex-col gap-2">
            {perFaceEnabled ? (
              <div className="flex items-center gap-2">
                <input type="color"
                  value={exterior.faceMaterials?.[activeFace] ?? exterior.wallColor}
                  onChange={e => setExterior({ faceMaterials: { ...(exterior.faceMaterials ?? {}), [activeFace]: e.target.value } })}
                  className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer shrink-0" />
                <span className="text-[10px] text-gray-500">{FACE_LABELS[activeFace]}颜色微调</span>
                <span className="text-[10px] font-mono text-gray-300 ml-auto">
                  {exterior.faceMaterials?.[activeFace] ?? exterior.wallColor}
                </span>
              </div>
            ) : (
              <ColorSwatch label={t.extWallColor} value={exterior.wallColor}
                onChange={v => setExterior({ preset: "custom", wallColor: v })} />
            )}
            <ColorSwatch label={t.extRoofColor} value={exterior.roofColor}
              onChange={v => setExterior({ preset: "custom", roofColor: v })} />
            <ColorSwatch label={t.extAccentColor} value={exterior.accentColor}
              onChange={v => setExterior({ preset: "custom", accentColor: v })} />
          </div>
        </div>

        {/* ── 组合材质 — split-zone wall combos ── */}
        <div className="px-3 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">🎨 组合材质</div>
            {exterior.wallZones && (
              <button
                onClick={() => setExterior({ wallZones: undefined, faceZones: undefined })}
                className="text-[9px] px-2 py-0.5 rounded-full"
                style={{ background: "#FEF2F2", color: "#DC2626" }}
              >
                ✕ 清除组合
              </button>
            )}
          </div>
          <div className="text-[9px] text-gray-400 mb-2 leading-relaxed">
            上下分区墙面——砖+玻璃、石+木、木屋等，自由设计每种建筑风格
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {COMBO_PRESETS.map(cp => {
              const isActive = exterior.wallZones
                ? JSON.stringify(exterior.wallZones) === JSON.stringify(cp.zones)
                : false;
              return (
                <button key={cp.id}
                  title={cp.desc}
                  onClick={() => setExterior({
                    preset: "custom",
                    wallZones: cp.zones,
                    faceZones: undefined,
                    // For single-material combos, also set the legacy fields
                    ...(cp.zones.length === 1
                      ? { wallMaterial: cp.zones[0].material === "glass" ? "render" : cp.zones[0].material, wallColor: cp.zones[0].color }
                      : {}),
                  })}
                  className={`flex flex-col gap-1 p-1.5 rounded-xl border-2 transition-all text-left ${
                    isActive ? "border-blue-500 shadow-sm" : "border-transparent hover:border-gray-200"
                  }`}
                >
                  <div className="w-full h-10 rounded-lg border border-gray-100 relative overflow-hidden"
                    style={{ background: cp.thumb }} >
                    <span className="absolute bottom-0.5 right-1 text-sm drop-shadow">{cp.icon}</span>
                  </div>
                  <div className="text-[9px] font-medium text-gray-700 leading-tight">{cp.label}</div>
                </button>
              );
            })}
          </div>

          {/* Zone editor — shown when a multi-zone combo is active */}
          {exterior.wallZones && exterior.wallZones.length >= 2 && (
            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-2.5">
              <div className="text-[10px] font-bold text-amber-800 mb-2">📐 分区调整</div>
              {exterior.wallZones.map((zone, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-1.5">
                  <input type="color" value={zone.color}
                    onChange={e => {
                      const updated = exterior.wallZones!.map((z, i) =>
                        i === idx ? { ...z, color: e.target.value } : z
                      );
                      setExterior({ wallZones: updated });
                    }}
                    className="w-6 h-6 rounded border border-gray-200 cursor-pointer shrink-0" />
                  <span className="text-[9px] text-gray-600 w-12 shrink-0">
                    {zone.material === "glass" ? "玻璃" : zone.material === "brick" ? "砖" : zone.material === "stone" ? "石" : zone.material === "wood" ? "木" : zone.material === "concrete" ? "混凝土" : "涂料"}
                  </span>
                  <input type="range" min={0.1} max={0.9} step={0.05}
                    value={zone.heightFraction}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      // Adjust the other zone to compensate (for 2-zone combos)
                      const zones = [...exterior.wallZones!];
                      if (zones.length === 2) {
                        zones[idx] = { ...zones[idx], heightFraction: val };
                        zones[1 - idx] = { ...zones[1 - idx], heightFraction: Math.max(0.1, 1 - val) };
                      }
                      setExterior({ wallZones: zones });
                    }}
                    className="flex-1 accent-amber-500" />
                  <span className="text-[9px] font-mono text-gray-500 w-8 text-right shrink-0">
                    {(zone.heightFraction * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 🏗️ 立面设计 — component-by-component facade builder ── */}
        <div className="px-3 pt-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">🏗️ 立面设计</div>
            {exterior.facades && Object.keys(exterior.facades).length > 0 && (
              <button
                onClick={() => setExterior({ facades: undefined })}
                className="text-[9px] px-2 py-0.5 rounded-full"
                style={{ background: "#FEF2F2", color: "#DC2626" }}
              >✕ 全部清除</button>
            )}
          </div>
          <div className="text-[9px] text-gray-400 mb-2 leading-relaxed">
            一件一件搭——玻璃幕/实墙/柱/门窗自由组合
          </div>
          {/* Face selector */}
          <div className="flex gap-1 mb-3">
            {(["front","back","left","right"] as const).map(face => {
              const faceLabels = { front:"前", back:"后", left:"左", right:"右" };
              const hasFacade = !!exterior.facades?.[face]?.length;
              return (
                <button key={face}
                  onClick={() => setActiveFacadeFace(face)}
                  className="flex-1 py-1.5 rounded-xl text-[9px] font-bold transition-all relative"
                  style={activeFacadeFace === face
                    ? { background: "#4F46E5", color: "#fff" }
                    : { background: "#F3F4F6", color: "#6B7280" }}
                >
                  {faceLabels[face]}
                  {hasFacade && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-400" />
                  )}
                </button>
              );
            })}
          </div>
          {/* Facade editor for active face */}
          <FacadeEditor face={activeFacadeFace} floors={exterior.floors} />
        </div>

        {/* ── 院子布局 ── */}
        <div className="mx-3 mt-4">
          <button
            onClick={() => setViewMode("yard2d")}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all hover:shadow-sm active:scale-[0.98]"
            style={{ background: "#F0F7F0", border: "1px solid #BFE0C0" }}
          >
            <span className="text-xl">🌿</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold" style={{ color: "#1F6F1F" }}>2D 院子编辑器</div>
              <div className="text-[9px] leading-tight mt-0.5" style={{ color: "#3F783F" }}>
                泳池 / 凉亭 / 户外厨房 / 喷泉 拖拽布置
              </div>
            </div>
            <span className="text-[10px] font-bold" style={{ color: "#1F6F1F" }}>→</span>
          </button>
        </div>

        {/* ── 架空层 (Pilotis) ── */}
        <div className="px-3 pt-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">架空层 (PILOTIS)</div>
          <div className="px-1">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-gray-500">高度</span>
              <span className="font-mono text-gray-700">{(exterior.pilotisHeightM ?? 0).toFixed(2)} m</span>
            </div>
            <input type="range" min={0} max={4} step={0.1}
              value={exterior.pilotisHeightM ?? 0}
              onChange={e => setExterior({ pilotisHeightM: parseFloat(e.target.value) })}
              className="w-full accent-blue-500" />
            <div className="text-[9px] text-gray-400 mt-0.5">
              {(exterior.pilotisHeightM ?? 0) === 0
                ? "贴地 (slab on grade)"
                : "整栋抬升 + 4 根混凝土柱（柯布西耶 pilotis / 高脚屋 / 中式台基）"}
            </div>
          </div>
        </div>

        {/* ── 设计变体生成 ── */}
        <DesignVariants />

        {/* ── 云端AI渲染 ── */}
        <div className="px-3 pt-4 pb-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">云端 AI 渲染</div>
          <CloudRenderButton />
          <div className="text-[9px] text-gray-400 mt-2 leading-relaxed">
            无需本地模型。点击选择工作流后，提示词自动复制，RunningHub 云端页面在新标签页打开。
          </div>
        </div>

      </div>
    </aside>
  );
}
