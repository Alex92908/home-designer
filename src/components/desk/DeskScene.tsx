"use client";

/**
 * DeskScene — the 3D canvas for the desk-setup experience.
 *
 * Visual strategy (no external 3D assets yet):
 *   1. HDRI environment for realistic reflections + indirect light
 *   2. PBR materials on every item (standard / physical)
 *   3. Contact shadows on the floor for groundedness
 *   4. Post-processing: SSAO (N8AO for perf) + Bloom + ACES tone mapping
 *   5. Soft key light for directional highlights
 *
 * This combination is what makes primitive boxes look production-grade —
 * the "Buildcores trick" done on the cheap.
 */

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, ContactShadows } from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping, N8AO, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect } from "react";
import * as THREE from "three";

import { useDeskStore, type EnvPreset } from "@/lib/desk/store";
import DeskItem from "./DeskItem";

// ── Map our environment presets to drei's built-in HDRIs ──
// drei ships with a handful of curated HDRIs that load straight from its
// CDN. This avoids us hosting our own HDRI files on day 1.
const DREI_ENV: Record<EnvPreset, "studio" | "warehouse" | "sunset" | "dawn" | "city" | "apartment"> = {
  studio:    "studio",
  warehouse: "warehouse",
  sunset:    "sunset",
  dawn:      "dawn",
  city:      "city",
  apartment: "apartment",
};

// ── Floor under the desk — wide plane with a subtle PBR material ──
// Contact shadows handle the grounded look; this plane just gives reflections
// somewhere to land.
function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#1a1a1e" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

// ── Scene contents (inside Canvas) ──
function SceneContents() {
  const env        = useDeskStore(s => s.env);
  const items      = useDeskStore(s => s.items);
  const selectedId = useDeskStore(s => s.selectedId);
  const select     = useDeskStore(s => s.select);

  // Background color tint that matches the env — so if HDRI is cloudy the
  // empty space looks cohesive, not default-black.
  const bgColor: Record<EnvPreset, string> = {
    studio:    "#e9e9ed",
    warehouse: "#1c1c20",
    sunset:    "#2a1d16",
    dawn:      "#1a2030",
    city:      "#0e0e18",
    apartment: "#201e1a",
  };

  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(bgColor[env]);
    // drei's <Environment> also sets scene.environment for IBL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, scene]);

  return (
    <>
      <Environment preset={DREI_ENV[env]} background={false} />
      <Floor />

      {/* Key directional light for crisp highlights (HDRI alone tends to be flat) */}
      <directionalLight
        castShadow
        position={[3, 5, 2]}
        intensity={env === "city" ? 0.6 : 1.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />

      {/* Contact shadow under the scene — much cheaper than real shadowmaps
          and looks great for small objects. */}
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.65}
        scale={6}
        blur={2.4}
        far={3}
        resolution={1024}
        color="#000000"
      />

      {/* Click empty space to deselect */}
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
  const env = useDeskStore(s => s.env);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [1.6, 1.25, 1.8], fov: 42 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: env === "city" ? 1.25 : 1.0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputColorSpace: (THREE as any).SRGBColorSpace ?? THREE.SRGBColorSpace,
      }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <SceneContents />

      <OrbitControls
        makeDefault
        target={[0, 0.8, 0]}
        minDistance={0.9}
        maxDistance={5}
        maxPolarAngle={Math.PI * 0.5 - 0.05}
        enableDamping
        dampingFactor={0.08}
      />

      {/* Post-processing: the visual backbone.
          - N8AO: ambient occlusion, gives crevice shadows
          - Bloom: subtle glow on emissive (screens / RGB strips)
          - ToneMapping: ACES tone curve for cinematic contrast
          - Vignette: frames the shot, feels premium */}
      <EffectComposer multisampling={0} enableNormalPass>
        <N8AO
          aoRadius={0.35}
          intensity={2.8}
          distanceFalloff={0.6}
          quality="medium"
          screenSpaceRadius={false}
          halfRes
        />
        <Bloom
          mipmapBlur
          intensity={env === "city" ? 1.1 : 0.5}
          luminanceThreshold={0.75}
          luminanceSmoothing={0.2}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette eskil={false} offset={0.15} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
