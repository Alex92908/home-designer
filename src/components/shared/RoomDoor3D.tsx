"use client";

// ─── Shared 3D interior door ──────────────────────────────
// Moved out of RoomCanvas.tsx so the walkthrough view in FloorPlanExterior
// can render IDENTICAL doors (GLTF wood_panel asset + procedural fallback,
// frosted_glass, sliding_barn, french_double) instead of its own
// hand-rolled procedural meshes.
//
// REFACTOR: RoomDoor3D no longer reads `useDesignerStore` directly. Callers
// pass `isOpen` + `onToggle` props. This decouples the component from the
// single-room "activeRoom" store key — FloorPlanExterior needs per-door
// (floor, room, door-index) keys, while RoomCanvas wraps the call to keep
// its original per-room behavior.

import { useRef, useState, useMemo, Component, ReactNode, Suspense } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@/lib/drei";
import * as THREE from "three";
import type { DoorStyle } from "@/lib/types";

// ─── glTF door panel (for wood_panel style) ─────────────────
// Uses witnessk's `door_with_frame` (CC-BY, 6 meshes — includes panel +
// frame + handle, a complete door unit). Uniform scale by height (not
// non-uniform XYZ fit — that distorted the earlier keam.wf asset into a
// "plank stack").
const ENABLE_GLTF_DOOR = true;
const WOODEN_DOOR_URL = "/models/_arch_door/door_with_frame/door_with_frame.glb";

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
    console.log(`[GltfDoorPanel] native ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m target ${doorW.toFixed(2)}×${doorH.toFixed(2)}m`);
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
      {/* 正反面校正：door_with_frame.glb 雕花面朝 -z 导出，本工程约定门板 +z=室内。
          绕竖向中轴翻 180° 使门面朝室内；铰链(父组 x=0)与摆位不变。见 RoomCanvas 同注。 */}
      <group position={[doorW / 2, 0, 0]} rotation={[0, Math.PI, 0]}>
        <group position={[-doorW / 2, 0, 0]}>
          <primitive object={cloned} />
        </group>
      </group>
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

// ─── 真铰链对开门（french_double / lattice_door / plank_studded 共用）──
// 与 walkthrough/WalkthroughDoor3D.tsx 的同名组件镜像一致——改一处，另一处
// 同步改。两扇叶各有自己的铰链组：左扇组原点在门洞左梃（x=0），右扇组原点
// 在右梃（x=doorW）；叶几何从铰链线向内展开，rotation.y 绕铰链摆动。
// french_double：暖白细框 + 通透玻璃（无背板）；lattice_door：漆红木框 +
// 上半镂空方格（真空洞）+ 下半实心雕花板；plank_studded：深红漆厚木板 +
// 拼缝 + 铜钉阵 + 铜环拉手（无格栅）。
function HingedDoubleLeaves({
  doorW, doorH, kind, handleColor, onToggle, panelRef, panelRef2,
}: {
  doorW: number; doorH: number;
  kind: "french_double" | "lattice_door" | "plank_studded";
  handleColor: string;
  onToggle: () => void;
  panelRef: { current: THREE.Group | null };
  panelRef2: { current: THREE.Group | null };
}) {
  const lw = doorW / 2;
  const Leaf = ({ mirror }: { mirror: boolean }) => {
    const sx = mirror ? -1 : 1;
    return (
      <group onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        {kind === "french_double" ? (<>
          {/* 通透玻璃：整片玻璃，无背板（glass_swing 同款玻璃参数） */}
          <mesh position={[sx * lw / 2, doorH / 2, 0]}>
            <boxGeometry args={[lw - 0.012, doorH - 0.02, 0.012]} />
            <meshPhysicalMaterial color="#C8D8E5" transmission={0.86} roughness={0.05} thickness={0.02} metalness={0} transparent opacity={0.34} side={THREE.DoubleSide} />
          </mesh>
          {/* 细框：铰链侧立梃 + 合缝侧立梃 + 上/中/下横档 */}
          <mesh position={[sx * 0.02, doorH / 2, 0]} castShadow>
            <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
            <meshStandardMaterial color="#F0EEEA" roughness={0.5} />
          </mesh>
          <mesh position={[sx * (lw - 0.02), doorH / 2, 0]} castShadow>
            <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
            <meshStandardMaterial color="#F0EEEA" roughness={0.5} />
          </mesh>
          {[0.02, doorH / 2, doorH - 0.03].map((y, i) => (
            <mesh key={i} position={[sx * lw / 2, y, 0]}>
              <boxGeometry args={[lw - 0.012, 0.04, 0.035]} />
              <meshStandardMaterial color="#F0EEEA" roughness={0.5} />
            </mesh>
          ))}
          {/* 中缝铜球把手 */}
          <mesh position={[sx * (lw - 0.06), doorH * 0.45, 0.03]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.2} />
          </mesh>
        </>) : kind === "lattice_door" ? (<>
          {/* 漆红框：立梃 + 上/中/下横档（中横档分隔上格下板） */}
          <mesh position={[sx * 0.02, doorH / 2, 0]} castShadow>
            <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
            <meshStandardMaterial color="#7C2A1E" roughness={0.5} />
          </mesh>
          <mesh position={[sx * (lw - 0.02), doorH / 2, 0]} castShadow>
            <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
            <meshStandardMaterial color="#7C2A1E" roughness={0.5} />
          </mesh>
          {[0.02, doorH * 0.475, doorH - 0.03].map((y, i) => (
            <mesh key={i} position={[sx * lw / 2, y, 0]}>
              <boxGeometry args={[lw - 0.012, i === 1 ? 0.05 : 0.04, 0.035]} />
              <meshStandardMaterial color="#7C2A1E" roughness={0.5} />
            </mesh>
          ))}
          {/* 上半镂空方格：竖条 ×3 + 横条 ×2，条间是真空洞，无玻璃无背板 */}
          {(() => {
            const y0 = doorH * 0.5, y1 = doorH - 0.05;
            const cy = (y0 + y1) / 2, ch = y1 - y0;
            return (<>
              {[0.25, 0.5, 0.75].map((f, i) => (
                <mesh key={`v${i}`} position={[sx * lw * f, cy, 0]}>
                  <boxGeometry args={[0.02, ch, 0.025]} />
                  <meshStandardMaterial color="#7C2A1E" roughness={0.55} />
                </mesh>
              ))}
              {[1 / 3, 2 / 3].map((f, i) => (
                <mesh key={`h${i}`} position={[sx * lw / 2, y0 + ch * f, 0]}>
                  <boxGeometry args={[lw - 0.04, 0.02, 0.025]} />
                  <meshStandardMaterial color="#7C2A1E" roughness={0.55} />
                </mesh>
              ))}
            </>);
          })()}
          {/* 下半实心雕花板 + 微凸内嵌板 */}
          <mesh position={[sx * lw / 2, doorH * 0.225, 0]} castShadow>
            <boxGeometry args={[lw - 0.02, doorH * 0.45 - 0.02, 0.03]} />
            <meshStandardMaterial color="#7C2A1E" roughness={0.55} />
          </mesh>
          <mesh position={[sx * lw / 2, doorH * 0.225, 0.02]}>
            <boxGeometry args={[lw - 0.12, doorH * 0.32, 0.015]} />
            <meshStandardMaterial color="#8E3325" roughness={0.5} />
          </mesh>
          {/* 中缝铜球把手 */}
          <mesh position={[sx * (lw - 0.06), doorH * 0.45, 0.03]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color={handleColor} metalness={0.85} roughness={0.2} />
          </mesh>
        </>) : (<>
          {/* 厚木板门扇：整扇深红漆厚木板 */}
          <mesh position={[sx * lw / 2, doorH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[lw - 0.01, doorH - 0.01, 0.04]} />
            <meshStandardMaterial color="#6E2418" roughness={0.6} />
          </mesh>
          {/* 竖向拼缝 ×2 */}
          {[1 / 3, 2 / 3].map((f, i) => (
            <mesh key={i} position={[sx * lw * f, doorH / 2, 0.022]}>
              <boxGeometry args={[0.012, doorH - 0.04, 0.006]} />
              <meshStandardMaterial color="#4A160E" roughness={0.7} />
            </mesh>
          ))}
          {/* 铜钉阵 3 列 × 4 行 */}
          {[0.25, 0.5, 0.75].map((fx) => [0.2, 0.4, 0.6, 0.8].map((fy) => (
            <mesh key={`${fx}|${fy}`} position={[sx * lw * fx, doorH * fy, 0.025]}>
              <sphereGeometry args={[0.018, 10, 8]} />
              <meshStandardMaterial color="#C9A227" metalness={0.9} roughness={0.25} />
            </mesh>
          )))}
          {/* 铜环拉手（合缝侧） */}
          <mesh position={[sx * (lw - 0.08), doorH * 0.45, 0.035]}>
            <torusGeometry args={[0.045, 0.008, 8, 20]} />
            <meshStandardMaterial color="#C9A227" metalness={0.9} roughness={0.25} />
          </mesh>
        </>)}
      </group>
    );
  };
  return (
    <group position={[0, 0, 0.01]}>
      {/* 左扇：铰链在门洞左梃（x=0），叶向 +X 展开 */}
      <group ref={panelRef}><Leaf mirror={false} /></group>
      {/* 右扇：铰链在门洞右梃（x=doorW），叶向 -X 展开，反向对开 */}
      <group ref={panelRef2} position={[doorW, 0, 0]}><Leaf mirror /></group>
      {/* 门槛石：两扇共用，固定不动 */}
      <mesh position={[doorW / 2, 0.015, 0]}>
        <boxGeometry args={[doorW + 0.08, 0.03, 0.12]} />
        <meshStandardMaterial color="#8A8A80" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── Interior door (3D) with click-to-open animation ────────
// Renders a door panel inside the wall's door hole. The panel is hinged
// on its left edge (opens inward 90°). Click toggles open/closed; a
// useFrame interpolation gives a ~350ms ease. Open state is supplied by
// the caller (was per-room store state in the original — now props so
// FloorPlanExterior can key by (floor, room, door-index) instead).
//
// AJAR BY DEFAULT (2026-11-21, Phase A): `defaultAjar` makes a door rest
// one leaf ~30° open (sliders: 35% slid) until the user first clicks it.
// See walkthrough/WalkthroughDoor3D.tsx for the full mechanism note.
export function RoomDoor3D({
  W, D, H,
  doorWall, doorPosCm, doorLenCm, doorHCm,
  isOpen, onToggle, doorStyle,
  defaultAjar = false,
}: {
  W: number; D: number; H: number;
  doorWall: "N" | "S" | "W" | "E";
  doorPosCm: number; doorLenCm: number; doorHCm: number;
  isOpen: boolean;
  onToggle: () => void;
  doorStyle: DoorStyle;
  /** 半掩默认开（Phase A）：首次点击前左扇保持 ~30° 半掩，见文件头注释。 */
  defaultAjar?: boolean;
}) {
  // Note: H is currently unused inside this body but kept in the signature
  // for API parity with the original (callers pass room height for future
  // use, e.g. clamping doorH).
  void H;
  const panelRef = useRef<THREE.Group>(null);
  // 第二扇(双开门的右扇)绕自己外侧边、反向对开。
  const panelRef2 = useRef<THREE.Group>(null);
  // 半掩：首次点击前 touched=false；点击后进入正常开/合切换。
  const [touched, setTouched] = useState(false);
  const handleToggle = () => { setTouched(true); onToggle(); };
  // Animated values, smoothed each frame toward their targets.
  // 左扇/主扇 (animRef)：铰链转角 (0 → -π/2)，推拉门为平移距离 (0 → -doorW)。
  // 右扇 (animRef2)：铰链转角 (0 → +π/2)，半掩时恒为 0——半掩只开左扇。
  const isSliding = doorStyle === "sliding_barn" || doorStyle === "shoji_slide";
  const isDouble = doorStyle === "french_double" || doorStyle === "lattice_door" || doorStyle === "plank_studded";
  const fullOpen = isSliding ? -(doorLenCm / 100) : -Math.PI / 2;
  const ajarOpen = isSliding ? -(doorLenCm / 100) * 0.35 : -Math.PI / 6;
  const leftTarget = isOpen ? fullOpen : (!touched && defaultAjar ? ajarOpen : 0);
  const rightTarget = isDouble && isOpen ? Math.PI / 2 : 0;
  const animRef = useRef(leftTarget);
  const animRef2 = useRef(rightTarget);
  // demand-mode: request frames until the swing/slide settles (no-op in always).
  const invalidate = useThree(s => s.invalidate);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05); // demand-mode: cap the idle-gap first frame
    const speed = isSliding ? 2.4 : 5.5;
    const diff = leftTarget - animRef.current;
    if (Math.abs(diff) > 0.002) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
      animRef.current += step;
      invalidate();
    } else if (animRef.current !== leftTarget) {
      animRef.current = leftTarget;
    }
    if (isDouble) {
      const diff2 = rightTarget - animRef2.current;
      if (Math.abs(diff2) > 0.002) {
        const step2 = Math.sign(diff2) * Math.min(Math.abs(diff2), speed * dt);
        animRef2.current += step2;
        invalidate();
      } else if (animRef2.current !== rightTarget) {
        animRef2.current = rightTarget;
      }
    }
    // 每帧把动画值写回节点（含首帧）：初始半掩角就靠这一写落到门扇上。
    if (panelRef.current) {
      if (isSliding) panelRef.current.position.x = animRef.current;
      else panelRef.current.rotation.y = animRef.current;
    }
    if (isDouble && panelRef2.current) panelRef2.current.rotation.y = animRef2.current;
  });

  const doorW = doorLenCm / 100;
  const doorH = doorHCm / 100;
  const doorPos = doorPosCm / 100;
  const frameT = 0.04; // frame thickness

  // Group positioning: put a parent group at the hinge line (inner-room
  // side of the wall, at the door's left edge). All internal pieces are
  // positioned relative to the hinge so rotating the group swings the door.
  let groupPos: [number, number, number];
  let groupRot: [number, number, number];
  let hingeOffset: number; // direction the panel extends in local +X when closed
  switch (doorWall) {
    case "N": // back wall (z = -D/2)
      groupPos = [doorPos - W / 2, 0, -D / 2 + 0.02];
      groupRot = [0, 0, 0];
      hingeOffset = 1;
      break;
    case "S": // front wall (z = +D/2) — normally hidden wall but
      // door itself should still render so it's visible in dollhouse.
      // Rotate 180° around Y so door faces room interior (-Z).
      // Position: door's LEFT edge (from outside) at world X = -W/2 + doorPos.
      // With rotation π, local +X → world -X, so group origin sits at the
      // door's right edge in world: -W/2 + doorPos + doorW.
      groupPos = [-W / 2 + doorPos + doorW, 0, D / 2 - 0.02];
      groupRot = [0, Math.PI, 0];
      hingeOffset = 1;
      break;
    case "W":
      groupPos = [-W / 2 + 0.02, 0, doorPos - D / 2];
      groupRot = [0, Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    case "E":
      groupPos = [W / 2 - 0.02, 0, -(doorPos - D / 2) - doorW];
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
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>
      <mesh position={[-frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>
      <mesh position={[doorW + frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>

      {/* Door panel (rotates around hinge at local X=0) */}
      {doorStyle === "shoji_slide" ? (
        // 障子推拉门（Phase B）：木格 + 半透和纸（与 proc-shoji 同色同格），沿顶轨左滑。
        <group position={[0, 0, 0.01]}>
          {/* 顶轨（固定不动） */}
          <mesh position={[doorW / 2, doorH + 0.04, 0]}>
            <boxGeometry args={[doorW * 1.06, 0.045, 0.05]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          <group ref={panelRef}>
            <group onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
              {/* 和纸面：半透，可透光 */}
              <mesh position={[doorW / 2, doorH / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, doorH - 0.03, 0.012]} />
                <meshStandardMaterial color="#F5EFDC" roughness={0.9} metalness={0} transparent opacity={0.65} side={THREE.DoubleSide} />
              </mesh>
              {/* 木框：上下横档 + 左右立梃 */}
              <mesh position={[doorW / 2, doorH - 0.015, 0.008]}>
                <boxGeometry args={[doorW - 0.02, 0.035, 0.02]} />
                <meshStandardMaterial color="#8A6A42" roughness={0.75} />
              </mesh>
              <mesh position={[doorW / 2, 0.015, 0.008]}>
                <boxGeometry args={[doorW - 0.02, 0.035, 0.02]} />
                <meshStandardMaterial color="#8A6A42" roughness={0.75} />
              </mesh>
              <mesh position={[0.0175, doorH / 2, 0.008]}>
                <boxGeometry args={[0.035, doorH - 0.03, 0.02]} />
                <meshStandardMaterial color="#8A6A42" roughness={0.75} />
              </mesh>
              <mesh position={[doorW - 0.0175, doorH / 2, 0.008]}>
                <boxGeometry args={[0.035, doorH - 0.03, 0.02]} />
                <meshStandardMaterial color="#8A6A42" roughness={0.75} />
              </mesh>
              {/* 木格：横格 ×3 + 竖格 ×2 */}
              {[0.25, 0.5, 0.75].map((r, i) => (
                <mesh key={i} position={[doorW / 2, doorH * r, 0.01]}>
                  <boxGeometry args={[doorW - 0.04, 0.025, 0.018]} />
                  <meshStandardMaterial color="#8A6A42" roughness={0.75} />
                </mesh>
              ))}
              {[-0.17, 0.17].map((fx, i) => (
                <mesh key={i} position={[doorW / 2 + fx * doorW, doorH / 2, 0.01]}>
                  <boxGeometry args={[0.025, doorH - 0.06, 0.018]} />
                  <meshStandardMaterial color="#8A6A42" roughness={0.75} />
                </mesh>
              ))}
              {/* 竖向拉手 */}
              <mesh position={[doorW - 0.12, doorH * 0.45, 0.03]}>
                <boxGeometry args={[0.03, Math.min(0.3, doorH * 0.2), 0.02]} />
                <meshStandardMaterial color="#8A6A42" roughness={0.7} />
              </mesh>
            </group>
          </group>
        </group>
      ) : doorStyle === "sliding_barn" ? (
        // Sliding barn door: slides left (no swing). panelRef unused for rotation;
        // instead translate via useFrame (we already drive angleRef — reuse as
        // slide ratio 0→1 mapped to translation).
        // 顶轨在 panelRef 组之外——之前它在滑动组里，会跟着门扇一起滑走。
        <group position={[0, 0, 0.01]}>
          {/* Top slide rail (doesn't move) */}
          <mesh position={[doorW, doorH + 0.08, 0]}>
            <boxGeometry args={[doorW * 2.1, 0.06, 0.04]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          <group ref={panelRef}>
          {/* Sliding panel */}
          <mesh
            position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
            onClick={(e) => { e.stopPropagation(); handleToggle(); }}
            castShadow receiveShadow
          >
            <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.04]} />
            <meshStandardMaterial color="#7A5438" roughness={0.85} />
          </mesh>
          {/* Barn door: 3 horizontal planks + iron strap */}
          {[0.25, 0.5, 0.75].map((r, i) => (
            <mesh key={i} position={[doorW / 2, doorH * r, 0.005]}>
              <boxGeometry args={[doorW - 0.04, 0.015, 0.008]} />
              <meshStandardMaterial color="#5C3E28" roughness={0.9} />
            </mesh>
          ))}
          {/* Handle: long iron bar */}
          <mesh position={[doorW - 0.12, doorH * 0.45, 0.03]}>
            <boxGeometry args={[0.14, 0.03, 0.015]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.8} roughness={0.35} />
          </mesh>
          </group>
        </group>
      ) : doorStyle === "french_double" || doorStyle === "lattice_door" || doorStyle === "plank_studded" ? (
        // 真铰链对开门（Phase B）：french_double 的假玻璃已拆除——旧版每扇是整块
        // 不透明白板 + 表面贴玻璃片，现为真框 + 通透玻璃；lattice_door /
        // plank_studded 为新增中式对开门。两扇各绕自家外侧铰链对开。
        <HingedDoubleLeaves
          doorW={doorW} doorH={doorH}
          kind={doorStyle}
          handleColor="#B8A060"
          onToggle={handleToggle}
          panelRef={panelRef} panelRef2={panelRef2}
        />
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
                      onClick={() => handleToggle()}
                    />
                  }
                >
                  <Suspense fallback={
                    <ProceduralWoodDoor
                      doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                      onClick={() => handleToggle()}
                    />
                  }>
                    <GltfDoorPanel doorW={doorW} doorH={doorH} onClick={() => handleToggle()} />
                  </Suspense>
                </GltfDoorFallback>
                {/* Extra handle on both faces of the door so it's always
                    visible regardless of which way the glTF asset was
                    exported. Two small spheres + short stem. */}
                <mesh position={[doorW - 0.1, doorH * 0.45, 0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.25} />
                </mesh>
                <mesh position={[doorW - 0.1, doorH * 0.45, -0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.25} />
                </mesh>
              </>
            ) : (
              <ProceduralWoodDoor
                doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                onClick={() => handleToggle()}
              />
            )
          ) : (
            // frosted_glass — aluminum frame + semi-transparent glass panel.
            // （Phase A 重建）旧版是整块不透明铝色盒 + 表面贴玻璃盒（实心板）；
            // 现为四边铝框 + 一片磨砂玻璃，无任何不透明背板——光可透过。
            <>
              {/* Aluminum frame: 4 bars (top/bottom/left/right) */}
              <mesh position={[doorW / 2 * hingeOffset, doorH - 0.02, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, 0.04, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[doorW / 2 * hingeOffset, 0.02, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, 0.04, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[0.02 * hingeOffset, doorH / 2, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[(doorW - 0.02) * hingeOffset, doorH / 2, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Frosted glass pane — slightly smaller than frame, semi-transparent.
                  磨砂本就半透（roughness 0.4 + opacity 0.75），但背后不再有实心板。 */}
              <mesh
                position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
                onClick={(e) => { e.stopPropagation(); handleToggle(); }}
              >
                <boxGeometry args={[doorW - 0.1, doorH - 0.1, 0.03]} />
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
              <mesh position={[doorW - 0.08, doorH * 0.45, -0.045]}>
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
