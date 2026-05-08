"use client";

/**
 * DesignVariants — "生成变体" button (borrowed from pascal editor's generate-variants pattern)
 *
 * Generates N randomised design variants by mutating:
 *   - roofStyle, wallColor, accentColor, wallMaterial, floors
 *
 * Each variant is shown as a colour swatch card. Clicking one applies it.
 */

import { useState, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import type { RoofStyle, WallMaterialType } from "@/lib/types";

// Simple mulberry32 PRNG — same approach as pascal editor
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOF_STYLES: RoofStyle[] = ["flat", "gable", "hip", "mansard", "chinese"];
const WALL_MATERIALS: WallMaterialType[] = ["render", "brick", "stone", "wood", "concrete"];
const WALL_PALETTES = [
  "#F2EEE6", "#FFFFFF", "#FFF8E8", "#F0E8D0", "#E8D8C0",
  "#D4B880", "#F0EDE8", "#787878", "#C0B8B0", "#EAE0D8",
];
const ROOF_PALETTES = [
  "#3A3A3A", "#2A4060", "#B83820", "#1E2238", "#4A5870",
  "#6B4820", "#181818", "#3C4848", "#525252", "#4A3828",
];
const ACCENT_PALETTES = [
  "#2A2A2A", "#007AFF", "#9B6B3A", "#882020", "#7A7050",
  "#5A3818", "#282828", "#E84000", "#1A6F3A", "#3A5A8A",
];

interface Variant {
  id: string;
  roofStyle: RoofStyle;
  wallMaterial: WallMaterialType;
  wallColor: string;
  roofColor: string;
  accentColor: string;
  label: string;
}

function generateVariants(seed: number, count = 4): Variant[] {
  const rng = mulberry32(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  return Array.from({ length: count }, (_, i) => ({
    id: `variant-${seed}-${i}`,
    roofStyle:    pick(ROOF_STYLES),
    wallMaterial: pick(WALL_MATERIALS),
    wallColor:    pick(WALL_PALETTES),
    roofColor:    pick(ROOF_PALETTES),
    accentColor:  pick(ACCENT_PALETTES),
    label:        `方案 ${i + 1}`,
  }));
}

export default function DesignVariants() {
  const [variants, setVariants]   = useState<Variant[]>([]);
  const [seed, setSeed]           = useState(Math.floor(Math.random() * 0xffff));
  const [loading, setLoading]     = useState(false);
  const setExterior               = useDesignerStore(s => s.setExterior);
  const exterior                  = useDesignerStore(s => s.exterior);

  const generate = useCallback(() => {
    setLoading(true);
    const newSeed = Math.floor(Math.random() * 0xffff);
    setSeed(newSeed);
    // Small delay for UX feedback
    setTimeout(() => {
      setVariants(generateVariants(newSeed, 4));
      setLoading(false);
    }, 180);
  }, []);

  const apply = useCallback((v: Variant) => {
    setExterior({
      preset:      "custom",
      roofStyle:   v.roofStyle,
      wallMaterial: v.wallMaterial,
      wallColor:   v.wallColor,
      roofColor:   v.roofColor,
      accentColor: v.accentColor,
    });
  }, [setExterior]);

  return (
    <div className="px-3 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          🎲 设计变体
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
          style={{
            background: loading ? "var(--ds-bg)" : "#EEF2FF",
            color: "#4F46E5",
            border: "1px solid #C7D2FE",
          }}
        >
          {loading ? "生成中…" : "重新生成"}
        </button>
      </div>

      {variants.length === 0 ? (
        <button
          onClick={generate}
          className="w-full py-3 rounded-xl border-2 border-dashed text-[11px] font-semibold text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-all"
          style={{ borderColor: "var(--ds-border)" }}
        >
          ✨ 点击生成 4 个风格变体
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {variants.map(v => {
            const isActive =
              exterior.wallColor === v.wallColor &&
              exterior.roofColor === v.roofColor &&
              exterior.roofStyle === v.roofStyle;
            return (
              <button
                key={v.id}
                onClick={() => apply(v)}
                className="flex flex-col gap-1 p-2 rounded-xl border-2 transition-all text-left"
                style={{
                  borderColor: isActive ? "#6366F1" : "transparent",
                  background: isActive ? "#EEF2FF" : "var(--ds-bg)",
                }}
              >
                {/* Color preview bar */}
                <div className="w-full h-5 rounded-lg flex overflow-hidden gap-px">
                  <div className="flex-1" style={{ background: v.wallColor }} />
                  <div className="w-5"   style={{ background: v.roofColor }} />
                  <div className="w-3"   style={{ background: v.accentColor }} />
                </div>
                <div className="text-[9px] text-gray-500 font-medium truncate">
                  {v.wallMaterial} · {v.roofStyle}
                </div>
                {isActive && (
                  <div className="text-[9px] font-bold" style={{ color: "#6366F1" }}>✓ 当前</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
