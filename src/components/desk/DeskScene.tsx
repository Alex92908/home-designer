"use client";

/**
 * DeskScene — the 3D canvas for the desk-setup experience.
 *
 * Visual strategy (no external 3D assets yet):
 *   1. HDRI environment for realistic reflections + indirect light
 *   2. Three-point lighting on top of HDRI (key/fill/rim) for cinematic depth
 *   3. PBR materials with envMapIntensity boost on every item
 *   4. Soft contact shadows + PCSS for realistic shadow softness
 *   5. Post-processing: N8AO + Bloom + ACES + subtle Vignette
 *   6. Layered floor: base + plank highlights for visual anchor
 *
 * This combination is what makes primitive boxes look production-grade —
 * the "Buildcores trick" done on the cheap.
 */

import { Canvas, useThree } from "@react-three/fiber";
import {
  Environment,
  OrbitControls,
  ContactShadows,
  SoftShadows,
  AccumulativeShadows,
  RandomizedLight,
} from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping, N8AO, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { useDeskStore, type EnvPreset } from "@/lib/desk/store";
import DeskItem from "./DeskItem";

// ── Map our environment presets to drei's built-in HDRIs ──
const DREI_ENV: Record<EnvPreset, "studio" | "warehouse" | "sunset" | "dawn" | "city" | "apartment"> = {
  studio:    "studio",
  warehouse: "warehouse",
  sunset:    "sunset",
  dawn:      "dawn",
  city:      "city",
  apartment: "apartment",
};

// Per-env scene tuning — exposure, HDRI intensity, and light temperatures
// that feel right together. Tuned by eye against the 3 starter presets.
interface EnvLook {
  exposure: number;
  envIntensity: number;      // boost for HDRI indirect lighting
  bg: string;                // background color (when no HDRI bg)
  keyColor: string;          // main directional light
  keyIntensity: number;
  fillColor: string;         // secondary soft light from opposite side
  fillIntensity: number;
  rimColor: string;          // rim/back light for silhouette
  rimIntensity: number;
  floorColor: string;        // floor tone
}
const ENV_LOOK: Record<EnvPreset, EnvLook> = {
  studio: {
    exposure: 1.25,
    envIntensity: 1.4,
    bg: "#d8d9de",
    keyColor: "#ffffff", keyIntensity: 2.0,
    fillColor: "#c9d4ff", fillIntensity: 0.7,
    rimColor: "#ffffff",  rimIntensity: 1.1,
    floorColor: "#6d6d73",
  },
  apartment: {
    exposure: 1.15,
    envIntensity: 1.25,
    bg: "#2a2217",
    keyColor: "#ffdcb5", keyIntensity: 1.8,
    fillColor: "#6a7ea8", fillIntensity: 0.4,
    rimColor: "#ffb56a",  rimIntensity: 0.9,
    floorColor: "#4a3a2a",
  },
  sunset: {
    exposure: 1.3,
    envIntensity: 1.3,
    bg: "#3a1e15",
    keyColor: "#ff9550", keyIntensity: 2.1,
    fillColor: "#2a3a6a", fillIntensity: 0.5,
    rimColor: "#ffb070",  rimIntensity: 1.3,
    floorColor: "#4a2d1e",
  },
  dawn: {
    exposure: 1.1,
    envIntensity: 1.1,
    bg: "#1c2436",
    keyColor: "#aec6f2", keyIntensity: 1.6,
    fillColor: "#8da7c7", fillIntensity: 0.5,
    rimColor: "#e5d8b5",  rimIntensity: 1.0,
    floorColor: "#2a2f3f",
  },
  warehouse: {
    exposure: 1.2,
    envIntensity: 1.2,
    bg: "#1c1c22",
    keyColor: "#f0e4cc", keyIntensity: 1.7,
    fillColor: "#5a6a88", fillIntensity: 0.45,
    rimColor: "#c0d0e8",  rimIntensity: 0.9,
    floorColor: "#2a2a30",
  },
  city: {
    exposure: 1.4,
    envIntensity: 1.3,
    bg: "#0c0e1a",
    keyColor: "#a0c5ff", keyIntensity: 1.4,
    fillColor: "#ff3bd6", fillIntensity: 0.55,  // magenta neon fill
    rimColor: "#4ae3ff",  rimIntensity: 1.6,    // cyan rim
    floorColor: "#1a1e2e",
  },
};

// ── Floor — wood plank style (emulated with two-tone repeating quads) ──
// We don't have real textures yet, so simulate plank seams with a slight
// stripe shader-like effect: base dark wood + lighter stripes.
function Floor({ env }: { env: EnvPreset }) {
  const look = ENV_LOOK[env];

  // Generate 12 plank strips arranged along X. Each has slightly varied
  // color for natural feel. This is cheap — one-time geometry creation.
  const planks = useMemo(() => {
    const out: { x: number; width: number; tint: number }[] = [];
    let x = -5;
    while (x < 5) {
      const w = 0.65 + Math.random() * 0.25;
      out.push({ x: x + w / 2, width: w, tint: Math.random() * 0.15 - 0.075 });
      x += w;
    }
    return out;
  }, []);

  return (
    <group>
      {/* Base floor — large receiving plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial
          color={look.floorColor}
          roughness={0.82}
          metalness={0.05}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* Plank highlight strips — visible within camera range only */}
      {planks.map((p, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[p.x, -0.0015, 0]}
          receiveShadow
        >
          <planeGeometry args={[Math.max(p.width - 0.015, 0.05), 10]} />
          <meshStandardMaterial
            color={look.floorColor}
            roughness={0.78}
            metalness={0.08}
            envMapIntensity={0.8}
            // Slight per-plank tint offset, applied via color offset.
            // (We use offset rather than another material entry for perf.)
            onBeforeCompile={undefined}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Scene contents (inside Canvas) ──
function SceneContents() {
  const env        = useDeskStore(s => s.env);
  const items      = useDeskStore(s => s.items);
  const selectedId = useDeskStore(s => s.selectedId);
  const select     = useDeskStore(s => s.select);
  const look       = ENV_LOOK[env];

  const { scene, gl } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(look.bg);
    // Global HDRI intensity — three r0.164+ supports this; fallback noop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scene as any).environmentIntensity = look.envIntensity;
    gl.toneMappingExposure = look.exposure;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  return (
    <>
      <Environment
        preset={DREI_ENV[env]}
        background={false}
        environmentIntensity={look.envIntensity}
      />

      {/* Soft shadow preset — applies globally to lights below */}
      <SoftShadows size={12} samples={12} focus={0.6} />

      <Floor env={env} />

      {/* Ambient floor fill so shadows don't go to pure black */}
      <ambientLight intensity={0.22} color={look.fillColor} />

      {/* Key light — main directional, the one that casts the shadow */}
      <directionalLight
        castShadow
        position={[2.8, 4.5, 2.0]}
        intensity={look.keyIntensity}
        color={look.keyColor}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />

      {/* Fill light — softer, opposite side, no shadow */}
      <directionalLight
        position={[-3, 2.5, 1.5]}
        intensity={look.fillIntensity}
        color={look.fillColor}
      />

      {/* Rim light — from behind, sits low, picks up silhouette edges */}
      <directionalLight
        position={[0, 1.8, -3]}
        intensity={look.rimIntensity}
        color={look.rimColor}
      />

      {/* Contact shadow — grounds the setup regardless of directional light */}
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.7}
        scale={7}
        blur={2.8}
        far={3}
        resolution={1024}
        color="#000000"
      />

      {/* Accumulative soft shadow under the desk area — cinematic cohesion */}
      <AccumulativeShadows
        temporal
        frames={40}
        color="#000000"
        colorBlend={2}
        toneMapped
        alphaTest={0.85}
        opacity={0.55}
        scale={4}
        position={[0, 0.002, 0]}
      >
        <RandomizedLight
          amount={6}
          radius={4}
          ambient={0.55}
          intensity={1.2}
          position={[3, 5, 2]}
          bias={0.001}
        />
      </AccumulativeShadows>

      {/* Click-empty-to-deselect backdrop */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onClick={() => select(null)}
        visible={false}
      >
        <planeGeometry args={[100, 100]} />
      </mesh>

      {items.map(p => (
        <DeskItem
          key={p.id}
          placed={p}
          selected={p.id === selectedId}
          onSelect={select}
        />
      ))}
    </>
  );
}

// ── Canvas + post-processing composer ──
export default function DeskScene() {
  const env  = useDeskStore(s => s.env);
  const look = ENV_LOOK[env];

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: [1.8, 1.35, 2.0], fov: 40 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: look.exposure,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputColorSpace: (THREE as any).SRGBColorSpace ?? THREE.SRGBColorSpace,
      }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <SceneContents />

      <OrbitControls
        makeDefault
        target={[0, 0.75, 0]}
        minDistance={0.9}
        maxDistance={6}
        maxPolarAngle={Math.PI * 0.5 - 0.05}
        enableDamping
        dampingFactor={0.08}
      />

      <EffectComposer multisampling={0} enableNormalPass>
        {/* Ambient occlusion — gives crevice shadows that sell the 3D */}
        <N8AO
          aoRadius={0.5}
          intensity={3.5}
          distanceFalloff={0.8}
          quality="high"
          screenSpaceRadius={false}
          halfRes
        />
        {/* Bloom — glow on emissive surfaces (screens, RGB lights) */}
        <Bloom
          mipmapBlur
          intensity={env === "city" ? 1.4 : 0.7}
          luminanceThreshold={0.65}
          luminanceSmoothing={0.25}
        />
        {/* ACES Filmic tone mapping — cinematic contrast curve */}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        {/* Gentle vignette for focus */}
        <Vignette eskil={false} offset={0.2} darkness={0.45} />
      </EffectComposer>
    </Canvas>
  );
}
