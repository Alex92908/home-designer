/**
 * Material Library — PBR presets keyed off the catalog's `material` field.
 *
 * Each entry is a small bag of MeshStandardMaterial / MeshPhysicalMaterial
 * props — the DeskItem renderer instantiates the right material class
 * based on whether transmission / emission is needed.
 */

import type { PBRMaterial } from "@/lib/desk/catalog";

export interface MaterialSpec {
  kind: "standard" | "physical";
  color?: string;
  roughness?: number;
  metalness?: number;
  /** physical-only: glass / translucent */
  transmission?: number;
  ior?: number;
  thickness?: number;
  /** emissive glow (screens, RGB strips, bulbs) */
  emissive?: string;
  emissiveIntensity?: number;
  /** subtle clearcoat for premium plastic / leather */
  clearcoat?: number;
  clearcoatRoughness?: number;
}

export const MATERIAL_MAP: Record<PBRMaterial, MaterialSpec> = {
  "wood-oak":       { kind: "standard", color: "#c8a878", roughness: 0.68, metalness: 0.02 },
  "wood-walnut":    { kind: "standard", color: "#4a2d1e", roughness: 0.55, metalness: 0.02 },
  "metal-black":    { kind: "standard", color: "#1a1a1c", roughness: 0.38, metalness: 0.92 },
  "metal-silver":   { kind: "standard", color: "#d8d8d8", roughness: 0.28, metalness: 1.0  },
  "plastic-white":  { kind: "physical", color: "#f0efeb", roughness: 0.45, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.25 },
  "plastic-black":  { kind: "physical", color: "#18181a", roughness: 0.5,  metalness: 0.0, clearcoat: 0.3,  clearcoatRoughness: 0.3  },
  "glass":          { kind: "physical", color: "#ffffff", roughness: 0.05, metalness: 0.0, transmission: 0.95, ior: 1.5, thickness: 0.3 },
  "screen-dark":    { kind: "standard", color: "#0b1020", roughness: 0.25, metalness: 0.1, emissive: "#3448a8", emissiveIntensity: 0.6 },
  "screen-bright":  { kind: "standard", color: "#e8ecf5", roughness: 0.28, metalness: 0.0, emissive: "#d0dcff", emissiveIntensity: 1.1 },
  "leather-black":  { kind: "physical", color: "#17171a", roughness: 0.72, metalness: 0.0, clearcoat: 0.2,  clearcoatRoughness: 0.55 },
  "fabric-gray":    { kind: "standard", color: "#55555c", roughness: 0.94, metalness: 0.0 },
  "rgb-strip":      { kind: "standard", color: "#ff3bd6", roughness: 0.3,  metalness: 0.0, emissive: "#ff3bd6", emissiveIntensity: 3.0 },
};
