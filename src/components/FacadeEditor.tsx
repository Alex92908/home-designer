"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import type { FacadeSegment, FacadeSegmentType, FloorFacade, WallMaterialType, WallSide } from "@/lib/types";

// ─── Type metadata ──────────────────────────────────────────
type FacadeLabelKey = "typeGlass" | "typeSolid" | "typeWindow" | "typeDoor" | "typeColumn";
const TYPE_META: Record<FacadeSegmentType, { labelKey: FacadeLabelKey; icon: string; bg: string }> = {
  glass:  { labelKey: "typeGlass",  icon: "🪟", bg: "linear-gradient(135deg,#A8D8F0,#C8ECFF)" },
  solid:  { labelKey: "typeSolid",  icon: "▪", bg: "linear-gradient(135deg,#E8E4DC,#D4D0C8)" },
  window: { labelKey: "typeWindow", icon: "◻", bg: "linear-gradient(135deg,#B8CFEA,#D8E8F8)" },
  door:   { labelKey: "typeDoor",   icon: "🚪", bg: "linear-gradient(135deg,#D4A870,#C09050)" },
  column: { labelKey: "typeColumn", icon: "▐",  bg: "linear-gradient(135deg,#F0EDE8,#E0DDD6)" },
};

const SEG_CYCLE: FacadeSegmentType[] = ["glass", "solid", "window", "door", "column"];

function mkSeg(type: FacadeSegmentType = "solid"): FacadeSegment {
  return {
    id: Math.random().toString(36).slice(2, 9),
    type,
    widthFraction: 1,
    color:      type === "glass"  ? "#CBE8F5"
              : type === "column" ? "#F2EFE8"
              : "#F0ECE4",
    frameColor: "#1A1A1A",
    material: type === "column" ? "render"
            : type === "solid"  ? "render"
            : undefined,
    panelCount: type === "glass" ? 3 : undefined,
  };
}

function normalize(segs: FacadeSegment[]): FacadeSegment[] {
  const total = segs.reduce((s, g) => s + g.widthFraction, 0) || 1;
  return segs.map(s => ({ ...s, widthFraction: +(s.widthFraction / total).toFixed(3) }));
}

// ─── Preset definitions ────────────────────────────────────
/** @deprecated Facade-zone face names are now unified with room walls. Use
 *  `WallSide` (N | S | W | E) from `@/lib/types` instead. Kept as an alias
 *  for any external import; new code should reference `WallSide`. */
export type FaceName = WallSide;

type FacadePresetLabelKey = "presetGlassVilla" | "presetWoodGlass" | "presetBrickGlass" | "presetConcreteWindow";
type FacadePresetDescKey  = "presetGlassVillaDesc" | "presetWoodGlassDesc" | "presetBrickGlassDesc" | "presetConcreteWindowDesc";
interface FacadePreset {
  id: string; labelKey: FacadePresetLabelKey; icon: string; descKey: FacadePresetDescKey;
  generate: (floors: number) => FloorFacade[];
}

export const FACADE_PRESETS: FacadePreset[] = [
  {
    id: "glass-villa",
    labelKey: "presetGlassVilla",
    icon: "🏢",
    descKey: "presetGlassVillaDesc",
    generate: floors => Array.from({ length: floors }, (_, fi) => ({
      segments: fi === 0 ? [
        { id:"c1", type:"column", widthFraction:0.07, color:"#F2EFE8", material:"render", frameColor:"#1C1C1C" },
        { id:"d1", type:"door",   widthFraction:0.18, color:"#F2EFE8", material:"render", frameColor:"#1C1C1C" },
        { id:"g1", type:"glass",  widthFraction:0.68, color:"#CBE8F5", frameColor:"#1C1C1C", panelCount:4 },
        { id:"c2", type:"column", widthFraction:0.07, color:"#F2EFE8", material:"render", frameColor:"#1C1C1C" },
      ] as FacadeSegment[] : [
        { id:"c1", type:"column", widthFraction:0.07, color:"#F2EFE8", material:"render", frameColor:"#1C1C1C" },
        { id:"g1", type:"glass",  widthFraction:0.86, color:"#CBE8F5", frameColor:"#1C1C1C", panelCount:5 },
        { id:"c2", type:"column", widthFraction:0.07, color:"#F2EFE8", material:"render", frameColor:"#1C1C1C" },
      ] as FacadeSegment[],
    })),
  },
  {
    id: "wood-glass",
    labelKey: "presetWoodGlass",
    icon: "🌲",
    descKey: "presetWoodGlassDesc",
    generate: floors => Array.from({ length: floors }, (_, fi) => ({
      segments: fi === 0 ? [
        { id:"c1", type:"column", widthFraction:0.08, color:"#9C5C28", material:"wood", frameColor:"#5A3818" },
        { id:"d1", type:"door",   widthFraction:0.20, color:"#9C5C28", material:"wood", frameColor:"#5A3818" },
        { id:"g1", type:"glass",  widthFraction:0.64, color:"#D8EFF8", frameColor:"#5A3818", panelCount:4 },
        { id:"c2", type:"column", widthFraction:0.08, color:"#9C5C28", material:"wood", frameColor:"#5A3818" },
      ] as FacadeSegment[] : [
        { id:"c1", type:"column", widthFraction:0.08, color:"#9C5C28", material:"wood", frameColor:"#5A3818" },
        { id:"g1", type:"glass",  widthFraction:0.84, color:"#D8EFF8", frameColor:"#5A3818", panelCount:5 },
        { id:"c2", type:"column", widthFraction:0.08, color:"#9C5C28", material:"wood", frameColor:"#5A3818" },
      ] as FacadeSegment[],
    })),
  },
  {
    id: "brick-column-glass",
    labelKey: "presetBrickGlass",
    icon: "🏗️",
    descKey: "presetBrickGlassDesc",
    generate: floors => Array.from({ length: floors }, () => ({
      segments: [
        { id:"c1", type:"column", widthFraction:0.08, color:"#B05030", material:"brick", frameColor:"#1C1C1C" },
        { id:"g1", type:"glass",  widthFraction:0.38, color:"#CBE8F5", frameColor:"#1C1C1C", panelCount:3 },
        { id:"c2", type:"column", widthFraction:0.08, color:"#B05030", material:"brick", frameColor:"#1C1C1C" },
        { id:"g2", type:"glass",  widthFraction:0.38, color:"#CBE8F5", frameColor:"#1C1C1C", panelCount:2 },
        { id:"c3", type:"column", widthFraction:0.08, color:"#B05030", material:"brick", frameColor:"#1C1C1C" },
      ] as FacadeSegment[],
    })),
  },
  {
    id: "concrete-window",
    labelKey: "presetConcreteWindow",
    icon: "🏭",
    descKey: "presetConcreteWindowDesc",
    generate: floors => Array.from({ length: floors }, () => ({
      segments: [
        { id:"s1", type:"solid",  widthFraction:0.15, color:"#909090", material:"concrete", frameColor:"#1C1C1C" },
        { id:"w1", type:"window", widthFraction:0.35, color:"#909090", material:"concrete", frameColor:"#1C1C1C" },
        { id:"s2", type:"solid",  widthFraction:0.15, color:"#909090", material:"concrete", frameColor:"#1C1C1C" },
        { id:"w2", type:"window", widthFraction:0.35, color:"#909090", material:"concrete", frameColor:"#1C1C1C" },
      ] as FacadeSegment[],
    })),
  },
];

// ─── Main FacadeEditor ─────────────────────────────────────
interface Props {
  face: FaceName;
  floors: number;
}

export default function FacadeEditor({ face, floors }: Props) {
  const t = useT();
  const exterior   = useDesignerStore(s => s.exterior);
  const setExterior = useDesignerStore(s => s.setExterior);

  const [selectedFloor, setSelectedFloor] = useState(0);
  const [selectedIdx, setSelectedIdx]     = useState<number | null>(null);

  const faceFacades: FloorFacade[] = exterior.facades?.[face] ?? [];
  const floorFacade: FloorFacade   = faceFacades[selectedFloor] ?? { segments: [] };
  const segs = floorFacade.segments;
  const isActive = faceFacades.some(f => f.segments.length > 0);

  // Save updated segments for a given floor
  const saveSegs = (newSegs: FacadeSegment[], floorIdx = selectedFloor) => {
    const existing = (exterior.facades?.[face] ?? []) as FloorFacade[];
    const updated  = [...existing];
    while (updated.length <= floorIdx) updated.push({ segments: [] });
    updated[floorIdx] = { segments: normalize(newSegs) };
    setExterior({ facades: { ...(exterior.facades ?? {}), [face]: updated } });
  };

  const applyPreset = (p: FacadePreset) => {
    const generated = p.generate(floors);
    // Apply to all 4 faces so the whole building updates at once
    setExterior({
      facades: {
        ...(exterior.facades ?? {}),
        S: generated,
        N: generated,
        W: generated,
        E: generated,
      }
    });
    setSelectedFloor(0);
    setSelectedIdx(null);
  };

  const clearFace = () => {
    const cur = { ...(exterior.facades ?? {}) };
    delete cur[face];
    setExterior({ facades: Object.keys(cur).length ? cur : undefined });
    setSelectedIdx(null);
  };

  const addSegment = () => {
    const updated = normalize([...segs, mkSeg("solid")]);
    saveSegs(updated);
    setSelectedIdx(updated.length - 1);
  };

  const applyToAll = () => {
    for (let fi = 0; fi < floors; fi++) {
      saveSegs(segs.map(s => ({ ...s, id: Math.random().toString(36).slice(2, 9) })), fi);
    }
  };

  return (
    <div className="select-none">
      {/* ── Preset grid ── */}
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {FACADE_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            className="flex flex-col gap-1 p-2 rounded-xl border-2 border-transparent hover:border-indigo-200 bg-gray-50 text-left transition-all active:scale-[0.97]"
          >
            <span className="text-xl leading-none">{p.icon}</span>
            <div className="text-[9px] font-bold text-gray-700 leading-tight">{t.facadeEditor[p.labelKey]}</div>
            <div className="text-[8px] text-gray-400 leading-tight">{t.facadeEditor[p.descKey]}</div>
          </button>
        ))}
      </div>

      {/* ── Active editor ── */}
      {isActive && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">{t.facadeEditor.editComponents}</span>
            <button
              onClick={clearFace}
              className="text-[8px] px-2 py-0.5 rounded-full"
              style={{ background: "#FEF2F2", color: "#DC2626" }}
            >{t.facadeEditor.clearFacade}</button>
          </div>

          {/* Floor selector */}
          <div className="flex gap-1 mb-2">
            {Array.from({ length: floors }, (_, i) => (
              <button
                key={i}
                onClick={() => { setSelectedFloor(i); setSelectedIdx(null); }}
                className="flex-1 py-1 rounded-lg text-[9px] font-bold transition-colors"
                style={selectedFloor === i
                  ? { background: "#4F46E5", color: "#fff" }
                  : { background: "#F3F4F6", color: "#6B7280" }}
              >
                {i + 1}F
              </button>
            ))}
          </div>

          {/* Segment visualiser */}
          <div
            className="rounded-xl border border-gray-200 overflow-hidden mb-2"
            style={{ height: 56 }}
          >
            {segs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[10px] text-gray-400">
                {t.facadeEditor.clickAddComponent}
              </div>
            ) : (
              <div className="flex h-full">
                {segs.map((seg, idx) => {
                  const meta = TYPE_META[seg.type];
                  return (
                    <div
                      key={seg.id}
                      onClick={() => setSelectedIdx(idx === selectedIdx ? null : idx)}
                      className="relative flex flex-col items-center justify-center cursor-pointer border-r border-white/60 last:border-r-0 transition-all"
                      style={{
                        flexBasis: `${(seg.widthFraction) * 100}%`,
                        background: meta.bg,
                        outline: selectedIdx === idx ? "2px solid #4F46E5" : "none",
                        outlineOffset: -2,
                      }}
                    >
                      <span className="text-sm leading-none">{meta.icon}</span>
                      <div className="text-[7px] text-gray-600 mt-0.5 leading-none">
                        {(seg.widthFraction * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-1 mb-2">
            <button
              onClick={addSegment}
              className="flex-1 py-1 text-[9px] font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
            >{t.facadeEditor.add}</button>
            <button
              onClick={applyToAll}
              title={t.facadeEditor.applyToAllTitle}
              className="flex-1 py-1 text-[9px] font-bold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >{t.facadeEditor.applyToAll}</button>
          </div>

          {/* Segment detail editor */}
          {selectedIdx !== null && segs[selectedIdx] && (
            <SegmentEditor
              seg={segs[selectedIdx]}
              onChange={updated => {
                const next = segs.map((s, i) => i === selectedIdx ? updated : s);
                saveSegs(next);
              }}
              onDelete={() => {
                saveSegs(segs.filter((_, i) => i !== selectedIdx));
                setSelectedIdx(null);
              }}
              onMoveLeft={() => {
                if (selectedIdx === 0) return;
                const next = [...segs];
                [next[selectedIdx - 1], next[selectedIdx]] = [next[selectedIdx], next[selectedIdx - 1]];
                saveSegs(next);
                setSelectedIdx(selectedIdx - 1);
              }}
              onMoveRight={() => {
                if (selectedIdx >= segs.length - 1) return;
                const next = [...segs];
                [next[selectedIdx], next[selectedIdx + 1]] = [next[selectedIdx + 1], next[selectedIdx]];
                saveSegs(next);
                setSelectedIdx(selectedIdx + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Segment detail editor ─────────────────────────────────
function SegmentEditor({ seg, onChange, onDelete, onMoveLeft, onMoveRight }: {
  seg: FacadeSegment;
  onChange: (s: FacadeSegment) => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const tr = useT();
  const meta = TYPE_META[seg.type];
  const MAT_OPTIONS: { v: WallMaterialType; label: string }[] = [
    { v: "render",   label: tr.facadeEditor.matRender },
    { v: "concrete", label: tr.facadeEditor.matConcrete },
    { v: "brick",    label: tr.facadeEditor.matBrick },
    { v: "stone",    label: tr.facadeEditor.matStone },
    { v: "wood",     label: tr.facadeEditor.matWood },
  ];

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-2.5 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-1.5">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center text-sm shrink-0"
          style={{ background: meta.bg }}
        >{meta.icon}</div>
        <span className="text-[10px] font-bold text-indigo-800 flex-1">{tr.facadeEditor[meta.labelKey]}</span>
        <button onClick={onMoveLeft}  className="w-6 h-6 text-[10px] rounded-md bg-white text-gray-500 hover:text-indigo-600 font-bold">←</button>
        <button onClick={onMoveRight} className="w-6 h-6 text-[10px] rounded-md bg-white text-gray-500 hover:text-indigo-600 font-bold">→</button>
        <button onClick={onDelete}    className="w-6 h-6 text-[10px] rounded-md bg-red-50 text-red-500 hover:bg-red-100 font-bold">✕</button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-0.5">
        {SEG_CYCLE.map(t => (
          <button
            key={t}
            onClick={() => onChange({ ...seg, type: t })}
            className="flex-1 py-0.5 text-[8px] font-bold rounded-lg transition-colors"
            style={seg.type === t
              ? { background: "#4F46E5", color: "#fff" }
              : { background: "#E0E7FF", color: "#4F46E5" }}
          >{tr.facadeEditor[TYPE_META[t].labelKey]}</button>
        ))}
      </div>

      {/* Width slider */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-indigo-700 w-8 shrink-0">{tr.facadeEditor.width}</span>
        <input
          type="range" min={0.04} max={0.95} step={0.01}
          value={seg.widthFraction}
          onChange={e => onChange({ ...seg, widthFraction: parseFloat(e.target.value) })}
          className="flex-1 accent-indigo-500"
        />
        <span className="text-[9px] font-mono text-indigo-700 w-7 text-right shrink-0">
          {(seg.widthFraction * 100).toFixed(0)}%
        </span>
      </div>

      {/* Color + frame */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-indigo-700 w-8 shrink-0">{tr.facadeEditor.color}</span>
        <input type="color" value={seg.color ?? "#F0ECE4"}
          onChange={e => onChange({ ...seg, color: e.target.value })}
          className="w-6 h-6 rounded border border-indigo-200 cursor-pointer shrink-0" />
        <span className="text-[9px] text-indigo-700 ml-1 shrink-0">{tr.facadeEditor.frame}</span>
        <input type="color" value={seg.frameColor ?? "#1A1A1A"}
          onChange={e => onChange({ ...seg, frameColor: e.target.value })}
          className="w-6 h-6 rounded border border-indigo-200 cursor-pointer shrink-0" />
      </div>

      {/* Material selector (solid / column / window / door) */}
      {seg.type !== "glass" && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-indigo-700 w-8 shrink-0">{tr.facadeEditor.material}</span>
          <div className="flex gap-0.5 flex-wrap">
            {MAT_OPTIONS.map(o => (
              <button key={o.v}
                onClick={() => onChange({ ...seg, material: o.v })}
                className="px-1.5 py-0.5 text-[8px] font-bold rounded-lg transition-colors"
                style={(seg.material ?? "render") === o.v
                  ? { background: "#4F46E5", color: "#fff" }
                  : { background: "#E0E7FF", color: "#4F46E5" }}
              >{o.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Panel count (glass only) */}
      {seg.type === "glass" && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-indigo-700 w-8 shrink-0">{tr.facadeEditor.panels}</span>
          <input
            type="range" min={1} max={8} step={1}
            value={seg.panelCount ?? 3}
            onChange={e => onChange({ ...seg, panelCount: parseInt(e.target.value) })}
            className="flex-1 accent-indigo-500"
          />
          <span className="text-[9px] font-mono text-indigo-700 w-4 text-right shrink-0">
            {seg.panelCount ?? 3}
          </span>
        </div>
      )}
    </div>
  );
}
