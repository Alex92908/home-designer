/**
 * Material Library — PBR presets keyed off the catalog's `material` field.
 *
 * Each entry is a bag of MeshStandardMaterial / MeshPhysicalMaterial props.
 * The DeskItem renderer instantiates the right material class based on
 * whether transmission / emission / clearcoat is needed.
 *
 * Values tuned by eye for "primitives under HDRI + N8AO + Bloom" pipeline.
 * envMapIntensity is a critical lever — at 1.0 reflections are realistic;
 * below 0.8 materials look flat and matte; above 1.3 they shine too much.
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
  /** envMap boost — how much the HDRI shows in reflections */
  envMapIntensity?: number;
}

export const MATERIAL_MAP: Record<PBRMaterial, MaterialSpec> = {
  // Warmer wood tones + subtle clearcoat to simulate wax/finish
  "wood-oak": {
    kind: "physical",
    color: "#b58b5e",
    roughness: 0.55,
    metalness: 0.02,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    envMapIntensity: 1.0,
  },
  "wood-walnut": {
    kind: "physical",
    color: "#3d2415",
    roughness: 0.45,
    metalness: 0.05,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.1,
  },
  // Metals — slight roughness tweak so HDRI reads crisp but not mirror
  "metal-black": {
    kind: "standard",
    color: "#17171a",
    roughness: 0.32,
    metalness: 0.95,
    envMapIntensity: 1.3,
  },
  "metal-silver": {
    kind: "standard",
    color: "#dcdcde",
    roughness: 0.22,
    metalness: 1.0,
    envMapIntensity: 1.4,
  },
  // Plastics with subtle clearcoat polish
  "plastic-white": {
    kind: "physical",
    color: "#ededea",
    roughness: 0.38,
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.1,
  },
  "plastic-black": {
    kind: "physical",
    color: "#15151a",
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.15,
  },
  // Glass — full transmission, slight tint
  "glass": {
    kind: "physical",
    color: "#eef2ff",
    roughness: 0.03,
    metalness: 0.0,
    transmission: 0.95,
    ior: 1.5,
    thickness: 0.35,
    envMapIntensity: 1.4,
  },
  // Screens — emissive for Bloom pickup, slight blueish glow
  "screen-dark": {
    kind: "standard",
    color: "#0a0f1e",
    roughness: 0.18,
    metalness: 0.15,
    emissive: "#3f5eb8",
    emissiveIntensity: 0.75,
    envMapIntensity: 0.8,
  },
  "screen-bright": {
    kind: "standard",
    color: "#e8ecf5",
    roughness: 0.2,
    metalness: 0.0,
    emissive: "#dce5ff",
    emissiveIntensity: 1.3,
    envMapIntensity: 0.6,
  },
  // Leather — matte with tiny clearcoat for that "broken-in" sheen
  "leather-black": {
    kind: "physical",
    color: "#151519",
    roughness: 0.68,
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    envMapIntensity: 0.9,
  },
  // Fabric — high roughness, no reflection
  "fabric-gray": {
    kind: "standard",
    color: "#4e4e56",
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.5,
  },
  // RGB — bright emissive, pure bloom source
  "rgb-strip": {
    kind: "standard",
    color: "#ff3bd6",
    roughness: 0.3,
    metalness: 0.0,
    emissive: "#ff3bd6",
    emissiveIntensity: 4.0,
    envMapIntensity: 0.8,
  },
};
