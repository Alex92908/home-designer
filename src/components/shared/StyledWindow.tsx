"use client";

// ─── Shared 3D window (local space) ───────────────────────────
// Moved out of RoomCanvas.tsx so the walkthrough view in FloorPlanExterior
// can render IDENTICAL windows (procedural sliding / louvered / casement /
// fixed + glTF wooden / iron-bar) instead of always drawing a hand-rolled
// procedural sliding window that ignored `win.style`.
//
// CONVENTION: the window is rendered in LOCAL space, centred on the origin,
// with its glazed face looking toward +Z. Each caller wraps it in their own
// positioning group (RoomCanvas uses room-local W/D/H per-wall groups;
// FloorPlanExterior's walkthrough uses world wx/wz + rotY). The component is
// decoupled from the store — callers pass `isOpen` + `onToggle` (RoomCanvas
// keys by `win.id`; the walkthrough keys by `window|floor|room|index`).
//
// Defaults reproduce RoomCanvas's exact materials/offsets so the 效果图 stays
// pixel-identical after it is refactored onto this component; the walkthrough
// overrides glass transmission/opacity for see-through navigation.

import { useRef, useMemo, Component, ReactNode, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { WindowStyle } from "@/lib/types";
import {
  WINDOW_GLASS_COLOR,
  WINDOW_FRAME_COLOR,
  WINDOW_MULLION_COLOR,
} from "@/lib/roomVisuals";

// ─── glTF arch-window assets ─────────────────────────────────
const ENABLE_GLTF_WINDOW = true;
const ARCH_WINDOW_URL = "/models/_arch_window/modern_window_archviz/scene.glb";
const IRON_BAR_WINDOW_URL = "/models/_arch_window/iron_bar_window/iron_bar_window.glb";
const WOODEN_WINDOW_URL = "/models/_arch_window/wooden_window/scene.glb";

type GltfWindowSpec = { url: string };

/** Map a WindowStyle to the glTF to render, or null to fall back to
 *  procedural. Sliding + louvered stay procedural (split geometry needed for
 *  the slide / slat-tilt animation); casement stays procedural for its
 *  swing-open single pane. */
export function gltfSpecForStyle(style: WindowStyle): GltfWindowSpec | null {
  switch (style) {
    case "sliding":
    case "louvered":
      return null;
    case "fixed":
      return { url: ARCH_WINDOW_URL };
    case "security":
      return { url: IRON_BAR_WINDOW_URL };
    case "wooden":
      return { url: WOODEN_WINDOW_URL };
    case "casement":
      return null;
  }
}

function GltfArchWindow({
  winLen, winH, url,
}: { winLen: number; winH: number; url: string }) {
  const { scene } = useGLTF(url) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const inner = scene.clone(true);
    // Strip SketchUp helper nodes (cameras / empties at huge offsets) so they
    // don't pollute the bbox measurement below.
    const toRemove: THREE.Object3D[] = [];
    inner.traverse(obj => {
      if (/^skp_camera/i.test(obj.name || "") || /^(ID\d+|Scene_)/i.test(obj.name || "")) {
        toRemove.push(obj);
      }
    });
    for (const o of toRemove) o.parent?.remove(o);

    inner.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });

    const c = new THREE.Group();
    c.add(inner);

    c.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(c);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);

    // Auto-orient: window width should run along X. Some assets export it
    // along Z; if so rotate -90° around Y so world-Z → world-X.
    if (rawSize.z > rawSize.x) {
      inner.rotation.y = -Math.PI / 2;
      c.updateMatrixWorld(true);
    }

    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      const MAX_DEPTH = 0.2;
      const sx = winLen / size.x;
      const sy = winH / size.y;
      let sz = sx;
      if (size.z * sz > MAX_DEPTH) sz = MAX_DEPTH / size.z;
      c.scale.set(sx, sy, sz);
      c.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(c);
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.y -= (box2.min.y + box2.max.y) / 2;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
    }
    return c;
  }, [scene, winLen, winH, url]);

  return <primitive object={cloned} />;
}

/** ErrorBoundary: glTF 404 / parse failure → render `fallback` instead. */
class ArchWindowFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[GltfArchWindow] load failed — falling back to procedural: ${err.message}`);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export type StyledWindowProps = {
  /** Window opening size in metres. */
  winLen: number;
  winH: number;
  style: WindowStyle;
  isOpen: boolean;
  onToggle: () => void;
  // ── Material overrides (defaults = RoomCanvas / 效果图 look) ──
  frameColor?: string;
  glassColor?: string;
  mullionColor?: string;
  glassTransmission?: number;
  glassOpacity?: number;
  glassRoughness?: number;
  glassMetalness?: number;
  glassEnvMapIntensity?: number;
  glassThickness?: number;
  glassIor?: number;
  /** Local +Z offset of glazing/frame from the wall plane. */
  wallOffset?: number;
  /** Disable glTF assets (force procedural). */
  enableGltf?: boolean;
  /** 百叶窗(louvered)是否在叶片后加一层玻璃背板。室内（效果图/漫游）默认 false
   *  —— 百叶看进去是空的、能透光。外观图传 true —— 否则大白天从外面看，百叶
   *  叶片是浅色、背后没玻璃，透出墙体显得发白「像没渲染」。加 tinted 玻璃背板
   *  后百叶窗就和推拉窗一样是个清晰的有色窗面。Default false。 */
  glassBehindLouver?: boolean;
};

/**
 * Local-space window: centred on origin, glazed face toward +Z.
 * Renders the correct geometry for `style`, with sliding/casement/wooden
 * swing-open and louvered slat-tilt animations driven by `isOpen`.
 */
export function StyledWindow({
  winLen, winH, style, isOpen, onToggle,
  frameColor = WINDOW_FRAME_COLOR,
  glassColor = WINDOW_GLASS_COLOR,
  mullionColor = WINDOW_MULLION_COLOR,
  glassTransmission = 0.7,
  glassOpacity = 0.5,
  glassRoughness = 0.08,
  glassMetalness = 0,
  glassEnvMapIntensity,
  glassThickness = 0.01,
  glassIor = 1.45,
  wallOffset = 0.015,
  enableGltf = ENABLE_GLTF_WINDOW,
  glassBehindLouver = false,
}: StyledWindowProps) {
  // Animation refs (mirror RoomCanvas RoomWindow):
  //  - sashRef: sliding (translate) / casement + wooden (rotate around hinge)
  //  - slatRefs: louvered per-slat X rotation
  const sashRef = useRef<THREE.Group>(null);
  const sashAngleRef = useRef(0);
  const slatRefs = useRef<Array<THREE.Mesh | null>>([]);
  const slatAngleRef = useRef(-0.25);
  useFrame((_, delta) => {
    if (style === "sliding" || style === "casement" || style === "wooden") {
      const target = isOpen
        ? (style === "sliding" ? winLen / 2 : -Math.PI / 4)
        : 0;
      const speed = style === "sliding" ? 2.2 : 3.8;
      const current = sashAngleRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.002) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * delta);
        sashAngleRef.current = current + step;
        if (sashRef.current) {
          if (style === "sliding") {
            sashRef.current.position.x = -winLen / 4 + sashAngleRef.current;
          } else {
            sashRef.current.rotation.y = sashAngleRef.current;
          }
        }
      }
    } else if (style === "louvered") {
      const target = isOpen ? -Math.PI / 2 + 0.08 : -0.25;
      const current = slatAngleRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.002) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), 3.5 * delta);
        slatAngleRef.current = current + step;
        for (const r of slatRefs.current) {
          if (r) r.rotation.x = slatAngleRef.current;
        }
      }
    }
  });

  const FRAME_THIN = 0.025;
  const WALL_OFFSET = wallOffset;

  const frameBars = (
    <>
      <mesh position={[0, winH / 2 - FRAME_THIN / 2, WALL_OFFSET]} castShadow>
        <boxGeometry args={[winLen, FRAME_THIN, 0.02]} />
        <meshStandardMaterial color={frameColor} roughness={0.55} />
      </mesh>
      <mesh position={[0, -winH / 2 + FRAME_THIN / 2, WALL_OFFSET]} castShadow>
        <boxGeometry args={[winLen, FRAME_THIN, 0.02]} />
        <meshStandardMaterial color={frameColor} roughness={0.55} />
      </mesh>
      <mesh position={[-winLen / 2 + FRAME_THIN / 2, 0, WALL_OFFSET]} castShadow>
        <boxGeometry args={[FRAME_THIN, winH - FRAME_THIN * 2, 0.02]} />
        <meshStandardMaterial color={frameColor} roughness={0.55} />
      </mesh>
      <mesh position={[winLen / 2 - FRAME_THIN / 2, 0, WALL_OFFSET]} castShadow>
        <boxGeometry args={[FRAME_THIN, winH - FRAME_THIN * 2, 0.02]} />
        <meshStandardMaterial color={frameColor} roughness={0.55} />
      </mesh>
    </>
  );

  const glassMat = (
    <meshPhysicalMaterial
      color={glassColor}
      transmission={glassTransmission}
      roughness={glassRoughness}
      metalness={glassMetalness}
      thickness={glassThickness}
      ior={glassIor}
      transparent
      opacity={glassOpacity}
      envMapIntensity={glassEnvMapIntensity}
      side={THREE.DoubleSide}
    />
  );

  const glass = (
    <mesh position={[0, 0, WALL_OFFSET + 0.002]}>
      <planeGeometry args={[winLen, winH]} />
      {glassMat}
    </mesh>
  );

  const mullions = (() => {
    switch (style) {
      case "fixed":
        return null;
      case "sliding": {
        const panels = winLen > 1.8 ? 3 : 2;
        return Array.from({ length: panels - 1 }).map((_, i) => {
          const x = -winLen / 2 + (winLen / panels) * (i + 1);
          return (
            <mesh key={`rail-${i}`} position={[x, 0, WALL_OFFSET + 0.006]}>
              <boxGeometry args={[0.03, winH, 0.018]} />
              <meshStandardMaterial color={frameColor} roughness={0.55} />
            </mesh>
          );
        });
      }
      case "casement":
        return null;
      case "louvered": {
        const slatCount = Math.max(4, Math.floor(winH / 0.12));
        const slatH = winH / slatCount;
        return Array.from({ length: slatCount }).map((_, i) => {
          const y = -winH / 2 + slatH / 2 + i * slatH;
          return (
            <mesh
              key={`slat-${i}`}
              ref={r => { slatRefs.current[i] = r; }}
              position={[0, y, WALL_OFFSET + 0.008]}
              rotation={[slatAngleRef.current, 0, 0]}
            >
              <boxGeometry args={[winLen - 0.04, slatH * 0.55, 0.015]} />
              <meshStandardMaterial color={mullionColor} roughness={0.6} />
            </mesh>
          );
        });
      }
      default:
        return null;
    }
  })();

  // Procedural sliding window — TWO half-width panels overlap when open.
  const halfPanel = (
    <>
      <mesh position={[0, 0, WALL_OFFSET + 0.002]}>
        <planeGeometry args={[winLen / 2, winH]} />
        {glassMat}
      </mesh>
      <mesh position={[0, 0, WALL_OFFSET + 0.006]}>
        <boxGeometry args={[0.022, winH - FRAME_THIN * 2, 0.018]} />
        <meshStandardMaterial color={frameColor} roughness={0.55} />
      </mesh>
    </>
  );

  const proceduralWindow = (
    <>
      {frameBars}
      {style === "sliding" ? (
        <>
          {/* Fixed right panel */}
          <group
            position={[winLen / 4, 0, 0]}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {halfPanel}
          </group>
          {/* Sliding left panel — sashRef applies the open animation */}
          <group
            ref={sashRef}
            position={[-winLen / 4, 0, 0]}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {halfPanel}
          </group>
        </>
      ) : (
        <group
          ref={sashRef}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {(style !== "louvered" || glassBehindLouver) && glass}
          {mullions}
        </group>
      )}
    </>
  );

  const gltfSpec = enableGltf ? gltfSpecForStyle(style) : null;
  const gltfContent = gltfSpec ? (
    <ArchWindowFallback fallback={proceduralWindow}>
      <Suspense fallback={proceduralWindow}>
        <GltfArchWindow winLen={winLen} winH={winH} url={gltfSpec.url} />
      </Suspense>
    </ArchWindowFallback>
  ) : null;

  const animatesOpen = style === "sliding" || style === "casement" || style === "wooden";
  if (gltfContent) {
    return animatesOpen ? (
      <group ref={sashRef} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {gltfContent}
      </group>
    ) : (
      <group onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {gltfContent}
      </group>
    );
  }
  return proceduralWindow;
}

useGLTF.preload(ARCH_WINDOW_URL);
useGLTF.preload(IRON_BAR_WINDOW_URL);
useGLTF.preload(WOODEN_WINDOW_URL);
