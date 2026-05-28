"use client";

// ─── Walkthrough 3D interior door ─────────────────────────
// COPY of shared/RoomDoor3D.tsx tuned for the walkthrough's thick-box
// walls. The shared version sits the panel 2cm into the room from the
// wall plane — perfect for the effect page's 0-thickness plane walls but
// buried inside walkthrough's 10cm box walls.
//
// Wall offsets here are 0.08 instead of 0.02. With 10cm wall centered on
// the room boundary (extending ±5cm), the panel front face now lands at
// boundary + ~2cm into the room — visible past the wall's interior face.
//
// Everything else (door styles, GLTF, animation, swing direction) is
// identical to the shared version. If you fix a bug in one, mirror it
// in the other.

import { useRef, useMemo, Component, ReactNode, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { DoorStyle } from "@/lib/types";

// ─── glTF door panel (for wood_panel style) ─────────────────
// Uses witnessk's `door_with_frame` (CC-BY, 6 meshes — includes panel +
// frame + handle, a complete door unit). Uniform scale by height (not
// non-uniform XYZ fit — that distorted the earlier keam.wf asset into a
// "plank stack").
const ENABLE_GLTF_DOOR = true;
const WOODEN_DOOR_URL = "/models/_arch_door/door_with_frame/door_with_frame.gltf";

function GltfDoorPanel({ doorW, doorH, onClick }: { doorW: number; doorH: number; onClick: () => void }) {
  const { scene } = useGLTF(WOODEN_DOOR_URL) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      // Uniform scale by height. This preserves the door's natural
      // width:height:depth ratio instead of stretching it to match our
      // doorW × doorH (which distorts). Slight width mismatch is
      // acceptable — a 75cm real door rendered as ~72cm is fine.
      const s = doorH / size.y;
      c.scale.setScalar(s);
      c.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(c);
      // Base at Y=0, X-centered, then shift right so left edge = hinge
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.y -= box2.min.y;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
      c.position.x += doorW / 2;
    }
    return c;
  }, [scene, doorW, doorH]);

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <primitive object={cloned} />
    </group>
  );
}

// Enable DRACO-less caching for this asset
// (useGLTF.preload would help on route prefetch but not required here)

class GltfDoorFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[GltfDoorPanel] fallback: ${err.message}`);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ─── Interior door (3D) with click-to-open animation ────────
// Renders a door panel inside the wall's door hole. The panel is hinged
// on its left edge (opens inward 90°). Click toggles open/closed; a
// useFrame interpolation gives a ~350ms ease. Open state is supplied by
// the caller (was per-room store state in the original — now props so
// FloorPlanExterior can key by (floor, room, door-index) instead).
export function WalkthroughDoor3D({
  W, D, H,
  doorWall, doorPosCm, doorLenCm, doorHCm,
  isOpen, onToggle, doorStyle,
  frameColor = "#F0EEEA",
  handleColor = "#B8A060",
}: {
  W: number; D: number; H: number;
  doorWall: "N" | "S" | "W" | "E";
  doorPosCm: number; doorLenCm: number; doorHCm: number;
  isOpen: boolean;
  onToggle: () => void;
  doorStyle: DoorStyle;
  /** Frame paint color. Default '#F0EEEA' (warm millwork). */
  frameColor?: string;
  /** Handle / knob metal color. Default '#B8A060' (brass). */
  handleColor?: string;
}) {
  // Note: H is currently unused inside this body but kept in the signature
  // for API parity with the original (callers pass room height for future
  // use, e.g. clamping doorH).
  void H;
  const panelRef = useRef<THREE.Group>(null);
  // Animated value, smoothed each frame toward the target.
  // For hinged doors: used as rotation angle (0 → -π/2).
  // For sliding doors: used as translation distance (0 → -doorW).
  const animRef = useRef(0);
  useFrame((_, delta) => {
    const isSliding = doorStyle === "sliding_barn";
    const target = isOpen ? (isSliding ? -(doorLenCm / 100) : -Math.PI / 2) : 0;
    // Exponential smoothing — feels far snappier than the old linear
    // ramp at the same average speed. Higher k = faster catch-up; the
    // animation visibly accelerates from rest and decelerates as it
    // approaches the target, the way real spring-loaded hinges read.
    // k≈12 for hinges, ≈6 for sliding barn (slower for heavier door).
    const k = isSliding ? 6 : 12;
    const current = animRef.current;
    const diff = target - current;
    if (Math.abs(diff) > 0.001) {
      // Frame-rate-independent lerp: c += (t-c) · (1 - e^(-Δt·k))
      // 60 fps → α ≈ 0.18, 30 fps → α ≈ 0.33, identical perceived speed.
      animRef.current = current + diff * (1 - Math.exp(-delta * k));
      if (panelRef.current) {
        if (isSliding) panelRef.current.position.x = animRef.current;
        else panelRef.current.rotation.y = animRef.current;
      }
    } else if (animRef.current !== target) {
      // Snap to target so the door doesn't sit at 99.999 % forever.
      animRef.current = target;
      if (panelRef.current) {
        if (isSliding) panelRef.current.position.x = target;
        else panelRef.current.rotation.y = target;
      }
    }
  });

  const doorW = doorLenCm / 100;
  const doorH = doorHCm / 100;
  const doorPos = doorPosCm / 100;
  const frameT = 0.08; // frame thickness

  // Group positioning: put a parent group at the hinge line (inner-room
  // side of the wall, at the door's left edge). All internal pieces are
  // positioned relative to the hinge so rotating the group swings the door.
  let groupPos: [number, number, number];
  let groupRot: [number, number, number];
  let hingeOffset: number; // direction the panel extends in local +X when closed
  switch (doorWall) {
    // OFFSET = 0.08 (vs 0.02 in shared/RoomDoor3D): pushes the panel
    // PAST the 10cm-thick box wall so the door isn't buried in the slab.
    // 0.08 means the group sits 7cm into the room from the boundary; with
    // the panel at local z = -0.02 (or thickness 0.035), the panel front
    // face lands ~2cm inside the room from the wall's interior face.
    case "N": // back wall (z = -D/2)
      groupPos = [doorPos - W / 2, 0, -D / 2 + 0.08];
      groupRot = [0, 0, 0];
      hingeOffset = 1;
      break;
    case "S": // front wall (z = +D/2)
      // Rotate 180° around Y so door faces room interior (-Z).
      groupPos = [-W / 2 + doorPos + doorW, 0, D / 2 - 0.08];
      groupRot = [0, Math.PI, 0];
      hingeOffset = 1;
      break;
    case "W":
      groupPos = [-W / 2 + 0.08, 0, doorPos - D / 2];
      groupRot = [0, Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    case "E":
      groupPos = [W / 2 - 0.08, 0, -(doorPos - D / 2) - doorW];
      groupRot = [0, -Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    default:
      return null;
  }

  return (
    <group position={groupPos} rotation={groupRot}>
      {/* Door frame (stays fixed, inside the wall hole) */}
      <mesh position={[doorW / 2, doorH + frameT / 2, 0]}>
        <boxGeometry args={[doorW + frameT * 2, frameT, 0.05]} />
        <meshStandardMaterial color={frameColor} roughness={0.6} />
      </mesh>
      <mesh position={[-frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color={frameColor} roughness={0.6} />
      </mesh>
      <mesh position={[doorW + frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color={frameColor} roughness={0.6} />
      </mesh>

      {/* Door panel (rotates around hinge at local X=0) */}
      {doorStyle === "sliding_barn" ? (
        // Sliding barn door: slides left (no swing). panelRef unused for rotation;
        // instead translate via useFrame (we already drive angleRef — reuse as
        // slide ratio 0→1 mapped to translation).
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {/* Top slide rail (doesn't move) */}
          <mesh position={[doorW, doorH + 0.08, 0]}>
            <boxGeometry args={[doorW * 2.1, 0.06, 0.08]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Sliding panel */}
          <mesh
            position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            castShadow receiveShadow
          >
            <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.08]} />
            <meshStandardMaterial color="#7A5438" roughness={0.85} />
          </mesh>
          {/* Barn door: 3 horizontal planks + iron strap */}
          {[0.25, 0.5, 0.75].map((r, i) => (
            <mesh key={i} position={[doorW / 2, doorH * r, 0.005]}>
              <boxGeometry args={[doorW - 0.08, 0.015, 0.008]} />
              <meshStandardMaterial color="#5C3E28" roughness={0.9} />
            </mesh>
          ))}
          {/* Handle: long iron bar */}
          <mesh position={[doorW - 0.12, doorH * 0.45, 0.03]}>
            <boxGeometry args={[0.14, 0.03, 0.015]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ) : doorStyle === "french_double" ? (
        // French double: two glass panels hinged from each outer edge.
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {/* Left panel (hinged at x=0) */}
          <group
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            <mesh position={[doorW / 4, doorH / 2, -0.02]} castShadow>
              <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.02, 0.025]} />
              <meshStandardMaterial color="#F0F0F0" roughness={0.5} />
            </mesh>
            <mesh position={[doorW / 4, doorH / 2, -0.005]}>
              <planeGeometry args={[doorW / 2 - 0.1, doorH - 0.15]} />
              <meshPhysicalMaterial color="#C8D8E5" transmission={0.75} roughness={0.05} thickness={0.02} transparent opacity={0.6} />
            </mesh>
          </group>
          {/* Right panel */}
          <mesh position={[doorW * 0.75, doorH / 2, -0.02]} castShadow>
            <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.02, 0.025]} />
            <meshStandardMaterial color="#F0F0F0" roughness={0.5} />
          </mesh>
          <mesh position={[doorW * 0.75, doorH / 2, -0.005]}>
            <planeGeometry args={[doorW / 2 - 0.1, doorH - 0.15]} />
            <meshPhysicalMaterial color="#C8D8E5" transmission={0.75} roughness={0.05} thickness={0.02} transparent opacity={0.6} />
          </mesh>
          {/* Two knobs at center */}
          <mesh position={[doorW / 2 - 0.08, doorH * 0.45, 0.02]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh position={[doorW / 2 + 0.08, doorH * 0.45, 0.02]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      ) : (
        // Default: wood_panel uses real glTF; frosted_glass uses procedural
        // (it's a glass-look tinted box — glTF wouldn't match semantics).
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {doorStyle === "wood_panel" ? (
            ENABLE_GLTF_DOOR ? (
              <>
                <GltfDoorFallback
                  fallback={
                    <ProceduralWoodDoor
                      doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                      onClick={() => onToggle()}
                    />
                  }
                >
                  <Suspense fallback={
                    <ProceduralWoodDoor
                      doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                      onClick={() => onToggle()}
                    />
                  }>
                    <GltfDoorPanel doorW={doorW} doorH={doorH} onClick={() => onToggle()} />
                  </Suspense>
                </GltfDoorFallback>
                {/* Extra handle on both faces of the door so it's always
                    visible regardless of which way the glTF asset was
                    exported. Two small spheres + short stem. */}
                <mesh position={[doorW - 0.1, doorH * 0.45, 0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.25} />
                </mesh>
                <mesh position={[doorW - 0.1, doorH * 0.45, -0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.25} />
                </mesh>
              </>
            ) : (
              <ProceduralWoodDoor
                doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                onClick={() => onToggle()}
              />
            )
          ) : (
            // frosted_glass — aluminum frame + semi-transparent glass panel
            <>
              {/* Aluminum frame around the edge — makes the door outline
                  clearly visible even when glass is semi-transparent */}
              <mesh position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Glass inset — slightly smaller than frame, semi-transparent */}
              <mesh
                position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
              >
                <boxGeometry args={[doorW - 0.12, doorH - 0.15, 0.08]} />
                <meshPhysicalMaterial color="#D8E0E8" transmission={0.65} roughness={0.4} thickness={0.03} ior={1.45} transparent opacity={0.75} />
              </mesh>
              {/* Lever-style handle on both faces */}
              <mesh position={[doorW - 0.12, doorH * 0.45, 0.03]}>
                <boxGeometry args={[0.08, 0.018, 0.02]} />
                <meshStandardMaterial color="#9A9A9E" metalness={0.85} roughness={0.25} />
              </mesh>
              <mesh position={[doorW - 0.08, doorH * 0.45, 0.025]}>
                <cylinderGeometry args={[0.018, 0.018, 0.02, 10]} />
                <meshStandardMaterial color="#9A9A9E" metalness={0.85} roughness={0.25} />
              </mesh>
              <mesh position={[doorW - 0.12, doorH * 0.45, -0.05]}>
                <boxGeometry args={[0.08, 0.018, 0.02]} />
                <meshStandardMaterial color="#9A9A9E" metalness={0.85} roughness={0.25} />
              </mesh>
              <mesh position={[doorW - 0.08, doorH * 0.45, -0.085]}>
                <cylinderGeometry args={[0.018, 0.018, 0.02, 10]} />
                <meshStandardMaterial color="#9A9A9E" metalness={0.85} roughness={0.25} />
              </mesh>
            </>
          )}
        </group>
      )}
    </group>
  );
}

/** Procedural wood-panel door — used as fallback when glTF fails. */
function ProceduralWoodDoor({
  doorW, doorH, hingeOffset, onClick,
}: { doorW: number; doorH: number; hingeOffset: number; onClick: () => void }) {
  return (
    <>
      <mesh
        position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        castShadow receiveShadow
      >
        <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.035]} />
        <meshStandardMaterial color="#C79A6A" roughness={0.55} metalness={0.02} />
      </mesh>
      <mesh position={[doorW / 2, doorH * 0.72, 0.003]}>
        <planeGeometry args={[doorW * 0.62, doorH * 0.26]} />
        <meshStandardMaterial color="#B0824E" roughness={0.7} />
      </mesh>
      <mesh position={[doorW / 2, doorH * 0.35, 0.003]}>
        <planeGeometry args={[doorW * 0.62, doorH * 0.32]} />
        <meshStandardMaterial color="#B0824E" roughness={0.7} />
      </mesh>
      <mesh position={[doorW - 0.1, doorH * 0.45, 0.02]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color="#A8A8A8" metalness={0.85} roughness={0.25} />
      </mesh>
    </>
  );
}
