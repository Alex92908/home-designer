"use client";

/**
 * YardPlan — outdoor 2D editor.
 *
 * The "FloorPlan" of the yard: user drops trees / plants / fences / features
 * onto a 2D top-down view of the property, and the Exterior 3D auto-renders
 * them as Kenney Nature Kit GLB assets in matching positions.
 *
 * Layout mirrors FloorPlan / FloorPlanAll:
 *   • Left rail (YardPlanLibrary)  — categorised draggable asset thumbnails.
 *   • Main canvas (this default)   — SVG top-down with house bounds + items.
 *
 * Coordinate system: world centimetres, origin = house geometric centre on
 * the ground plane. Same as the 3D Exterior view's PlacedItem coords. The
 * SVG zooms to fit a fixed property window (default 30m × 30m).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, type YardItem, type YardZone, type PrefabKind, isYardSingleton, isYardPrefab, isYardZone } from "@/lib/types";
import { OUTDOOR_ASSET_LIBRARY, OUTDOOR_CATEGORIES, getOutdoorAssetByKind, YARD_PRESETS, type OutdoorCategory } from "@/lib/outdoorAssets";
import { PREFAB_REGISTRY, getPrefabDef } from "@/lib/outdoorPrefabs";
import { ZONE_STYLES, polygonCentroid } from "@/lib/outdoorZones";
import { evaluateYardPlan, violationsByItem, getEmptyStateHints } from "@/lib/outdoorClearance";
import { autoGenerateYardPaths, houseHalfExtentsCm, clearYardItemsOfHouse } from "@/lib/yardAutoLayout";
import { EXTERIOR_PRESETS } from "@/lib/exteriorPresets";
import { autoScatterTrees, placeSunShadeTrees, TREE_CANOPY_RADIUS_M } from "@/lib/yardAutoPlanting";
import { useLocale } from "@/lib/i18n";
import { snapToHouseWall, checkHouseClearance } from "@/lib/sceneToPrompt";
import ModelImportCard from "./ModelImportCard";
import { getShadowPolygon } from "@/lib/sunAnalysis";
import { getOutdoorAssetByKind as _getAsset, PREFAB_PURCHASE } from "@/lib/outdoorAssets";

// ─── Constants ─────────────────────────────────────────────
// World window the SVG renders (cm, centred on origin)
const WIN_HALF_CM = 1500; // 30m × 30m visible area
const SVG_PX = 720;       // logical SVG pixel dimensions
const CM_PER_PX = (WIN_HALF_CM * 2) / SVG_PX;
const SNAP_CM = 25;       // snap drag positions to 25cm grid

// ─── Top-down asset symbols — TWO palette sets ─────────────────
// FloorPlan's actual design pattern is LIGHT chrome (white sidebar /
// toolbar / right panel) + DARK canvas (#0f1117 black SVG editing area).
// So we keep TWO palettes:
//   - INK / INK_LIGHT / FILL_LIGHT   → used INSIDE the SVG (dark canvas
//     background) — these stay light so they're legible on black.
//   - For chrome text (sidebar labels, tab buttons, card titles, headers)
//     we use explicit Tailwind text-gray-{500..900} classes — never the
//     constants below.
const INK = "#E8E8EC";                       // SVG glyph stroke — near-white
const INK_LIGHT = "rgba(232,232,236,0.45)";  // SVG secondary — soft white
const FILL_LIGHT = "rgba(255,255,255,0.08)"; // SVG fill — translucent white on dark
const SEL_INK = "#60AEFF";                   // selection accent — FloorPlan's soft blue

function AssetGlyph({ asset, r, selected = false }: {
  asset: { category: OutdoorCategory; color: string; kind: string };
  r: number;
  selected?: boolean;
}) {
  const locale = useLocale();
  const stroke = selected ? SEL_INK : INK;
  const sw = selected ? r * 0.08 : r * 0.045;

  if (asset.category === "tree") {
    // Standard landscape architect tree: double circle with radial spokes
    return (
      <g>
        <circle r={r} fill={asset.color} fillOpacity={0.22} stroke={stroke} strokeWidth={sw} />
        <circle r={r * 0.55} fill="none" stroke={stroke} strokeWidth={sw * 0.7} />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <line key={i}
            x1={Math.cos(a) * r * 0.55} y1={Math.sin(a) * r * 0.55}
            x2={Math.cos(a) * r}        y2={Math.sin(a) * r}
            stroke={stroke} strokeWidth={sw * 0.5} />;
        })}
        <circle r={r * 0.10} fill={stroke} />
      </g>
    );
  }
  if (asset.category === "plant") {
    // Small cluster of unfilled circles (low planting symbol)
    const pts: Array<[number, number]> = [
      [0, 0], [r * 0.55, 0.1], [-r * 0.55, 0.1], [0, r * 0.55], [0, -r * 0.55],
    ];
    return (
      <g>
        {pts.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r={r * 0.30}
            fill={asset.color} fillOpacity={0.22} stroke={stroke} strokeWidth={sw * 0.7} />
        ))}
      </g>
    );
  }
  if (asset.category === "rock") {
    // Irregular pentagon, paper fill + ink outline
    const verts: string = [0, 1, 2, 3, 4].map(i => {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const rr = r * (0.78 + 0.18 * Math.sin(i * 1.7));
      return `${Math.cos(a) * rr},${Math.sin(a) * rr}`;
    }).join(" ");
    return (
      <g>
        <polygon points={verts} fill={asset.color} fillOpacity={0.22} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <line x1={-r * 0.4} y1={-r * 0.1} x2={r * 0.3} y2={r * 0.2}
          stroke={INK_LIGHT} strokeWidth={sw * 0.7} strokeLinecap="round" />
      </g>
    );
  }
  if (asset.category === "furniture") {
    // Furniture symbol — filled rounded rectangle with item-specific sub-label
    const furnitureLabelMap: Record<string, string> = locale === "en"
      ? {
          "furniture.chaiseLounger":   "Lounger",
          "furniture.swimmingLounger": "Pool",
          "furniture.outdoorSofa":     "Sofa",
          "furniture.parasol":         "Parasol",
          "furniture.coffeeTable":     "Table",
          "furniture.diningSet":       "Dining",
          "furniture.fireplace":       "Fire",
          "furniture.planter":         "Planter",
        }
      : {
          "furniture.chaiseLounger":   "躺椅",
          "furniture.swimmingLounger": "泳池",
          "furniture.outdoorSofa":     "沙发",
          "furniture.parasol":         "伞",
          "furniture.coffeeTable":     "茶几",
          "furniture.diningSet":       "餐桌",
          "furniture.fireplace":       "壁炉",
          "furniture.planter":         "花盆",
        };
    const sub = furnitureLabelMap[asset.kind] ?? (locale === "en" ? "Furniture" : "家具");
    return (
      <g>
        <rect x={-r * 0.85} y={-r * 0.75} width={r * 1.70} height={r * 1.50}
          rx={r * 0.18} fill="rgba(255,220,170,0.10)" stroke={stroke} strokeWidth={sw} />
        <text textAnchor="middle" dominantBaseline="middle"
          fontSize={r * 0.52} fill={stroke} fontFamily="PingFang SC, Helvetica, sans-serif" fontWeight={600}
          style={{ userSelect: "none", pointerEvents: "none" }}>{sub}</text>
      </g>
    );
  }
  // feature — rectangle outline with sub-icon
  const featureLabelMap: Record<string, string> = {
    "feature.fence":      "FNC",
    "feature.fenceGate":  "GTE",
    "feature.bridgeWood": "BR",
    "feature.campfire":   "FP",
    "feature.tent":       "TNT",
    "feature.pathStone":  "PVR",
    "feature.signPost":   "SGN",
    "feature.canoe":      "BT",
    "feature.cropCarrot": "VEG",
    "feature.cropPumpkin":"VEG",
    "feature.cropMelon":  "VEG",
    "feature.cropCorn":   "VEG",
    "feature.cropBamboo": "BMB",
    "feature.cropDirt":   "BED",
  };
  const sub = featureLabelMap[asset.kind] ?? "■";
  return (
    <g>
      <rect x={-r * 0.85} y={-r * 0.7} width={r * 1.7} height={r * 1.4}
        rx={r * 0.10} fill={asset.color} fillOpacity={0.22} stroke={stroke} strokeWidth={sw} />
      <text textAnchor="middle" dominantBaseline="middle"
        fontSize={r * 0.55} fill={stroke} fontFamily="ui-monospace, Menlo, monospace" fontWeight={700}
        style={{ userSelect: "none", pointerEvents: "none" }}>{sub}</text>
    </g>
  );
}

/** Prefab glyph — color-coded dashed bounding rectangle, mirrors the
 *  way FloorPlan colours its furniture by category. Pool=blue, kitchen
 *  =orange, pergola=amber, etc. Fill is barely visible so it doesn't
 *  fight the dark canvas. Chinese label is the primary readout, monogram
 *  tag is a small secondary in the corner. */
const PREFAB_PALETTE: Record<PrefabKind, { stroke: string; fill: string }> = {
  pool:            { stroke: "#60AEFF", fill: "rgba(96,174,255,0.08)" },   // soft blue (water)
  pergola_classic: { stroke: "#FCD34D", fill: "rgba(252,211,77,0.08)" },   // amber (timber + sun)
  outdoor_kitchen: { stroke: "#FB923C", fill: "rgba(251,146,60,0.08)" },   // orange (heat / grill)
  fountain:        { stroke: "#A78BFA", fill: "rgba(167,139,250,0.08)" },  // violet (decorative)
  social_island:   { stroke: "#F87171", fill: "rgba(248,113,113,0.08)" },  // coral (gathering)
  farm_box:        { stroke: "#86EFAC", fill: "rgba(134,239,172,0.08)" },  // mint (planting)
  porte_cochere:   { stroke: "#9CA3AF", fill: "rgba(156,163,175,0.10)" },  // grey (utility)
  slat_wall:       { stroke: "#D1D5DB", fill: "rgba(209,213,219,0.06)" },  // light grey (boundary)
  fence_segment:   { stroke: "#A8845A", fill: "rgba(168,132,90,0.10)" },  // warm wood (fence)
  parking_area:    { stroke: "#94A3B8", fill: "rgba(148,163,184,0.10)" }, // slate (concrete)
  glb_model:       { stroke: "#818CF8", fill: "rgba(129,140,248,0.10)" }, // indigo (AI-generated)
};

function PrefabGlyph({ kind, footprintPx, selected = false }: {
  kind: PrefabKind;
  footprintPx: { w: number; d: number };
  selected?: boolean;
}) {
  const locale = useLocale();
  const def = getPrefabDef(kind);
  if (!def) return null;
  const palette = PREFAB_PALETTE[kind] ?? { stroke: INK, fill: "rgba(255,255,255,0.06)" };
  const stroke = selected ? SEL_INK : palette.stroke;
  const sw = selected ? 1.8 : 1.1;
  const halfW = footprintPx.w / 2;
  const halfD = footprintPx.d / 2;
  // Smaller monogram, primary readout is the Chinese label
  const tagSize = Math.min(9, footprintPx.d * 0.22);
  const labelSize = Math.min(11, footprintPx.d * 0.28);
  return (
    <g>
      {/* Translucent envelope — coloured per prefab category */}
      <rect x={-halfW} y={-halfD} width={footprintPx.w} height={footprintPx.d}
        fill={palette.fill}
        stroke={stroke} strokeWidth={sw} strokeDasharray="6 4" rx={4} />
      {/* Chinese label — primary readout */}
      <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
        fontSize={labelSize} fontWeight={600} fill={stroke}
        style={{ userSelect: "none", pointerEvents: "none" }}>
        {locale === "en" ? def.labelEn : def.label}
      </text>
      {/* Monogram tag — small secondary in top-left corner */}
      <text x={-halfW + 4} y={-halfD + tagSize + 2} textAnchor="start" dominantBaseline="middle"
        fontSize={tagSize} fontFamily="ui-monospace, Menlo, monospace"
        fontWeight={700} fill={stroke} opacity={0.7}
        style={{ userSelect: "none", pointerEvents: "none" }}>
        {def.glyphTag}
      </text>
    </g>
  );
}

/** Zone glyph — semi-transparent fill polygon + zone-kind label.
 *  Drawn UNDER prefabs and singletons so they don't obscure smaller items. */
function ZoneGlyph({ zone, polygonPx, selected = false }: {
  zone: YardZone;
  polygonPx: Array<[number, number]>;
  selected?: boolean;
}) {
  const locale = useLocale();
  const style = ZONE_STYLES[zone.zoneKind];
  const ptsAttr = polygonPx.map(p => p.join(",")).join(" ");
  const [cxLocal, czLocal] = polygonCentroid(polygonPx);
  return (
    <g>
      <polygon points={ptsAttr}
        fill={style.planFill}
        stroke={selected ? SEL_INK : style.planStroke}
        strokeWidth={selected ? 1.6 : 1.0}
        strokeDasharray="4 3" />
      <text x={cxLocal} y={czLocal} textAnchor="middle" dominantBaseline="middle"
        fontSize={10} fontWeight={600}
        fill={style.planStroke} letterSpacing="0.06em"
        style={{ userSelect: "none", pointerEvents: "none" }}>
        {locale === "en" ? style.labelEn : style.label}
      </text>
    </g>
  );
}

/** A single violation row in the inspector panel. */
function ViolationCard({ v, locale }: { v: import("@/lib/outdoorClearance").OutdoorViolation; locale: string }) {
  const isReq = v.severity === "required";
  return (
    <div className="text-[10px] px-2 py-1.5 mb-1 rounded leading-snug"
      style={{
        background: isReq ? "#FEF2F2" : "#FFFBEB",
        border: `1px solid ${isReq ? "#FCA5A5" : "#FCD34D"}`,
        color: isReq ? "#991B1B" : "#92400E",
      }}>
      <div className="font-medium">{locale === "en" ? v.reasonEn : v.reasonZh}</div>
      {v.requiredM != null && v.actualM != null && (
        <div className="font-mono opacity-70 mt-0.5">
          {locale === "en" ? "actual" : "实际"} {v.actualM.toFixed(1)} m
          {" / "}
          {locale === "en" ? "rule" : "规则"} {v.requiredM} m
        </div>
      )}
    </div>
  );
}

function darkenHex(hex: string, by: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - by)));
  const g = Math.max(0, Math.round(((n >>  8) & 0xff) * (1 - by)));
  const b = Math.max(0, Math.round(( n        & 0xff) * (1 - by)));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// ─── Library (left rail) ───────────────────────────────────
// Dark theme matching FloorPlan's 材料 / 家具 / 样板 sidebar pattern.
// 4 tab categories total: 样板 (templates) / BLOCKS (prefabs) / individual
// asset categories. The 样板 tab moved here from the toolbar so it's
// discoverable in the same place as FloorPlan's 样板.
type LibraryTab = OutdoorCategory | "prefab" | "template";
export function YardPlanLibrary() {
  const locale = useLocale();
  const [tab, setTab] = useState<LibraryTab>("template");
  // 图生3D / 整图拆解 / GLB→PBR 已移到右下角统一「✨ AI 助手」菜单（AiEntryMenu）
  // 已导入模型库（public/models/imported/ 真实文件）——切到「组件」tab 时拉取，
  // 点卡片即可把同一模型再放一个实例进院子；导入过的东西从这里随时调出。
  const [importedModels, setImportedModels] = useState<Array<{ url: string; name: string; nameEn?: string; previewUrl?: string | null; bytes: number }>>([]);
  useEffect(() => {
    if (tab !== "prefab") return;
    let alive = true;
    void fetch("/api/import-model")
      .then(r => r.ok ? r.json() : { models: [] })
      .then(d => { if (alive) setImportedModels(d.models ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tab]);
  const placeImported = (m: { url: string; name: string }) => {
    addYardItem({
      id: `glb_lib_${crypto.randomUUID().slice(0, 8)}`,
      type: "prefab",
      prefabKind: "glb_model",
      x: 200, z: 300, rot: 0, scale: 1,
      glbSrc: m.url,
      partLabel: m.name,
    } as YardItem);
  };
  const deleteImported = (m: { url: string }) => {
    const file = m.url.split("/").pop() ?? "";
    if (!window.confirm(locale === "en" ? `Delete "${file}" from the model library?` : `从模型库删除「${file}」？已摆放的实例会变成加载失败。`)) return;
    void fetch(`/api/import-model?file=${encodeURIComponent(file)}`, { method: "DELETE" })
      .then(() => setImportedModels(list => list.filter(x => x.url !== m.url)))
      .catch(() => {});
  };
  const items = (tab === "prefab" || tab === "template") ? null
    : OUTDOOR_ASSET_LIBRARY.filter(a => a.category === tab);

  // Tab labels — Chinese to match the rest of the app
  const tabLabels: Record<LibraryTab, string> = locale === "en"
    ? { template: "Templates", prefab: "Blocks", tree: "Trees", plant: "Plants", rock: "Rocks", feature: "Features", furniture: "Furniture" }
    : { template: "样板", prefab: "组件", tree: "树木", plant: "花卉", rock: "山石", feature: "设施", furniture: "家具" };
  const allTabs: LibraryTab[] = ["template", "prefab", ...OUTDOOR_CATEGORIES.map(c => c.id)];

  // Apply preset action — needs store hooks at component scope
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const yardItems      = useDesignerStore(s => s.floorPlans[0].yardPlan?.items ?? EMPTY_YARD_ITEMS);
  const addYardItem    = useDesignerStore(s => s.addYardItem);
  const removeYardItem = useDesignerStore(s => s.removeYardItem);
  const applyPreset = (p: import("@/lib/outdoorAssets").YardPreset) => {
    if (yardItems.length > 0 && !window.confirm(locale === "en" ? `Replace the current ${yardItems.length} element(s) with "${p.labelEn}"?` : `替换当前 ${yardItems.length} 个元素为「${p.label}」？`)) return;
    for (const it of [...yardItems]) removeYardItem(it.id);
    const stamp = crypto.randomUUID().slice(0, 6);
    // 模板坐标按"典型住宅"写死——先按当前房屋占地把重叠的分区/物件推出
    // 屋外（否则大房子会出现「泳池压进客厅」）。
    const fp0 = useDesignerStore.getState().floorPlans[0];
    const { hw, hd } = houseHalfExtentsCm(fp0);
    const cleared = clearYardItemsOfHouse(p.items as YardItem[], hw, hd);
    cleared.forEach((it, i) => {
      addYardItem({ ...it, id: `${p.id}-${stamp}-${i}` } as YardItem);
    });
  };

  // 手动导入 .glb/.gltf：落成 public/models/imported/ 真实文件（与内置家具
  // 同一套「URL 即资产」机制），store 里只存 URL；只读环境自动退 IndexedDB。
  // 统一导入卡（ModelImportCard：压缩可选 + 本机路径），导入后放进院子
  // 并同步出现在「已导入模型」列表，之后可随时再调出。
  const [showGlbImport, setShowGlbImport] = useState(false);
  const handleImportedGlb = (src: string, name: string, batch?: boolean) => {
    // 批量导入：只入库（不自动放进院子、不关卡），导入后到列表逐个重命名/摆放。
    if (!batch) {
      addYardItem({
        id:         `glb_import_${crypto.randomUUID().slice(0, 8)}`,
        type:       "prefab",
        prefabKind: "glb_model",
        x:          200, z: 300, rot: 0, scale: 1,
        glbSrc:     src,
        partLabel:  name || (locale === "en" ? "Imported model" : "导入模型"),
      } as YardItem);
      setShowGlbImport(false);
    }
    if (src.startsWith("/models/imported/")) {
      setImportedModels(list => list.some(m => m.url === src) ? list : [{ url: src, name, bytes: 0 }, ...list]);
    }
  };

  // 手动重命名：按当前语言改对应名字字段（PATCH 合并）。
  const renameImported = (m: { url: string; name: string; nameEn?: string }) => {
    const file = m.url.split("/").pop() ?? "";
    const cur = locale === "en" ? (m.nameEn || m.name) : m.name;
    const next = window.prompt(locale === "en" ? "Rename model:" : "重命名模型：", cur);
    if (next == null) return;
    const t = next.trim();
    if (!t || t === cur) return;
    const body = locale === "en" ? { file, nameEn: t } : { file, nameZh: t };
    void fetch("/api/import-model", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(() => setImportedModels(list => list.map(x => x.url === m.url
      ? (locale === "en" ? { ...x, nameEn: t } : { ...x, name: t }) : x)))
      .catch(() => {});
  };

  return (
    <aside className="h-full flex flex-col bg-white" style={{ borderRight: "1px solid #E5E7EB" }}>
      {/* Heading + Tabs — FloorPlan-style: white bg, gray heading, blue active tab */}
      <div className="px-3 pt-3 pb-2 shrink-0" style={{ borderBottom: "1px solid #E5E7EB" }}>
        <div className="text-[10px] tracking-widest font-semibold mb-2 text-gray-400" style={{ letterSpacing: "0.12em" }}>
          LANDSCAPE LIBRARY
        </div>
        <div className="flex gap-1 flex-wrap">
          {allTabs.map(c => (
            <button key={c}
              onClick={() => setTab(c)}
              className="flex-1 py-1 text-[11px] font-semibold tracking-wide transition-colors"
              style={tab === c
                ? { color: "#007AFF", borderBottom: `2px solid #007AFF` }
                : { color: "#9CA3AF", borderBottom: "2px solid transparent" }}
            >
              {tabLabels[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Templates grid — light cards on white sidebar */}
      {tab === "template" && (
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2">
          {YARD_PRESETS.map(p => (
            <button key={p.id}
              onClick={() => applyPreset(p)}
              className="group flex flex-col items-center gap-1 px-1 py-3 rounded-xl border transition-colors text-center bg-gray-50 border-gray-100 hover:bg-blue-50 hover:border-blue-300"
              title={locale === "en" ? p.descEn : p.desc}
            >
              <span className="text-2xl leading-none">{p.icon}</span>
              <span className="text-[11px] font-bold mt-1 text-gray-700">{locale === "en" ? p.labelEn : p.label}</span>
              <span className="text-[9px] leading-tight text-gray-400 px-0.5">{locale === "en" ? p.descEn : p.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Prefabs grid — light card with dark canvas glyph thumbnail */}
      {tab === "prefab" && (
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">

          {/* 图生3D / 整图拆解 / GLB→PBR 已并入右下角统一「✨ AI 助手」菜单的
              「3D 建模」分区（不再散落在院子组件 tab）。此处保留手动导入 + 模型库。 */}

          {/* ── 手动导入 .glb/.gltf（统一导入卡：压缩可选/本机路径）──── */}
          <button
            onClick={() => setShowGlbImport(v => !v)}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors text-left"
            style={{ background: "linear-gradient(135deg,#EEF2FF,#F0FDF4)", border: showGlbImport ? "1px solid #6366F1" : "1px solid #C7D2FE" }}
          >
            <span style={{ fontSize: 22 }}>📦</span>
            <div className="flex flex-col flex-1 min-w-0">
              <div className="text-[11px] font-bold" style={{ color: "#4338CA" }}>{locale === "en" ? "Import .glb / .gltf" : "手动导入 .glb / .gltf"}</div>
              <div className="text-[9px]" style={{ color: "#6366F1" }}>{locale === "en" ? "Upload / local path · optional compression · drops into yard" : "上传或本机路径 · 压缩可选 · 直接入院子"}</div>
            </div>
            <span style={{ color: "#818CF8", fontSize: 14 }}>{showGlbImport ? "▾" : "›"}</span>
          </button>
          {showGlbImport && <ModelImportCard onImported={handleImportedGlb} />}

          {/* ── 已导入模型库：随时调出再放一个实例 ───────────── */}
          {importedModels.length > 0 && (
            <>
              <div className="mt-1 mb-0.5 text-[10px] font-bold tracking-widest text-gray-400">
                {locale === "en" ? "IMPORTED MODELS" : "已导入模型（点击放入院子）"}
              </div>
              {importedModels.map(m => {
                const display = locale === "en" ? (m.nameEn || m.name) : m.name;
                return (
                  <div key={m.url}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors text-left bg-gray-50 border-gray-100 hover:bg-indigo-50 hover:border-indigo-200">
                    <button onClick={() => placeImported({ url: m.url, name: display })} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      {m.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.previewUrl} alt="" className="w-9 h-9 rounded shrink-0 object-contain bg-white" />
                      ) : (
                        <span style={{ fontSize: 18 }} className="w-9 text-center">🧩</span>
                      )}
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-gray-700 truncate">{display}</div>
                        <div className="text-[9px] text-gray-400">{(m.bytes / 1024 / 1024).toFixed(1)}MB · {locale === "en" ? "click to place" : "点击放入"}</div>
                      </div>
                    </button>
                    <button onClick={() => renameImported(m)}
                      title={locale === "en" ? "Rename" : "重命名"}
                      className="shrink-0 text-xs text-gray-300 hover:text-indigo-500">✎</button>
                    <button onClick={() => deleteImported(m)}
                      title={locale === "en" ? "Delete from library" : "从模型库删除"}
                      className="shrink-0 text-xs text-gray-300 hover:text-red-500">✕</button>
                  </div>
                );
              })}
            </>
          )}

          {PREFAB_REGISTRY.map(p => (
            <button key={p.kind}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/yard-prefab", p.kind);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="group flex items-center gap-3 px-2 py-2 rounded-xl border transition-colors cursor-grab active:cursor-grabbing text-left bg-gray-50 border-gray-100 hover:bg-blue-50 hover:border-blue-300"
              title={locale === "en" ? p.descEn : p.desc}
            >
              {/* Glyph rendered against a small dark inset (mirror of canvas) */}
              <svg viewBox="-32 -22 64 44" width="56" height="38" style={{ background: "#1A1D26", borderRadius: 4 }}>
                <PrefabGlyph kind={p.kind} footprintPx={{ w: 50, d: 32 }} />
              </svg>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="text-[11px] font-bold text-gray-700">{locale === "en" ? p.labelEn : p.label}</div>
                <div className="text-[9px] truncate text-gray-400">{locale === "en" ? p.descEn : p.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Singleton asset grid — light cards */}
      {tab !== "prefab" && tab !== "template" && items && (
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1.5">
          {items.map(asset => (
            <button key={asset.kind}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/yard-asset", asset.kind);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="group flex flex-col items-center gap-1 px-1 py-2 rounded-xl border transition-colors cursor-grab active:cursor-grabbing bg-gray-50 border-gray-100 hover:bg-blue-50 hover:border-blue-300"
              title={locale === "en" ? asset.labelEn : asset.label}
            >
              {/* Mini dark inset so the light SVG glyphs are visible */}
              <svg viewBox="-32 -32 64 64" width="44" height="44" style={{ background: "#1A1D26", borderRadius: 4 }}>
                <AssetGlyph asset={asset} r={26} />
              </svg>
              <div className="text-[10px] text-center font-medium text-gray-700">{locale === "en" ? asset.labelEn : asset.label}</div>
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-2 text-[10px] text-gray-400 shrink-0" style={{ borderTop: "1px solid #E5E7EB" }}>
        Drag onto plan · 3D auto-renders in Exterior view
      </div>
    </aside>
  );
}

// ─── House footprint + per-room polygons ──────────────────
// Returns each indoor room as a polygon in centred world cm — same coord
// system the 3D Exterior uses. Lets us draw a proper architectural plan
// (filled rectangles per room) instead of one anonymous bounding box.
function useHouseRooms() {
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[activeFloor].roomDimensions);
  const roomShapes     = useDesignerStore(s => s.floorPlans[activeFloor].roomShapes);
  return useMemo(() => {
    const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
    if (!indoor.length) return { rooms: [], bbox: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } };
    const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
    const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
    const bMinX = Math.min(...xs), bMaxX = Math.max(...xs);
    const bMinZ = Math.min(...zs), bMaxZ = Math.max(...zs);
    const cx = (bMinX + bMaxX) / 2, cz = (bMinZ + bMaxZ) / 2;
    const rooms = indoor.map(room => {
      const lay = roomLayout[room];
      const dims = roomDimensions[room];
      const shape = roomShapes?.[room];
      // Per-room local cm polygon (rect fallback)
      const localPts: Array<[number, number]> = shape && shape.preset !== "rect"
        ? shape.points
        : [[0, 0], [dims.width, 0], [dims.width, dims.depth], [0, dims.depth]];
      // Convert to centered world cm
      const worldPts = localPts.map(([lx, lz]) => [lay.x + lx - cx, lay.y + lz - cz] as [number, number]);
      return { room, points: worldPts };
    });
    return {
      rooms,
      bbox: { minX: bMinX - cx, maxX: bMaxX - cx, minZ: bMinZ - cz, maxZ: bMaxZ - cz },
    };
  }, [enabledRooms, roomLayout, roomDimensions, roomShapes]);
}

// ─── Main canvas ───────────────────────────────────────────
// Stable empty-array singleton so the zustand selector returns the same
// reference when no items exist — otherwise `?? []` allocates a new array
// per call and triggers React's "getSnapshot should be cached" loop.
const EMPTY_YARD_ITEMS: YardItem[] = [];
const EMPTY_YARD_PATHS: NonNullable<import("@/lib/types").YardPlan["paths"]> = [];

// ─── Selection coordination (right panel reads, canvas writes) ─────
// Module-scope mini-store so YardPlan (canvas) and YardPlanInspector
// (right rail) can share without lifting state into a parent component.
const selListeners = new Set<() => void>();
let _selectedId: string | null = null;
function setSharedSelectedId(id: string | null) {
  _selectedId = id;
  selListeners.forEach(l => l());
}
export function useSharedSelectedYardId() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    selListeners.add(fn);
    return () => { selListeners.delete(fn); };
  }, []);
  return _selectedId;
}

export default function YardPlan() {
  const locale = useLocale();
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const yardItems   = useDesignerStore(s => s.floorPlans[0].yardPlan?.items ?? EMPTY_YARD_ITEMS);
  const yardPaths   = useDesignerStore(s => s.floorPlans[0].yardPlan?.paths ?? EMPTY_YARD_PATHS);
  const addYardItem = useDesignerStore(s => s.addYardItem);
  const removeYardItem = useDesignerStore(s => s.removeYardItem);
  const updateYardItem = useDesignerStore(s => s.updateYardItem);
  const addYardPath    = useDesignerStore(s => s.addYardPath);
  const removeYardPath = useDesignerStore(s => s.removeYardPath);
  const exteriorPreset = useDesignerStore(s => s.exterior.preset);
  const { rooms: houseRooms, bbox: footprint } = useHouseRooms();

  // 按当前外观风格一键铺满院子：复用 EXTERIOR_PRESETS 的 yardItems/yardPaths
  // （与外观面板同一份数据，保持风格一致），按当前房屋占地避让。只动院子，
  // 不碰立面/房间材质。空院子引导 + 「重新铺」都走它。
  const styleForYard = EXTERIOR_PRESETS.find(p => p.id === exteriorPreset && p.yardItems);
  const fillYardByStyle = () => {
    if (!styleForYard?.yardItems) return;
    if (yardItems.length > 0 && !window.confirm(
      locale === "en"
        ? `Replace the current ${yardItems.length} yard element(s) with the “${styleForYard.labelEn}” package?`
        : `用「${styleForYard.label}」整套院子替换当前 ${yardItems.length} 个元素？`,
    )) return;
    const { hw, hd } = houseHalfExtentsCm(useDesignerStore.getState().floorPlans[0]);
    const cleared = clearYardItemsOfHouse(styleForYard.yardItems, hw, hd);
    for (const it of [...yardItems]) removeYardItem(it.id);
    for (const p of [...yardPaths]) removeYardPath(p.id);
    const stamp = crypto.randomUUID().slice(0, 6);
    cleared.forEach((it, i) => addYardItem({ ...it, id: `${styleForYard.id}-${stamp}-${i}` } as YardItem));
    (styleForYard.yardPaths ?? []).forEach((p, i) => addYardPath({ ...p, id: `${styleForYard.id}-path-${stamp}-${i}` }));
  };
  // Outdoor smart-suggestions: evaluated whenever items / footprint change
  const violations = useMemo(() => evaluateYardPlan(yardItems, footprint, yardPaths), [yardItems, footprint, yardPaths]);
  const violationMap = useMemo(() => violationsByItem(violations), [violations]);
  const requiredCount = violations.filter(v => v.severity === "required").length;
  const recommendedCount = violations.length - requiredCount;

  // Sun analysis — shared with HouseCanvas and AiRenderModal via store
  const sunHour    = useDesignerStore(s => s.sunHour);
  const siteLatLng = useDesignerStore(s => s.siteLatLng);

  // Shadow polygon — recalculated when sun hour or house size changes
  const houseWcm = footprint.maxX - footprint.minX;
  const houseDcm = footprint.maxZ - footprint.minZ;
  const houseHm  = 2 * 2.8; // 2-floor default height in metres
  const shadowPoly = useMemo(
    () => getShadowPolygon(sunHour, siteLatLng, houseWcm, houseDcm, houseHm),
    [sunHour, siteLatLng, houseWcm, houseDcm, houseHm],
  );

  // Quote sheet modal
  const [showQuote, setShowQuote] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedId, _setSelectedId] = useState<string | null>(null);
  const setSelectedId = (id: string | null) => {
    _setSelectedId(id);
    setSharedSelectedId(id);
  };
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetZ: number } | null>(null);

  // ── Draw modes (fence / path) ──
  const [drawMode, setDrawMode] = useState<"select" | "fence" | "path">("select");
  const [fenceDraw, setFenceDraw] = useState<{
    startPx: [number, number];
    startCm: [number, number];
  } | null>(null);
  const [fencePreviewEnd, setFencePreviewEnd] = useState<[number, number] | null>(null);

  // Path draw: accumulate polyline vertices (click-by-click), double-click to commit
  const [pathPts, setPathPts] = useState<Array<[number, number]>>([]);   // cm world coords
  const [pathPreview, setPathPreview] = useState<[number, number] | null>(null);
  const [pathWidthCm, setPathWidthCm] = useState(80);  // default 80cm wide path
  // §10.6 budget tier — T0 (validate only) → T4 (full reno).
  // Drives the "✨ 自动设计" button: each tier opts into more aggressive
  // automated changes. Defaults to T3 (multi-zone refresh) as the most
  // common "I want it to look done" use case.
  const [budgetTier, setBudgetTier] = useState<"T0" | "T1" | "T2" | "T3" | "T4">("T3");
  const [pathMaterial, setPathMaterial] = useState<"stone" | "gravel" | "grass" | "brick">("stone");
  const [setbackCm, setSetbackCm] = useState(100); // lot setback in cm (default 1m)
  const [zoomLevel, setZoomLevel] = useState(1.0);
  // Guard so DnD-drop doesn't double-fire as a click-deselect
  const justDroppedRef = useRef(false);

  // Zoom-aware viewBox parameters
  const vbSize   = SVG_PX / zoomLevel;
  const vbOrigin = (SVG_PX - vbSize) / 2;

  // Convert screen point → world cm (centred origin). Accounts for viewBox zoom.
  const svgPtToWorld = (clientX: number, clientY: number): { x: number; z: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const rect = svg.getBoundingClientRect();
    const px = vbOrigin + ((clientX - rect.left) / rect.width)  * vbSize;
    const py = vbOrigin + ((clientY - rect.top)  / rect.height) * vbSize;
    return {
      x: (px - SVG_PX / 2) * CM_PER_PX,
      z: (py - SVG_PX / 2) * CM_PER_PX,
    };
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    setZoomLevel(z => Math.max(0.5, Math.min(4, z * factor)));
  };

  // ── Drag-from-library drop ──
  // Two distinct payloads: "text/yard-asset" for singletons, "text/yard-prefab"
  // for compound prefabs. We dispatch on whichever is present.
  const handleDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x, z } = svgPtToWorld(e.clientX, e.clientY);
    const id = `y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const prefabKind = e.dataTransfer.getData("text/yard-prefab");
    const assetKind  = e.dataTransfer.getData("text/yard-asset");
    if (prefabKind) {
      addYardItem({
        id,
        type: "prefab",
        prefabKind: prefabKind as PrefabKind,
        x: Math.round(x), z: Math.round(z),
        rot: 0, scale: 1,
      });
    } else if (assetKind) {
      addYardItem({
        id, type: "singleton",
        kind: assetKind,
        x: Math.round(x), z: Math.round(z),
        rot: 0, scale: 1,
      });
    } else {
      return;
    }
    setSelectedId(id);
    justDroppedRef.current = true;
    setTimeout(() => { justDroppedRef.current = false; }, 0);
  };

  // ── Selected-item move (via SVG pointermove on the document) ──
  // Integrates two algorithms from the design doc:
  //   1. Smart Snap-to-Wall (磁吸): when dragging within 50cm of a house wall
  //      edge, the item snaps to the wall face + 30cm clearance gap.
  //   2. House Clearance Guard (避让): if the item lands inside the house
  //      bounding box, it is nudged outward to the nearest safe edge.
  // Shift key bypasses both (free move for manual fine-tuning).
  const houseWm = (footprint.maxX - footprint.minX) / 100;
  const houseDm = (footprint.maxZ - footprint.minZ) / 100;
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const { x, z } = svgPtToWorld(ev.clientX, ev.clientY);
      let nx = Math.round(x - drag.offsetX);
      let nz = Math.round(z - drag.offsetZ);

      if (!ev.shiftKey) {
        // Grid snap first
        nx = Math.round(nx / SNAP_CM) * SNAP_CM;
        nz = Math.round(nz / SNAP_CM) * SNAP_CM;

        // 1. Snap-to-wall (磁吸) — pulls item to house wall face when nearby
        const snapped = snapToHouseWall(nx, nz, houseWm, houseDm, 50);
        nx = snapped.x;
        nz = snapped.z;

        // 2. Clearance guard (避让) — for trees use canopy radius so the 3D
        //    crown never clips through the building wall; other items 20 cm.
        const dragItem = yardItems.find(it => it.id === drag.id);
        const dragKind = dragItem && "kind" in dragItem ? (dragItem as { kind: string }).kind : "";
        const dragScale = dragItem && "scale" in dragItem ? ((dragItem as { scale?: number }).scale ?? 1) : 1;
        const clearanceCm = dragKind.startsWith("tree.")
          ? Math.round((TREE_CANOPY_RADIUS_M[dragKind] ?? 3) * dragScale * 100)
          : 20;
        const clearance = checkHouseClearance(nx, nz, houseWm, houseDm, clearanceCm);
        if (!clearance.ok) {
          nx += clearance.nudgeX;
          nz += clearance.nudgeZ;
        }
      }

      updateYardItem(drag.id, { x: nx, z: nz });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, updateYardItem, houseWm, houseDm, yardItems]);

  // Keyboard: Delete key removes selected item, ESC exits draw mode
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (drawMode === "fence") {
          setDrawMode("select"); setFenceDraw(null); setFencePreviewEnd(null);
        } else if (drawMode === "path") {
          setDrawMode("select"); setPathPts([]); setPathPreview(null);
        }
        return;
      }
      // Backspace removes last path vertex while drawing
      if (ev.key === "Backspace" && drawMode === "path") {
        const t = ev.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        setPathPts(pts => pts.slice(0, -1));
        return;
      }
      if (!selectedId) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        const t = ev.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        // selectedId may refer to either a yard item or a yard path. Try
        // path first (cheaper lookup, less common) then fall through to
        // the yardItems remove.
        if (yardPaths.some(p => p.id === selectedId)) {
          removeYardPath(selectedId);
        } else {
          removeYardItem(selectedId);
        }
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, removeYardItem, removeYardPath, yardPaths, drawMode]);

  const houseW = Math.round((footprint.maxX - footprint.minX) / 100 * 10) / 10;
  const houseD = Math.round((footprint.maxZ - footprint.minZ) / 100 * 10) / 10;
  const selectedItem = selectedId ? yardItems.find(i => i.id === selectedId) : null;

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0f1117] select-none overflow-hidden relative">
      {/* ── Header bar — 3-column layout matching FloorPlan ── */}
      <div className="flex items-center gap-2 px-4 h-11 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Left: info text */}
        <span className="text-[11px] text-gray-500 font-mono flex-1 min-w-0 truncate">
          {locale === "en" ? "Yard plan" : "院子图"} · {locale === "en" ? "site" : "地块"} 30 × 30 m · {locale === "en" ? "house" : "房屋"} {houseW}m × {houseD}m · {yardItems.length} {locale === "en" ? "elements" : "元素"}
        </span>
        {/* Center: zoom controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setZoomLevel(z => Math.max(0.5, z / 1.25))}
            className="w-6 h-6 flex items-center justify-center text-[13px] font-mono rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            −
          </button>
          <button
            onClick={() => setZoomLevel(1)}
            className="px-2 h-6 text-[11px] font-mono rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors min-w-[44px] text-center">
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            onClick={() => setZoomLevel(z => Math.min(4, z * 1.25))}
            className="w-6 h-6 flex items-center justify-center text-[13px] font-mono rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            +
          </button>
        </div>
        {/* Fence draw mode toggle */}
        <button
          onClick={() => {
            setDrawMode(m => m === "fence" ? "select" : "fence");
            setFenceDraw(null); setFencePreviewEnd(null);
            setPathPts([]); setPathPreview(null);
          }}
          className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0 transition-all"
          style={drawMode === "fence"
            ? { background: "rgba(168,132,90,0.30)", color: "#D4A86A", border: "1px solid rgba(168,132,90,0.6)" }
            : { background: "rgba(255,255,255,0.06)", color: "#9CA3AF", border: "1px solid rgba(255,255,255,0.12)" }
          }>
          🔧 {locale === "en" ? "Fence" : "围栏"}
        </button>
        {/* Path draw mode toggle */}
        <button
          onClick={() => {
            setDrawMode(m => m === "path" ? "select" : "path");
            setPathPts([]); setPathPreview(null);
            setFenceDraw(null); setFencePreviewEnd(null);
          }}
          className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0 transition-all"
          style={drawMode === "path"
            ? { background: "rgba(59,130,246,0.25)", color: "#60A5FA", border: "1px solid rgba(59,130,246,0.5)" }
            : { background: "rgba(255,255,255,0.06)", color: "#9CA3AF", border: "1px solid rgba(255,255,255,0.12)" }
          }>
          🛤 {locale === "en" ? "Path" : "路径"}
        </button>
        {/* Auto-path button — derives walkways from existing zones */}
        <button
          onClick={() => {
            const paths = autoGenerateYardPaths(yardItems, footprint);
            for (const p of paths) addYardPath(p);
          }}
          title={locale === "en" ? "Auto-generate walkways from placed zones" : "基于已放置的区域自动生成步道"}
          className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0 transition-all"
          style={{ background: "rgba(168,85,247,0.18)", color: "#C084FC", border: "1px solid rgba(168,85,247,0.4)" }}>
          🪄 {locale === "en" ? "Auto path" : "自动路径"}
        </button>
        {/* Auto-plant button — Poisson scatter trees over open ground.
            Also drops sun-side shade trees on social zones (§10.5). */}
        <button
          onClick={() => {
            // §10.5 sun-aware shade first (high-purpose specimens),
            // then Poisson filler in remaining open ground.
            const shade = placeSunShadeTrees(yardItems, sunHour, siteLatLng);
            for (const t of shade) addYardItem(t);
            const allItemsAfterShade = [...yardItems, ...shade];
            const filler = autoScatterTrees(allItemsAfterShade, footprint);
            for (const t of filler) addYardItem(t);
          }}
          title={locale === "en" ? "Auto-plant trees: shade trees on the sunny side of the patio first, then Poisson scatter to fill open ground" : "自动种树：先在 patio 朝阳侧放遮阴树，再 Poisson 散布填补空地"}
          className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0 transition-all"
          style={{ background: "rgba(34,197,94,0.18)", color: "#86EFAC", border: "1px solid rgba(34,197,94,0.4)" }}>
          🌲 {locale === "en" ? "Auto plant" : "自动种树"}
        </button>
        {/* §10.6 budget tier selector — drives the unified ✨ button below */}
        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          <span className="text-[10px] text-amber-400/80 mr-0.5">{locale === "en" ? "Budget" : "预算"}</span>
          {(["T0","T1","T2","T3","T4"] as const).map(t => (
            <button key={t}
              onClick={() => setBudgetTier(t)}
              title={locale === "en"
                ? (
                  t === "T0" ? "T0 Tidy — validate only, no changes" :
                  t === "T1" ? "T1 Soft décor — add lights/planters, keep zones" :
                  t === "T2" ? "T2 Single-zone reno — add 1 social zone + path" :
                  t === "T3" ? "T3 Multi-zone reno — paths + auto-plant trees" :
                  "T4 Full reno — clear and apply the largest template"
                )
                : (
                  t === "T0" ? "T0 整理 — 只校验，不增减" :
                  t === "T1" ? "T1 软装 — 加灯/盆栽，不改区域" :
                  t === "T2" ? "T2 单区改造 — 添 1 个社交区 + 步道" :
                  t === "T3" ? "T3 多区翻新 — 步道 + 自动种树" :
                  "T4 大改造 — 清空后套用最大模板"
                )
              }
              className="px-1.5 h-6 text-[10px] font-bold rounded transition-all"
              style={budgetTier === t
                ? { background: "rgba(251,191,36,0.30)", color: "#FCD34D", border: "1px solid rgba(251,191,36,0.6)" }
                : { background: "rgba(255,255,255,0.06)", color: "#6B7280" }}>
              {t}
            </button>
          ))}
        </div>
        {/* Unified ✨ auto-design — tier picks scope */}
        <button
          onClick={() => {
            if (budgetTier === "T0") {
              // Validate only — violations already render in the right panel.
              return;
            }
            if (budgetTier === "T1") {
              // Soft additions — drop a few planters and stones near the
              // first social zone if any, else near the front of house.
              const social = yardItems.find(it => isYardZone(it) && it.zoneKind === "social") as YardZone | undefined;
              const cx = social ? social.x : 0;
              const cz = social ? social.z + 200 : footprint.maxZ + 200;
              const stamp = Date.now();
              addYardItem({ id: `soft-${stamp}-a`, type: "singleton", kind: "furniture.planter", x: cx - 150, z: cz });
              addYardItem({ id: `soft-${stamp}-b`, type: "singleton", kind: "furniture.planter", x: cx + 150, z: cz });
              addYardItem({ id: `soft-${stamp}-c`, type: "singleton", kind: "feature.pathStone", x: cx, z: cz - 80 });
              return;
            }
            if (budgetTier === "T2") {
              // One zone — if no social zone exists, drop a small patio + a
              // path back to the house. Otherwise act like T1.
              const hasSocial = yardItems.some(it => isYardZone(it) && it.zoneKind === "social");
              if (!hasSocial) {
                const stamp = Date.now();
                const newZone: YardZone = {
                  id: `t2-social-${stamp}`,
                  type: "zone", zoneKind: "social",
                  x: 0, z: footprint.maxZ + 400,
                  polygon: [[-300, -200], [300, -200], [300, 200], [-300, 200]],
                };
                addYardItem(newZone);
                const paths = autoGenerateYardPaths([...yardItems, newZone], footprint);
                for (const p of paths) addYardPath(p);
              }
              return;
            }
            if (budgetTier === "T3") {
              // Multi-zone refresh — current full pipeline on existing items.
              const paths = autoGenerateYardPaths(yardItems, footprint);
              for (const p of paths) addYardPath(p);
              const shade = placeSunShadeTrees(yardItems, sunHour, siteLatLng);
              for (const t of shade) addYardItem(t);
              const filler = autoScatterTrees([...yardItems, ...shade], footprint);
              for (const t of filler) addYardItem(t);
              return;
            }
            if (budgetTier === "T4") {
              // Full reno — clear yard items, apply biggest matching template,
              // then run T3 pipeline on the fresh layout.
              for (const it of [...yardItems]) removeYardItem(it.id);
              // Pick the template best matching the building footprint area.
              const footW = (footprint.maxX - footprint.minX) / 100;
              const footD = (footprint.maxZ - footprint.minZ) / 100;
              const footArea = footW * footD;
              const pickId =
                footArea > 80 ? "suburbanClassic" :
                footArea > 40 ? "smallSocialPatio" :
                "smallPatio";
              const preset = YARD_PRESETS.find(p => p.id === pickId) ?? YARD_PRESETS[0];
              const stamp = Date.now();
              preset.items.forEach((it, i) => {
                addYardItem({ ...it, id: `${preset.id}-${stamp}-${i}` } as YardItem);
              });
              return;
            }
          }}
          title={locale === "en" ? "✨ Auto design — applies templates/paths/planting based on the current budget tier" : "✨ 自动设计 — 根据当前预算 tier 综合应用模板/路径/种树"}
          className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0 transition-all"
          style={{ background: "rgba(251,191,36,0.22)", color: "#FCD34D", border: "1px solid rgba(251,191,36,0.5)" }}>
          ✨ {locale === "en" ? "Auto design" : "自动设计"}
        </button>
        {/* Path width + material selectors — only shown in path mode */}
        {drawMode === "path" && (
          <>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-blue-400">{locale === "en" ? "Width" : "宽"}</span>
              {[60, 80, 120, 180].map(w => (
                <button key={w}
                  onClick={() => setPathWidthCm(w)}
                  className="px-1.5 h-6 text-[10px] font-bold rounded transition-all"
                  style={pathWidthCm === w
                    ? { background: "rgba(59,130,246,0.4)", color: "#93C5FD" }
                    : { background: "rgba(255,255,255,0.06)", color: "#6B7280" }}>
                  {w}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-blue-400">{locale === "en" ? "Material" : "材质"}</span>
              {([ ["stone","石板","Stone","#94A3B8"], ["gravel","砾石","Gravel","#D97706"], ["grass","草径","Grass","#16A34A"], ["brick","砖路","Brick","#DC2626"] ] as const).map(([m, label, labelEn, color]) => (
                <button key={m}
                  onClick={() => setPathMaterial(m)}
                  className="px-1.5 h-6 text-[10px] font-bold rounded transition-all"
                  style={pathMaterial === m
                    ? { background: color + "40", color, border: `1px solid ${color}` }
                    : { background: "rgba(255,255,255,0.06)", color: "#6B7280" }}>
                  {locale === "en" ? labelEn : label}
                </button>
              ))}
            </div>
          </>
        )}
        {/* Setback selector — always visible */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <span className="text-[10px] text-orange-400/80">{locale === "en" ? "Setback" : "退线"}</span>
          {[50, 100, 150, 200].map(s => (
            <button key={s}
              onClick={() => setSetbackCm(s)}
              className="px-1.5 h-6 text-[10px] font-bold rounded transition-all"
              style={setbackCm === s
                ? { background: "rgba(251,146,60,0.30)", color: "#FB923C", border: "1px solid rgba(251,146,60,0.6)" }
                : { background: "rgba(255,255,255,0.06)", color: "#6B7280" }}>
              {s / 100}m
            </button>
          ))}
        </div>
        {/* Right: contextual actions when item selected */}
        {selectedItem && drawMode === "select" && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => updateYardItem(selectedItem.id, { rot: (selectedItem.rot ?? 0) + Math.PI / 2 })}
              className="px-2 h-7 text-[11px] font-semibold rounded transition-colors"
              style={{ background: "rgba(255,255,255,0.08)", color: "#D1D5DB", border: "1px solid rgba(255,255,255,0.12)" }}>
              ↻ {locale === "en" ? "Rotate" : "旋转"}
            </button>
            <button
              onClick={() => {
                const id = `y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                addYardItem({ ...selectedItem, id, x: selectedItem.x + 100, z: selectedItem.z + 100 });
                setSelectedId(id);
              }}
              className="px-2 h-7 text-[11px] font-semibold rounded transition-colors"
              style={{ background: "rgba(255,255,255,0.08)", color: "#D1D5DB", border: "1px solid rgba(255,255,255,0.12)" }}>
              ⧉ {locale === "en" ? "Duplicate" : "复制"}
            </button>
            <button
              onClick={() => { removeYardItem(selectedItem.id); setSelectedId(null); }}
              className="px-2 h-7 text-[11px] font-semibold rounded transition-colors"
              style={{ background: "rgba(220,38,38,0.15)", color: "#FCA5A5", border: "1px solid rgba(220,38,38,0.3)" }}>
              ✕ {locale === "en" ? "Delete" : "删除"}
            </button>
          </div>
        )}
        {/* Violation badges */}
        {requiredCount > 0 && (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded shrink-0"
            style={{ background: "rgba(220,38,38,0.18)", color: "#FCA5A5", border: "1px solid rgba(220,38,38,0.4)" }}>
            ⚠ {requiredCount} {locale === "en" ? "required" : "必须"}
          </span>
        )}
        {recommendedCount > 0 && (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded shrink-0"
            style={{ background: "rgba(245,158,11,0.18)", color: "#FCD34D", border: "1px solid rgba(245,158,11,0.4)" }}>
            ⚠ {recommendedCount} {locale === "en" ? "recommended" : "建议"}
          </span>
        )}
        {yardItems.length > 0 && (
          <button
            onClick={() => {
              if (!window.confirm(locale === "en" ? `Clear all ${yardItems.length} element(s)?` : `清除全部 ${yardItems.length} 个元素？`)) return;
              for (const it of [...yardItems]) removeYardItem(it.id);
              setSelectedId(null);
            }}
            className="px-2 h-7 text-[11px] font-semibold rounded-lg transition-all shrink-0"
            style={{ background: "rgba(220,38,38,0.18)", color: "#FCA5A5", border: "1px solid rgba(220,38,38,0.4)" }}>
            {locale === "en" ? "Clear" : "清空"}
          </button>
        )}
        {/* Auto-route button — appears when parking_area + items exist */}
        {yardItems.some(it => isYardPrefab(it) && (it as import("@/lib/types").YardPrefab).prefabKind === "parking_area") && (
          <button
            onClick={() => {
              // Find parking area centre
              const parking = yardItems.find(it => isYardPrefab(it) && (it as import("@/lib/types").YardPrefab).prefabKind === "parking_area") as import("@/lib/types").YardPrefab;
              if (!parking) return;
              // Front door position: south face of house (maxZ = living room side), centred X
              const doorX = (footprint.minX + footprint.maxX) / 2;
              const doorZ = footprint.maxZ;
              // Simple L-shaped path: from parking to door via an elbow point
              const pathPts: Array<{x: number; z: number}> = [];
              const steps = Math.max(2, Math.round(Math.abs(parking.z - doorZ) / 120));
              for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                pathPts.push({
                  x: parking.x + (doorX - parking.x) * Math.min(1, t * 1.4),
                  z: parking.z + (doorZ - parking.z) * t,
                });
              }
              pathPts.forEach((pt, idx) => {
                const id = `y-path-${Date.now()}-${idx}`;
                addYardItem({ id, type: "singleton", kind: "feature.pathStone", x: Math.round(pt.x / 25) * 25, z: Math.round(pt.z / 25) * 25, scale: 1.0 });
              });
            }}
            className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0"
            style={{ background: "rgba(34,197,94,0.15)", color: "#86EFAC", border: "1px solid rgba(34,197,94,0.3)" }}>
            🛤 {locale === "en" ? "Auto paving" : "自动铺路"}
          </button>
        )}
        {/* Quote sheet */}
        {yardItems.length > 0 && (
          <button
            onClick={() => setShowQuote(true)}
            className="px-2 h-7 text-[11px] font-semibold rounded-lg shrink-0"
            style={{ background: "rgba(251,191,36,0.15)", color: "#FCD34D", border: "1px solid rgba(251,191,36,0.3)" }}>
            💰 {locale === "en" ? "Get quote" : "获取报价"}
          </button>
        )}
      </div>

      {/* ── Quote Sheet Modal ── */}
      {showQuote && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowQuote(false); }}>
          <div className="bg-[#13161E] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ width: "min(640px,95vw)", maxHeight: "80vh", border: "1px solid rgba(255,255,255,0.10)" }}>
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-white font-bold text-base">💰 {locale === "en" ? "Purchase Quote" : "采购报价单"}</h2>
              <button onClick={() => setShowQuote(false)} className="text-white/50 hover:text-white text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {(() => {
                const rows: Array<{label: string; brand: string; price: number; url: string}> = [];
                for (const item of yardItems) {
                  if (isYardSingleton(item)) {
                    const asset = _getAsset(item.kind);
                    if (asset?.estimatedPriceCNY) rows.push({ label: locale === "en" ? asset.labelEn : asset.label, brand: asset.brand ?? "—", price: asset.estimatedPriceCNY, url: asset.purchaseUrl ?? "" });
                  } else if (isYardPrefab(item)) {
                    const p = PREFAB_PURCHASE[(item as import("@/lib/types").YardPrefab).prefabKind];
                    if (p) rows.push({ label: locale === "en" ? p.labelEn : p.label, brand: p.brand, price: p.estimatedPriceCNY, url: p.purchaseUrl });
                  }
                }
                if (rows.length === 0) return <p className="text-white/40 text-sm text-center py-8">{locale === "en" ? "No quotable elements in the current design" : "当前设计中没有可报价的元素"}</p>;
                const total = rows.reduce((s, r) => s + r.price, 0);
                return (
                  <>
                    {rows.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.05)" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{r.label}</p>
                          <p className="text-white/40 text-xs">{r.brand}</p>
                        </div>
                        <p className="text-amber-300 font-bold text-sm shrink-0">¥{r.price.toLocaleString()}</p>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded shrink-0"
                            style={{ background: "rgba(251,191,36,0.15)", color: "#FCD34D", border: "1px solid rgba(251,191,36,0.3)" }}>
                            {locale === "en" ? "Buy" : "购买"} →
                          </a>
                        )}
                      </div>
                    ))}
                    <div className="flex justify-between items-center px-4 py-3 mt-2 rounded-lg"
                      style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)" }}>
                      <span className="text-white font-bold">{locale === "en" ? "Estimated Total" : "预估总价"}</span>
                      <span className="text-amber-300 font-bold text-lg">¥{total.toLocaleString()}</span>
                    </div>
                    <p className="text-white/30 text-[10px] text-center pt-1">{locale === "en" ? "Prices are market references; actual prices subject to supplier quotes" : "价格为市场参考价，实际以供应商报价为准"}</p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Canvas area ── */}
      <div className="flex-1 flex items-center justify-center overflow-auto p-4 min-h-0 relative">
        {/* 空院子引导浮层：一键按当前风格铺满 + 引导去模板/拖素材 */}
        {yardItems.length === 0 && yardPaths.length === 0 && (
          <div className="absolute z-20 left-1/2 -translate-x-1/2 top-6 w-[min(92%,360px)] rounded-2xl px-4 py-3 text-center"
            style={{ background: "rgba(20,24,32,0.92)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
            <div className="text-white text-sm font-bold mb-1">
              {locale === "en" ? "Your yard is empty" : "院子还是空的"}
            </div>
            <div className="text-white/55 text-[11px] leading-relaxed mb-2.5">
              {locale === "en"
                ? "Fill it in one click by your current exterior style, or drag elements from the left library / pick a template."
                : "按当前外观风格一键铺满，或从左侧素材库拖入元素 / 选个模板。"}
            </div>
            {styleForYard ? (
              <button onClick={fillYardByStyle}
                className="w-full py-2 rounded-xl text-white text-xs font-bold transition-transform active:scale-95"
                style={{ background: "linear-gradient(135deg,#0d9488,#2dd4bf)" }}>
                🎨 {locale === "en" ? `One-click fill (${styleForYard.labelEn})` : `一键铺满（${styleForYard.label}风格）`}
              </button>
            ) : (
              <div className="text-white/40 text-[10px]">
                {locale === "en" ? "Set an exterior style first to enable one-click fill." : "先在「整体外观」选一个风格，即可一键铺院子。"}
              </div>
            )}
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`${vbOrigin} ${vbOrigin} ${vbSize} ${vbSize}`}
          width="100%"
          style={{ maxWidth: 720, display: "block", background: "transparent", cursor: (drawMode === "fence" || drawMode === "path") ? "crosshair" : "default" }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={handleDrop}
          onWheel={handleWheel}
          onClick={(e) => {
            if (justDroppedRef.current) return;
            // Path mode: each click adds a vertex; double-click commits
            if (drawMode === "path") {
              e.preventDefault();
              const { x, z } = svgPtToWorld(e.clientX, e.clientY);
              setPathPts(pts => [...pts, [Math.round(x / 25) * 25, Math.round(z / 25) * 25] as [number, number]]);
              return;
            }
            // Click on empty SVG → deselect
            if (e.target === svgRef.current) setSelectedId(null);
          }}
          onDoubleClick={(e) => {
            if (drawMode === "path" && pathPts.length >= 2) {
              e.preventDefault();
              addYardPath({
                id: `path-${Date.now()}`,
                points: pathPts,
                widthCm: pathWidthCm,
                material: pathMaterial,
              });
              setPathPts([]);
              setPathPreview(null);
            }
          }}
          onMouseDown={(e) => {
            if (drawMode !== "fence") return;
            e.preventDefault();
            const { x, z } = svgPtToWorld(e.clientX, e.clientY);
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const px = vbOrigin + ((e.clientX - rect.left) / rect.width) * vbSize;
            const pz = vbOrigin + ((e.clientY - rect.top) / rect.height) * vbSize;
            setFenceDraw({ startPx: [px, pz], startCm: [x, z] });
            setFencePreviewEnd([x, z]);
          }}
          onMouseMove={(e) => {
            if (drawMode === "fence" && fenceDraw) {
              const { x, z } = svgPtToWorld(e.clientX, e.clientY);
              setFencePreviewEnd([x, z]);
            }
            if (drawMode === "path") {
              const { x, z } = svgPtToWorld(e.clientX, e.clientY);
              setPathPreview([Math.round(x / 25) * 25, Math.round(z / 25) * 25]);
            }
          }}
          onMouseUp={(e) => {
            if (drawMode !== "fence" || !fenceDraw) return;
            const { x: endX, z: endZ } = svgPtToWorld(e.clientX, e.clientY);
            const [startX, startZ] = fenceDraw.startCm;
            const dx = endX - startX;
            const dz = endZ - startZ;
            const lengthM = Math.sqrt(dx * dx + dz * dz) / 100;
            if (lengthM >= 0.3) {
              const angle = Math.atan2(dz, dx);
              const midX = (startX + endX) / 2;
              const midZ = (startZ + endZ) / 2;
              addYardItem({
                id: `fence-${Date.now()}`,
                type: "prefab",
                prefabKind: "fence_segment",
                x: Math.round(midX),
                z: Math.round(midZ),
                rot: angle + Math.PI / 2,
                params: { lengthM: Math.max(0.5, lengthM), heightM: 1.8 },
              });
            }
            setFenceDraw(null);
            setFencePreviewEnd(null);
          }}
          onMouseLeave={() => {
            if (drawMode === "fence" && fenceDraw) {
              setFenceDraw(null); setFencePreviewEnd(null);
            }
            if (drawMode === "path") setPathPreview(null);
          }}
        >
          {/* Drafting grid — DARK theme, faint white lines */}
          <defs>
            <pattern id="yard-grid-minor" width={SVG_PX / 30} height={SVG_PX / 30} patternUnits="userSpaceOnUse">
              <path d={`M ${SVG_PX / 30} 0 L 0 0 0 ${SVG_PX / 30}`} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
            </pattern>
            <pattern id="yard-grid-major" width={SVG_PX / 6} height={SVG_PX / 6} patternUnits="userSpaceOnUse">
              <path d={`M ${SVG_PX / 6} 0 L 0 0 0 ${SVG_PX / 6}`} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
            </pattern>
            <pattern id="house-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={5} stroke={INK} strokeWidth={0.4} strokeOpacity={0.40} />
            </pattern>
          </defs>
          <rect width={SVG_PX} height={SVG_PX} fill="url(#yard-grid-minor)" />
          <rect width={SVG_PX} height={SVG_PX} fill="url(#yard-grid-major)" />

          {/* Compass hidden per user request. */}
          {false && (
            <g transform={`translate(${SVG_PX - 50}, 50)`} style={{ pointerEvents: "none" }}>
              <circle r={28} fill="white" fillOpacity={0.92} stroke="#D1D5DB" strokeWidth={1.5} />
              <text textAnchor="middle" y={-11} fontSize={15} fontWeight="bold" fill="#1F2937" fontFamily="system-ui">N</text>
              <text textAnchor="middle" y={20}  fontSize={12} fill="#9CA3AF" fontFamily="system-ui">S</text>
              <text textAnchor="start"  x={8}   y={5}  fontSize={12} fill="#9CA3AF" fontFamily="system-ui">E</text>
              <text textAnchor="end"    x={-8}  y={5}  fontSize={12} fill="#9CA3AF" fontFamily="system-ui">W</text>
            </g>
          )}
          {/* Scale bar */}
          <g transform={`translate(20, ${SVG_PX - 24})`} style={{ pointerEvents: "none" }}>
            <line x1={0} y1={0} x2={500 / CM_PER_PX} y2={0} stroke={INK} strokeWidth={1.2} />
            <line x1={0} y1={-3} x2={0} y2={3} stroke={INK} strokeWidth={1.2} />
            <line x1={500 / CM_PER_PX} y1={-3} x2={500 / CM_PER_PX} y2={3} stroke={INK} strokeWidth={1.2} />
            <text x={500 / CM_PER_PX / 2} y={14} textAnchor="middle" fontSize={9} fill={INK}>5.00 m</text>
          </g>

          {/* ── Lot boundary + setback overlay ── */}
          {(() => {
            const lotPx = WIN_HALF_CM / CM_PER_PX;               // half-side of lot in SVG px
            const setbackPx = setbackCm / CM_PER_PX;             // setback in SVG px
            const cx = SVG_PX / 2, cy = SVG_PX / 2;
            return (
              <g style={{ pointerEvents: "none" }}>
                {/* Outer lot boundary — dashed orange */}
                <rect
                  x={cx - lotPx} y={cy - lotPx}
                  width={lotPx * 2} height={lotPx * 2}
                  fill="none"
                  stroke="rgba(251,146,60,0.55)"
                  strokeWidth={1.5}
                  strokeDasharray="8 5"
                />
                {/* Inner setback line — dashed lighter orange */}
                <rect
                  x={cx - lotPx + setbackPx} y={cy - lotPx + setbackPx}
                  width={(lotPx - setbackPx) * 2} height={(lotPx - setbackPx) * 2}
                  fill="none"
                  stroke="rgba(251,146,60,0.30)"
                  strokeWidth={1}
                  strokeDasharray="4 5"
                />
                {/* Setback label */}
                <text
                  x={cx - lotPx + setbackPx + 4}
                  y={cy - lotPx + setbackPx - 3}
                  fontSize={8} fill="rgba(251,146,60,0.70)"
                >setback {(setbackCm / 100).toFixed(1)} m</text>
              </g>
            );
          })()}

          {/* ── Sun shadow overlay — semi-transparent dark polygon showing
              where the house casts shadow at the current sun hour.
              Rendered ABOVE the grid but BELOW the house footprint so the
              house silhouette always reads clearly on top. ── */}
          {shadowPoly && (() => {
            const pts = shadowPoly
              .map(([sx, sz]) => `${SVG_PX / 2 + sx / CM_PER_PX},${SVG_PX / 2 + sz / CM_PER_PX}`)
              .join(" ");
            const cx = shadowPoly.reduce((s, [sx]) => s + sx, 0) / shadowPoly.length;
            const cz = shadowPoly.reduce((s, [, sz]) => s + sz, 0) / shadowPoly.length;
            return (
              <g style={{ pointerEvents: "none" }}>
                <polygon
                  points={pts}
                  fill="rgba(20,14,0,0.38)"
                  stroke="rgba(255,180,0,0.22)"
                  strokeWidth={1}
                  strokeDasharray="5 3"
                />
                <text
                  x={SVG_PX / 2 + cx / CM_PER_PX}
                  y={SVG_PX / 2 + cz / CM_PER_PX}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={8} fill="rgba(255,200,80,0.65)"
                  fontFamily="ui-monospace, Menlo, monospace"
                  letterSpacing="0.08em">
                  ☽ {locale === "en" ? "Shade" : "阴影区"}
                </text>
              </g>
            );
          })()}

          {/* House footprint — per-room polygons with hatching overlay */}
          {/* Z axis is NOT flipped (after coord-refactor): -Z (north / kitchen-back-of-house side)
              renders at small SVG-Y (top of lot), consistent with FloorPlanAll convention
              ("north at top"). Yard items (trees, gate, fence) use the same +sz mapping. */}
          {(() => {
            const toSvg = ([x, z]: [number, number]): [number, number] => [
              SVG_PX / 2 + x / CM_PER_PX,
              SVG_PX / 2 + z / CM_PER_PX,
            ];
            const cxBox = SVG_PX / 2 + (footprint.minX + footprint.maxX) / 2 / CM_PER_PX;
            const cyBox = SVG_PX / 2 + (footprint.minZ + footprint.maxZ) / 2 / CM_PER_PX;
            return (
              <g style={{ pointerEvents: "none" }}>
                {/* Subtle drop shadow */}
                <rect
                  x={SVG_PX / 2 + footprint.minX / CM_PER_PX + 4}
                  y={SVG_PX / 2 + footprint.minZ / CM_PER_PX + 4}
                  width={(footprint.maxX - footprint.minX) / CM_PER_PX}
                  height={(footprint.maxZ - footprint.minZ) / CM_PER_PX}
                  fill="rgba(0,0,0,0.4)" rx={2}
                />
                {/* Per-room slabs — soft white surface + hatch overlay */}
                {houseRooms.map(({ room, points }) => {
                  const ptsAttr = points.map(toSvg).map(p => p.join(",")).join(" ");
                  return (
                    <g key={room}>
                      <polygon points={ptsAttr} fill="rgba(255,255,255,0.10)" />
                      <polygon points={ptsAttr} fill="url(#house-hatch)" />
                      <polygon points={ptsAttr} fill="none" stroke={INK} strokeWidth={0.6} />
                    </g>
                  );
                })}
                {/* Thick outer wall outline */}
                <rect
                  x={SVG_PX / 2 + footprint.minX / CM_PER_PX}
                  y={SVG_PX / 2 + footprint.minZ / CM_PER_PX}
                  width={(footprint.maxX - footprint.minX) / CM_PER_PX}
                  height={(footprint.maxZ - footprint.minZ) / CM_PER_PX}
                  fill="none" stroke={INK} strokeWidth={2.2} strokeLinejoin="round"
                />
                {/* Label — technical drawing typography */}
                <text x={cxBox} y={cyBox - 3} textAnchor="middle" fontSize={9}
                  fill={INK} fontFamily="ui-monospace, Menlo, monospace" fontWeight={700} letterSpacing="0.15em">HOUSE</text>
                <text x={cxBox} y={cyBox + 10} textAnchor="middle" fontSize={8}
                  fill={INK_LIGHT} fontFamily="ui-monospace, Menlo, monospace">
                  {Math.round((footprint.maxX - footprint.minX) / 100 * 10) / 10} × {Math.round((footprint.maxZ - footprint.minZ) / 100 * 10) / 10} m
                </text>
              </g>
            );
          })()}

          {/* Zones — drawn UNDER everything else (paving) */}
          {yardItems.filter(isYardZone).map(zone => {
            const sx = SVG_PX / 2 + zone.x / CM_PER_PX;
            const sz = SVG_PX / 2 + zone.z / CM_PER_PX;
            const polyPx = zone.polygon.map(([px, pz]) => [px / CM_PER_PX, pz / CM_PER_PX] as [number, number]);
            const isSel = selectedId === zone.id;
            return (
              <g key={zone.id}
                transform={`translate(${sx} ${sz}) rotate(${((zone.rot ?? 0) * 180) / Math.PI})`}
                style={{ cursor: drag?.id === zone.id ? "grabbing" : "grab" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelectedId(zone.id);
                  const { x, z } = svgPtToWorld(e.clientX, e.clientY);
                  setDrag({ id: zone.id, offsetX: x - zone.x, offsetZ: z - zone.z });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <ZoneGlyph zone={zone} polygonPx={polyPx} selected={isSel} />
              </g>
            );
          })}

          {/* Prefabs — drawn ABOVE zones, below singletons */}
          {yardItems.filter(isYardPrefab).map(prefab => {
            const def = getPrefabDef(prefab.prefabKind);
            if (!def) return null;
            const sx = SVG_PX / 2 + prefab.x / CM_PER_PX;
            const sz = SVG_PX / 2 + prefab.z / CM_PER_PX;
            const fpPx = {
              w: def.defaultFootprintCm.w / CM_PER_PX,
              d: def.defaultFootprintCm.d / CM_PER_PX,
            };
            const isSel = selectedId === prefab.id;
            return (
              <g key={prefab.id}
                transform={`translate(${sx} ${sz}) rotate(${((prefab.rot ?? 0) * 180) / Math.PI})`}
                style={{ cursor: drag?.id === prefab.id ? "grabbing" : "grab" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelectedId(prefab.id);
                  const { x, z } = svgPtToWorld(e.clientX, e.clientY);
                  setDrag({ id: prefab.id, offsetX: x - prefab.x, offsetZ: z - prefab.z });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <PrefabGlyph kind={prefab.prefabKind} footprintPx={fpPx} selected={isSel} />
                {isSel && (
                  <g style={{ pointerEvents: "auto" }}>
                    <g transform={`translate(${fpPx.w / 2 + 10} ${-fpPx.d / 2 - 10})`}
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeYardItem(prefab.id);
                        setSelectedId(null);
                      }}
                    >
                      <circle r={9} fill="#EF4444" stroke="#fff" strokeWidth={1.5} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={11} fill="white" fontWeight="bold"
                        style={{ pointerEvents: "none" }}>✕</text>
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* Yard items — architectural top-down glyphs (no emoji).
              Filter to singletons only — prefabs/zones are rendered above. */}
          {yardItems.filter(isYardSingleton).map(item => {
            const asset = getOutdoorAssetByKind(item.kind);
            if (!asset) return null;
            const sx = SVG_PX / 2 + item.x / CM_PER_PX;
            const sz = SVG_PX / 2 + item.z / CM_PER_PX;
            const r = Math.max(8, asset.radiusCm / CM_PER_PX);
            const isSel = selectedId === item.id;
            const itemViolations = violationMap.get(item.id) ?? [];
            const hasRequired = itemViolations.some(v => v.severity === "required");
            const hasIssue = itemViolations.length > 0;
            return (
              <g key={item.id}
                transform={`translate(${sx} ${sz}) rotate(${((item.rot ?? 0) * 180) / Math.PI})`}
                style={{ cursor: drag?.id === item.id ? "grabbing" : "grab" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelectedId(item.id);
                  const { x, z } = svgPtToWorld(e.clientX, e.clientY);
                  setDrag({ id: item.id, offsetX: x - item.x, offsetZ: z - item.z });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Warning halo — red ring for required, amber for recommended */}
                {hasIssue && (
                  <circle r={r + 4} fill="none"
                    stroke={hasRequired ? "#DC2626" : "#D97706"}
                    strokeWidth={1.6}
                    strokeDasharray="3 2"
                    opacity={0.85} />
                )}
                <AssetGlyph asset={asset} r={r} selected={isSel} />
                {isSel && (
                  <g style={{ pointerEvents: "auto" }}>
                    {/* Delete handle (top-right) */}
                    <g transform={`translate(${r + 10} ${-r - 10})`}
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeYardItem(item.id);
                        setSelectedId(null);
                      }}
                    >
                      <circle r={9} fill="#EF4444" stroke="#fff" strokeWidth={1.5} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={11} fill="white" fontWeight="bold"
                        style={{ pointerEvents: "none" }}>✕</text>
                    </g>
                    {/* Rotate handle (bottom-right) */}
                    <g transform={`translate(${r + 10} ${r + 10})`}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const startRot = item.rot ?? 0;
                        const start = svgPtToWorld(e.clientX, e.clientY);
                        const baseAng = Math.atan2(start.z - item.z, start.x - item.x);
                        const onMove = (ev: PointerEvent) => {
                          const cur = svgPtToWorld(ev.clientX, ev.clientY);
                          const ang = Math.atan2(cur.z - item.z, cur.x - item.x);
                          updateYardItem(item.id, { rot: startRot + (ang - baseAng) });
                        };
                        const onUp = () => {
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                        };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp);
                      }}
                    >
                      <circle r={9} fill="#6366F1" stroke="#fff" strokeWidth={1.5} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={11} fill="white" fontWeight="bold"
                        style={{ pointerEvents: "none" }}>↻</text>
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* Empty hint */}
          {yardItems.length === 0 && (
            <text x={SVG_PX / 2} y={SVG_PX / 2 + 100} textAnchor="middle"
              fontSize={10} fill={INK_LIGHT} fontFamily="ui-monospace, Menlo, monospace"
              style={{ pointerEvents: "none" }} letterSpacing="0.1em">
              DRAG ELEMENTS FROM LIBRARY →
            </text>
          )}

          {/* ── Rendered yard paths (walkways) ── */}
          {yardPaths.map(path => {
            if (path.points.length < 2) return null;
            const pts = path.points.map(([x, z]) => {
              const px = SVG_PX / 2 + x / CM_PER_PX;
              const pz = SVG_PX / 2 + z / CM_PER_PX;
              return `${px},${pz}`;
            }).join(" ");
            const strokeW = Math.max(1, path.widthCm / CM_PER_PX);
            const matColors: Record<string, [string, string]> = {
              stone:  ["rgba(180,160,120,0.65)", "rgba(200,180,140,0.35)"],
              gravel: ["rgba(160,150,130,0.60)", "rgba(180,170,150,0.30)"],
              grass:  ["rgba(90,160,80,0.60)",   "rgba(120,190,100,0.30)"],
              brick:  ["rgba(190,100,70,0.65)",  "rgba(210,120,90,0.30)"],
            };
            const [bodyColor, edgeColor] = matColors[path.material ?? "stone"] ?? matColors.stone;
            const isSel = selectedId === path.id;
            return (
              <g key={path.id}>
                {/* Selected outline halo — only when this path is selected */}
                {isSel && (
                  <polyline points={pts} fill="none"
                    stroke={SEL_INK} strokeWidth={strokeW + 4}
                    strokeLinecap="round" strokeLinejoin="round"
                    opacity={0.55} style={{ pointerEvents: "none" }} />
                )}
                {/* Path body */}
                <polyline points={pts} fill="none"
                  stroke={bodyColor} strokeWidth={strokeW}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: "none" }} />
                {/* Path edge dashes */}
                <polyline points={pts} fill="none"
                  stroke={edgeColor} strokeWidth={strokeW + 1}
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="4 6"
                  style={{ pointerEvents: "none" }} />
                {/* Invisible-but-fat hit area so the entire path body is
                    clickable for selection. Without this the only way to
                    delete a path was the tiny red dot at the first-
                    segment midpoint — easy to miss, no Delete-key
                    support. */}
                <polyline points={pts} fill="none"
                  stroke="rgba(0,0,0,0)" strokeWidth={Math.max(16, strokeW + 8)}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedId(path.id); }}
                  onClick={(e) => e.stopPropagation()} />
                {/* Delete handle on first segment midpoint — bumped to
                    r=10 so it's easier to hit; stopPropagation so the
                    SVG background's deselect handler doesn't race it. */}
                {(() => {
                  const [ax, az] = path.points[0];
                  const [bx, bz] = path.points[1];
                  const mx = SVG_PX / 2 + (ax + bx) / 2 / CM_PER_PX;
                  const mz = SVG_PX / 2 + (az + bz) / 2 / CM_PER_PX;
                  return (
                    <g style={{ pointerEvents: "all", cursor: "pointer" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeYardPath(path.id);
                        if (isSel) setSelectedId(null);
                      }}>
                      <circle cx={mx} cy={mz} r={10}
                        fill="#EF4444" stroke="white" strokeWidth={1.5} />
                      <text x={mx} y={mz} textAnchor="middle" dominantBaseline="middle"
                        fontSize={11} fontWeight="bold" fill="white"
                        style={{ pointerEvents: "none" }}>✕</text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Path draw rubber-band preview */}
          {drawMode === "path" && (() => {
            const allPts = pathPreview ? [...pathPts, pathPreview] : pathPts;
            if (allPts.length < 1) return null;
            const pts = allPts.map(([x, z]) => {
              const px = SVG_PX / 2 + x / CM_PER_PX;
              const pz = SVG_PX / 2 + z / CM_PER_PX;
              return `${px},${pz}`;
            }).join(" ");
            const strokeW = Math.max(1, pathWidthCm / CM_PER_PX);
            return (
              <g style={{ pointerEvents: "none" }}>
                <polyline points={pts} fill="none"
                  stroke="rgba(59,130,246,0.5)" strokeWidth={strokeW}
                  strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={pts} fill="none"
                  stroke="#60A5FA" strokeWidth={1.5}
                  strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" />
                {pathPts.map(([x, z], i) => {
                  const px = SVG_PX / 2 + x / CM_PER_PX;
                  const pz = SVG_PX / 2 + z / CM_PER_PX;
                  return <circle key={i} cx={px} cy={pz} r={4} fill="#60A5FA" stroke="white" strokeWidth={1.5} />;
                })}
                {pathPreview && (
                  <circle
                    cx={SVG_PX / 2 + pathPreview[0] / CM_PER_PX}
                    cy={SVG_PX / 2 + pathPreview[1] / CM_PER_PX}
                    r={3} fill="white" stroke="#60A5FA" strokeWidth={1.5} />
                )}
                <text x={SVG_PX / 2} y={SVG_PX - 20} textAnchor="middle"
                  fontSize={9} fill="#60A5FA" fontFamily="ui-monospace, Menlo, monospace">
                  {locale === "en" ? `Click to add a node · double-click to finish · backspace to undo last point · ESC to cancel (${pathPts.length} pts)` : `点击添加节点 · 双击结束 · 退格撤销最后一点 · ESC 取消 (${pathPts.length} 点)`}
                </text>
              </g>
            );
          })()}

          {/* Fence rubber-band preview line */}
          {drawMode === "fence" && fenceDraw && fencePreviewEnd && (() => {
            const [sx, sz] = fenceDraw.startPx;
            const ex = SVG_PX / 2 + fencePreviewEnd[0] / CM_PER_PX;
            const ez = SVG_PX / 2 + fencePreviewEnd[1] / CM_PER_PX;
            const dx = fencePreviewEnd[0] - fenceDraw.startCm[0];
            const dz = fencePreviewEnd[1] - fenceDraw.startCm[1];
            const lenM = (Math.sqrt(dx * dx + dz * dz) / 100).toFixed(1);
            return (
              <g style={{ pointerEvents: "none" }}>
                <line
                  x1={sx} y1={sz} x2={ex} y2={ez}
                  stroke="#A8845A" strokeWidth={2}
                  strokeDasharray="6 3"
                />
                <circle cx={sx} cy={sz} r={4} fill="#A8845A" />
                <circle cx={ex} cy={ez} r={4} fill="#A8845A" />
                <text x={(sx + ex) / 2} y={(sz + ez) / 2 - 6}
                  textAnchor="middle" fontSize={9}
                  fill="#A8845A" fontFamily="ui-monospace, Menlo, monospace">
                  {lenM} m
                </text>
              </g>
            );
          })()}

          {/* Fence draw mode hint */}
          {drawMode === "fence" && !fenceDraw && (
            <text x={SVG_PX / 2} y={SVG_PX - 20} textAnchor="middle"
              fontSize={9} fill="#A8845A" fontFamily="ui-monospace, Menlo, monospace"
              style={{ pointerEvents: "none" }}>
              {locale === "en" ? "Click and drag to draw a fence — press ESC to exit" : "点击拖拽绘制围栏 — 按 ESC 退出"}
            </text>
          )}

          {/* ── DEBUG: NWES direction labels — commented out for production.
               Re-enable to debug coord directions in 院子图. ── */}
          {/* {(() => {
            const cx = vbOrigin + vbSize / 2;
            const cy = vbOrigin + vbSize / 2;
            const labels = [
              { x: cx,                       y: vbOrigin + 28,            t: "N (-Z, world)", anchor: "middle" as const },
              { x: cx,                       y: vbOrigin + vbSize - 10,   t: "S (+Z, world)", anchor: "middle" as const },
              { x: vbOrigin + 10,            y: cy,                       t: "W (-X)",        anchor: "start"  as const },
              { x: vbOrigin + vbSize - 10,   y: cy,                       t: "E (+X)",        anchor: "end"    as const },
            ];
            return labels.map((l, i) => (
              <text key={i} x={l.x} y={l.y} textAnchor={l.anchor}
                fontSize={28} fontWeight={900} fill="#FF1493" stroke="#FFFFFF" strokeWidth={2}
                paintOrder="stroke" style={{ pointerEvents: "none", userSelect: "none" }}>
                {l.t}
              </text>
            ));
          })()} */}
        </svg>
      </div>

      <div className="px-4 py-1.5 text-[10px] shrink-0 flex items-center gap-4"
        style={{ background: "rgba(255,255,255,0.04)", borderTop: "1px solid rgba(255,255,255,0.08)", color: "#9CA3AF" }}>
        <span>SHEET 30 × 30 m</span>
        <span>·</span>
        <span>GRID 1 m</span>
        <span>·</span>
        <span>SNAP {SNAP_CM} cm</span>
        <span className="ml-auto">SHIFT = free move</span>
      </div>
    </div>
  );
}

// Small "go to exterior settings" button used inside YardPlanInspector header.
// Avoids importing useDesignerStore at the top level of a sub-component.
function YardPlanNavToExterior() {
  const locale = useLocale();
  const setViewMode = useDesignerStore(s => s.setViewMode);
  return (
    <button
      onClick={() => setViewMode("exterior")}
      className="text-[9px] px-2 py-0.5 rounded-full shrink-0"
      style={{ background: "#EEF2FF", color: "#4F46E5" }}
      title={locale === "en" ? "Switch to exterior settings panel" : "切换到外观设置面板"}
    >
      {locale === "en" ? "Exterior settings" : "外观设置"} →
    </button>
  );
}

// ─── Right rail: inspector for the selected yard item ──────
export function YardPlanInspector() {
  const selectedId = useSharedSelectedYardId();
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const items      = useDesignerStore(s => s.floorPlans[0].yardPlan?.items ?? EMPTY_YARD_ITEMS);
  const yardPaths  = useDesignerStore(s => s.floorPlans[0].yardPlan?.paths ?? EMPTY_YARD_PATHS);
  const updateYardItem = useDesignerStore(s => s.updateYardItem);
  const removeYardItem = useDesignerStore(s => s.removeYardItem);
  const addYardItem    = useDesignerStore(s => s.addYardItem);
  const { bbox: footprint } = useHouseRooms();
  const locale = useLocale();

  // Smart suggestions — same evaluator as the canvas overlay (now includes path connectivity)
  const violations = useMemo(() => evaluateYardPlan(items, footprint, yardPaths), [items, footprint, yardPaths]);
  const item = selectedId ? items.find(i => i.id === selectedId) : null;
  // Asset lookup only makes sense for singletons; prefabs / zones get
  // their own descriptor below.
  const asset = item && isYardSingleton(item) ? getOutdoorAssetByKind(item.kind) : null;
  const itemViolations = useMemo(
    () => item ? violations.filter(v => v.itemId === item.id || v.otherId === item.id) : [],
    [violations, item]
  );

  // Prefab / Zone inspector — minimal: label + position + delete. The
  // common-fields inspector below handles X/Z/scale/rot for everyone.
  if (item && isYardPrefab(item)) {
    const def = getPrefabDef(item.prefabKind);
    return (
      <aside className="h-full flex flex-col" style={{ background: "var(--ds-surface)", borderLeft: "1px solid var(--ds-border)" }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--ds-border)" }}>
          <svg viewBox="-32 -22 64 44" width="44" height="32">
            <PrefabGlyph kind={item.prefabKind} footprintPx={{ w: 50, d: 32 }} />
          </svg>
          <div>
            <div className="text-xs font-bold" style={{ color: "var(--ds-text)" }}>{locale === "en" ? (def?.labelEn ?? item.prefabKind) : (def?.label ?? item.prefabKind)}</div>
            <div className="text-[10px]" style={{ color: "var(--ds-text-3)" }}>PREFAB · {item.prefabKind}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11px]">
          <section>
            <div className="font-semibold mb-1.5" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Position (m)" : "位置 (m)"}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1">
                <span className="text-gray-400 w-3">X</span>
                <input type="number" step={0.25}
                  value={(item.x / 100).toFixed(2)}
                  onChange={e => updateYardItem(item.id, { x: Math.round(parseFloat(e.target.value) * 100) })}
                  className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-gray-400 w-3">Z</span>
                <input type="number" step={0.25}
                  value={(item.z / 100).toFixed(2)}
                  onChange={e => updateYardItem(item.id, { z: Math.round(parseFloat(e.target.value) * 100) })}
                  className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
              </label>
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Rotation" : "旋转"}</span>
              <span className="font-mono text-gray-500">{Math.round(((item.rot ?? 0) * 180 / Math.PI + 360) % 360)}°</span>
            </div>
            <input type="range" min={0} max={360} step={5}
              value={Math.round(((item.rot ?? 0) * 180 / Math.PI + 360) % 360)}
              onChange={e => updateYardItem(item.id, { rot: parseFloat(e.target.value) * Math.PI / 180 })}
              className="w-full accent-indigo-500" />
          </section>
          <section>
            <button onClick={() => { removeYardItem(item.id); setSharedSelectedId(null); }}
              className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors border"
              style={{ background: "white", borderColor: "#FCA5A5", color: "#DC2626" }}>
              ✕ {locale === "en" ? "Delete" : "删除"}
            </button>
          </section>
        </div>
      </aside>
    );
  }
  if (item && isYardZone(item)) {
    const style = ZONE_STYLES[item.zoneKind];
    return (
      <aside className="h-full flex flex-col" style={{ background: "var(--ds-surface)", borderLeft: "1px solid var(--ds-border)" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--ds-border)" }}>
          <div className="text-xs font-bold" style={{ color: "var(--ds-text)" }}>{locale === "en" ? style.labelEn : style.label}</div>
          <div className="text-[10px]" style={{ color: "var(--ds-text-3)" }}>ZONE · {item.zoneKind}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11px]">
          <div className="text-[11px]" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? style.descEn : style.desc}</div>
          <section>
            <div className="font-semibold mb-1.5" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Position (m)" : "位置 (m)"}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1">
                <span className="text-gray-400 w-3">X</span>
                <input type="number" step={0.25}
                  value={(item.x / 100).toFixed(2)}
                  onChange={e => updateYardItem(item.id, { x: Math.round(parseFloat(e.target.value) * 100) })}
                  className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-gray-400 w-3">Z</span>
                <input type="number" step={0.25}
                  value={(item.z / 100).toFixed(2)}
                  onChange={e => updateYardItem(item.id, { z: Math.round(parseFloat(e.target.value) * 100) })}
                  className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
              </label>
            </div>
          </section>
          {/* §10.3 zone sub-type selector — refines the parent zoneKind
              for sun-aware placement + clearance sub-rules. Optional. */}
          <section>
            <div className="font-semibold mb-1.5" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Subtype (optional)" : "子类型 (可选)"}</div>
            <select
              value={item.subtype ?? ""}
              onChange={e => updateYardItem(item.id, { subtype: (e.target.value || undefined) as YardZone["subtype"] })}
              className="w-full px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400 text-[11px]">
              <option value="">{locale === "en" ? "— Generic —" : "— 通用 —"}</option>
              <option value="entry-sequence">{locale === "en" ? "Entry sequence" : "入户序列 entry-sequence"}</option>
              <option value="threshold">{locale === "en" ? "Threshold" : "门廊过渡 threshold"}</option>
              <option value="outdoor-room">{locale === "en" ? "Outdoor room" : "户外客厅 outdoor-room"}</option>
              <option value="sunset-terrace">{locale === "en" ? "Sunset terrace" : "夕阳露台 sunset-terrace"}</option>
              <option value="mudroom-side">{locale === "en" ? "Mudroom side yard" : "杂物侧院 mudroom-side"}</option>
              <option value="kitchen-garden">{locale === "en" ? "Kitchen garden" : "厨园菜圃 kitchen-garden"}</option>
              <option value="fragrance-corridor">{locale === "en" ? "Fragrance corridor" : "香径花廊 fragrance-corridor"}</option>
              <option value="wild-edge">{locale === "en" ? "Wild edge" : "野趣边界 wild-edge"}</option>
              <option value="back-against">{locale === "en" ? "Back-against seating" : "靠墙安坐 back-against"}</option>
              <option value="service-yard">{locale === "en" ? "Service yard" : "服务后院 service-yard"}</option>
              <option value="kids-sightline">{locale === "en" ? "Kids sightline" : "儿童视线 kids-sightline"}</option>
            </select>
          </section>
          <section>
            <button onClick={() => { removeYardItem(item.id); setSharedSelectedId(null); }}
              className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors border"
              style={{ background: "white", borderColor: "#FCA5A5", color: "#DC2626" }}>
              ✕ {locale === "en" ? "Delete" : "删除"}
            </button>
          </section>
        </div>
      </aside>
    );
  }

  if (!item || !asset) {
    // No selection — show global smart-suggestions summary instead of empty
    const requiredV     = violations.filter(v => v.severity === "required");
    const recommendedV  = violations.filter(v => v.severity === "recommended");
    const emptyHints    = getEmptyStateHints(items);
    return (
      <aside className="h-full flex flex-col bg-white" style={{ borderLeft: "1px solid #E5E7EB" }}>
        <div className="px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid #E5E7EB" }}>
          <div className="flex-1 text-[10px] font-semibold tracking-widest text-gray-500" style={{ letterSpacing: "0.12em" }}>
            {locale === "en" ? `SMART SUGGESTIONS${violations.length > 0 ? ` (${violations.length})` : ""}` : `智能建议${violations.length > 0 ? `（${violations.length}）` : ""}`}
          </div>
          <YardPlanNavToExterior />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {violations.length === 0 && emptyHints.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
              <div className="text-3xl text-green-500">✓</div>
              <div className="text-[11px] text-gray-700">
                {locale === "en" ? "No issues found" : "未发现问题"}
              </div>
              <div className="text-[10px] text-gray-400">
                {locale === "en" ? "Click an element to see its details, or drop new ones from the left." : "点选元素查看属性，或从左侧拖入新元素"}
              </div>
            </div>
          ) : (
            <>
              {/* ── Empty-state getting-started hints (sparse yard) ── */}
              {emptyHints.length > 0 && violations.length === 0 && (
                <div className="mb-2">
                  <div className="text-[10px] font-bold mb-1.5" style={{ color: "#6366F1" }}>
                    {locale === "en" ? "💡 GETTING STARTED" : "💡 开始规划"}
                  </div>
                  {emptyHints.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded-lg mb-1.5"
                      style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}>
                      <span className="text-base leading-none mt-0.5 shrink-0">{h.icon}</span>
                      <span className="text-[10px] leading-snug" style={{ color: "#4338CA" }}>
                        {locale === "en" ? h.reasonEn : h.reasonZh}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {requiredV.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold mb-1" style={{ color: "#B91C1C" }}>
                    ⚠ {requiredV.length} {locale === "en" ? "REQUIRED" : "必须修改"}
                  </div>
                  {requiredV.map((v, i) => (
                    <ViolationCard key={i} v={v} locale={locale} />
                  ))}
                </div>
              )}
              {recommendedV.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold mb-1" style={{ color: "#B45309" }}>
                    ⚠ {recommendedV.length} {locale === "en" ? "RECOMMENDED" : "建议调整"}
                  </div>
                  {recommendedV.map((v, i) => (
                    <ViolationCard key={i} v={v} locale={locale} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    );
  }

  const scale = item.scale ?? 1;
  const rot   = item.rot ?? 0;
  const rotDeg = Math.round((rot * 180 / Math.PI + 360) % 360);

  return (
    <aside className="h-full flex flex-col" style={{ background: "var(--ds-surface)", borderLeft: "1px solid var(--ds-border)" }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--ds-border)" }}>
        <svg viewBox="-32 -32 64 64" width="36" height="36">
          <AssetGlyph asset={asset} r={26} />
        </svg>
        <div>
          <div className="text-xs font-bold" style={{ color: "var(--ds-text)" }}>{locale === "en" ? asset.labelEn : asset.label}</div>
          <div className="text-[10px]" style={{ color: "var(--ds-text-3)" }}>{asset.kind}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11px]">
        {/* Smart-suggestions for this specific item */}
        {itemViolations.length > 0 && (
          <section>
            <div className="text-[10px] font-bold mb-1.5 tracking-widest" style={{ color: "#B45309", letterSpacing: "0.1em" }}>
              ⚠ {itemViolations.length} {locale === "en" ? "ISSUES" : "项问题"}
            </div>
            {itemViolations.map((v, i) => <ViolationCard key={i} v={v} locale={locale} />)}
          </section>
        )}
        {/* Position */}
        <section>
          <div className="font-semibold mb-1.5" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Position (m)" : "位置 (m)"}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1">
              <span className="text-gray-400 w-3">X</span>
              <input type="number" step={0.25}
                value={(item.x / 100).toFixed(2)}
                onChange={e => updateYardItem(item.id, { x: Math.round(parseFloat(e.target.value) * 100) })}
                className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-gray-400 w-3">Z</span>
              <input type="number" step={0.25}
                value={(item.z / 100).toFixed(2)}
                onChange={e => updateYardItem(item.id, { z: Math.round(parseFloat(e.target.value) * 100) })}
                className="flex-1 px-2 py-1 rounded border border-gray-200 outline-none focus:border-blue-400" />
            </label>
          </div>
        </section>

        {/* Scale slider */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Scale" : "缩放"}</span>
            <span className="font-mono text-gray-500">{scale.toFixed(2)}×</span>
          </div>
          <input type="range" min={0.4} max={2.5} step={0.05}
            value={scale}
            onChange={e => updateYardItem(item.id, { scale: parseFloat(e.target.value) })}
            className="w-full accent-indigo-500" />
        </section>

        {/* Rotation slider */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold" style={{ color: "var(--ds-text-2)" }}>{locale === "en" ? "Rotation" : "旋转"}</span>
            <span className="font-mono text-gray-500">{rotDeg}°</span>
          </div>
          <input type="range" min={0} max={360} step={5}
            value={rotDeg}
            onChange={e => updateYardItem(item.id, { rot: parseFloat(e.target.value) * Math.PI / 180 })}
            className="w-full accent-indigo-500" />
        </section>

        {/* Actions */}
        <section className="space-y-2">
          <button
            onClick={() => {
              const id = `y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
              addYardItem({
                ...item,
                id,
                x: item.x + 100, // offset 1m so the copy is visible
                z: item.z + 100,
              });
              setSharedSelectedId(id);
            }}
            className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors border"
            style={{ background: "white", borderColor: "#6366F1", color: "#6366F1" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#EEF2FF"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}
          >
            ⧉ {locale === "en" ? "Duplicate" : "复制"}
          </button>
          <button
            onClick={() => {
              removeYardItem(item.id);
              setSharedSelectedId(null);
            }}
            className="w-full py-2 rounded-lg text-[12px] font-semibold transition-colors border"
            style={{ background: "white", borderColor: "#FCA5A5", color: "#DC2626" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "white"; }}
          >
            ✕ {locale === "en" ? "Delete" : "删除"}
          </button>
        </section>
      </div>
    </aside>
  );
}
