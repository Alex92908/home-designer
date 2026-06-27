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
import { RollerShutterDoor } from "@/components/shared/RollerShutterDoor";

// ─── glTF door panel (for wood_panel style) ─────────────────
// Uses witnessk's `door_with_frame` (CC-BY, 6 meshes — includes panel +
// frame + handle, a complete door unit). Uniform scale by height (not
// non-uniform XYZ fit — that distorted the earlier keam.wf asset into a
// "plank stack").
const ENABLE_GLTF_DOOR = true;
const WOODEN_DOOR_URL = "/models/_arch_door/door_with_frame/door_with_frame.glb";

function GltfDoorPanel({ doorW, doorH, exterior = false, onClick }: { doorW: number; doorH: number; exterior?: boolean; onClick: () => void }) {
  const { scene } = useGLTF(WOODEN_DOOR_URL) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      // 外观图：南面门常在建筑阴影里，门板贴图下半又偏暗 → 渲成「黑下半」。
      // 给门材质加一层中性浅灰自发光地板，抵消阴影、把暗部抬成漫游里那种浅灰门
      // 质感（不黑）。中性灰不染色，保留门原本质感。克隆材质避免污染 useGLTF 缓存。
      // 室内漫游（exterior=false）门本就打光充足，不加自发光，保持精细原样。
      if (exterior) {
        const lift = (mt: THREE.Material): THREE.Material => {
          const sm = mt as THREE.MeshStandardMaterial;
          if (!sm || !sm.isMeshStandardMaterial) return mt;
          const nm = sm.clone();
          nm.emissive = new THREE.Color("#B8B4AC");   // 中性浅灰（不染色）
          nm.emissiveIntensity = 0.55;
          return nm;
        };
        if (Array.isArray(m.material)) m.material = m.material.map(lift);
        else if (m.material) m.material = lift(m.material);
      }
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
  }, [scene, doorW, doorH, exterior]);

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
  outwardProtrude = 0,
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
  /** 把整扇门沿墙体外法线方向往外推的距离（米）。默认 0（室内漫游不动）。
   *  外观图用：门默认坐在墙内侧 8cm（D/2-0.08），落在墙体厚度后方 → 大白天
   *  斜视角下被墙挡住（实测关 depthTest 才看得到）。往外推到墙体前表面之外
   *  （≈0.16m），门就凸出墙面、永不被挡，从外面立刻能读出来。仅外观图传值。 */
  outwardProtrude?: number;
}) {
  // Note: H is currently unused inside this body but kept in the signature
  // for API parity with the original (callers pass room height for future
  // use, e.g. clamping doorH).
  void H;
  const panelRef = useRef<THREE.Group>(null);
  // 第二扇(玻璃平开双开门的右扇)绕自己外侧边、反向对开。glass_swing 专用。
  const panelRef2 = useRef<THREE.Group>(null);
  // Animated value, smoothed each frame toward the target.
  // For hinged doors: used as rotation angle (0 → -π/2).
  // For sliding doors: used as translation distance (0 → -doorW).
  const animRef = useRef(0);
  useFrame((_, delta) => {
    const isSliding = doorStyle === "sliding_barn" || doorStyle === "glass_slide";
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
      // 玻璃平开双开门右扇：绕外侧边反向对开(+angle)。
      if (panelRef2.current) panelRef2.current.rotation.y = -animRef.current;
    } else if (animRef.current !== target) {
      // Snap to target so the door doesn't sit at 99.999 % forever.
      animRef.current = target;
      if (panelRef.current) {
        if (isSliding) panelRef.current.position.x = target;
        else panelRef.current.rotation.y = target;
      }
      if (panelRef2.current) panelRef2.current.rotation.y = -target;
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

  // 外观图：把整扇门沿墙体外法线往外推 outwardProtrude（米），使门凸出墙面、
  // 不再被墙体厚度遮挡。每面墙的外法线方向不同（N=-Z, S=+Z, W=-X, E=+X）。
  if (outwardProtrude !== 0) {
    switch (doorWall) {
      case "N": groupPos = [groupPos[0], groupPos[1], groupPos[2] - outwardProtrude]; break;
      case "S": groupPos = [groupPos[0], groupPos[1], groupPos[2] + outwardProtrude]; break;
      case "W": groupPos = [groupPos[0] - outwardProtrude, groupPos[1], groupPos[2]]; break;
      case "E": groupPos = [groupPos[0] + outwardProtrude, groupPos[1], groupPos[2]]; break;
    }
  }

  return (
    <group position={groupPos} rotation={groupRot}>
      {/* Door frame (stays fixed, inside the wall hole).
          幕墙玻璃门(glass_swing/glass_slide)不画自带门框 —— 它正好填满幕墙的一格,
          左右两侧由幕墙竖挺(mullion/钢筋)充当门框,上方由楼层横梁充当门楣。再画一圈
          自带框就会和幕墙竖挺重叠成「双框」(用户:你没用红色位置的钢筋啊)。 */}
      {!(doorStyle === "glass_swing" || doorStyle === "glass_slide" || doorStyle === "roller_shutter") && (<>
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
      </>)}

      {/* Door panel (rotates around hinge at local X=0) */}
      {doorStyle === "roller_shutter" ? (
        // 真实 GLB 卷帘门：填满门洞，顶端齐过梁(local y=doorH)，点击向上卷起。
        // 错误边界 + Suspense + 组件内 try/catch 三重保护，GLB 加载/渲染/定位
        // 失败都不会把整个 3D 场景拖黑。
        <GltfDoorFallback fallback={null}>
          <Suspense fallback={null}>
            <RollerShutterDoor
              width={doorW}
              height={doorH}
              isOpen={isOpen}
              position={[0, 0, -0.1]}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            />
          </Suspense>
        </GltfDoorFallback>
      ) : doorStyle === "glass_swing" ? (
        // 通透玻璃平开双扇门：每扇 = 大玻璃 + 细边框(frameColor) + 中缝竖把手。
        // 左扇在 panelRef 里绕铰链旋开(useFrame 旋转 panelRef.rotation.y),可点击。
        (() => {
          const lw = doorW / 2;                 // 单扇宽
          // 门扇局部 +z 朝室内、-z 朝室外(四面墙旋转后都成立)。把手主体放门外侧
          // (-z),另在室内侧(+z)也放一根,内外都看得见。把手随门扇一起开合。
          const extZ = -0.09;                   // 门外侧(从立面外能看到)
          const intZ = 0.09;                    // 门内侧(漫游时看到)
          const barH = Math.min(1.15, doorH * 0.42);
          const cy   = doorH * 0.46;
          // 一对竖向长拉手(内外双面),x = 中缝附近。
          const Handles = ({ x }: { x: number }) => (
            <>
              {[extZ, intZ].map((hz, hi) => (
                <group key={hi} position={[x, cy, hz]}>
                  <mesh><boxGeometry args={[0.035, barH, 0.035]} /><meshStandardMaterial color={handleColor} metalness={0.95} roughness={0.16} /></mesh>
                  {[barH / 2 - 0.04, -barH / 2 + 0.04].map((sy, si) => (
                    <mesh key={si} position={[0, sy, hz > 0 ? -0.05 : 0.05]}><boxGeometry args={[0.022, 0.022, 0.075]} /><meshStandardMaterial color={handleColor} metalness={0.95} roughness={0.2} /></mesh>
                  ))}
                </group>
              ))}
            </>
          );
          // 单扇 = 整片通透玻璃(左右无框,由幕墙竖挺当框) + 内侧中缝细挺 + 把手。
          const Leaf = ({ glassCenterX, stileX, handleX }: { glassCenterX: number; stileX: number; handleX: number }) => (
            <>
              <mesh position={[glassCenterX, doorH / 2, 0]}>
                <boxGeometry args={[lw - 0.012, doorH - 0.02, 0.012]} />
                <meshPhysicalMaterial color="#C8D8E5" transmission={0.86} roughness={0.05} thickness={0.02} metalness={0} transparent opacity={0.34} side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[stileX, doorH / 2, 0]} castShadow>
                <boxGeometry args={[0.04, doorH - 0.02, 0.035]} />
                <meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.7} />
              </mesh>
              <Handles x={handleX} />
            </>
          );
          return (
            <group position={[0, 0, 0.01]}>
              {/* 左扇:铰链在外侧左边(x=0),玻璃 0..lw,中缝/把手在内侧(x≈lw)。
                  panelRef 绕 x=0 旋开。 */}
              <group ref={panelRef}>
                <group onClick={(e) => { e.stopPropagation(); onToggle(); }}>
                  <Leaf glassCenterX={lw / 2} stileX={lw - 0.02} handleX={lw - 0.085} />
                </group>
              </group>
              {/* 右扇:铰链在外侧右边(x=doorW),组放在 doorW、玻璃 -lw..0,中缝/把手
                  在内侧(x≈-lw)。panelRef2 绕 x=doorW 反向旋开(双开对称)。 */}
              <group ref={panelRef2} position={[doorW, 0, 0]}>
                <group onClick={(e) => { e.stopPropagation(); onToggle(); }}>
                  <Leaf glassCenterX={-lw / 2} stileX={-lw + 0.02} handleX={-lw + 0.085} />
                </group>
              </group>
            </group>
          );
        })()
      ) : doorStyle === "glass_slide" ? (
        // 通透玻璃推拉门：一扇玻璃滑动扇 + 顶轨 + 细框 + 竖把手。点击后沿顶轨
        // 向左滑开(isSliding → useFrame 平移 panelRef.position.x)。
        <group position={[0, 0, 0.01]}>
          {/* 顶轨(不动) */}
          <mesh position={[doorW / 2, doorH + 0.04, 0]}>
            <boxGeometry args={[doorW * 1.06, 0.045, 0.05]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          <group ref={panelRef}>
            <group onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              {/* 整片玻璃滑动扇(无自带边框,门洞两侧幕墙竖挺充当框) */}
              <mesh position={[doorW / 2, doorH / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, doorH - 0.03, 0.012]} />
                <meshPhysicalMaterial color="#C8D8E5" transmission={0.86} roughness={0.05} thickness={0.02} metalness={0} transparent opacity={0.34} side={THREE.DoubleSide} />
              </mesh>
              {/* 外置竖向长拉手 + 上下支座 */}
              <group position={[doorW - 0.12, doorH * 0.45, 0.09]}>
                <mesh><boxGeometry args={[0.03, Math.min(0.9, doorH * 0.42), 0.03]} /><meshStandardMaterial color={handleColor} metalness={0.95} roughness={0.2} /></mesh>
                {[Math.min(0.9, doorH * 0.42) / 2 - 0.03, -Math.min(0.9, doorH * 0.42) / 2 + 0.03].map((sy, si) => (
                  <mesh key={si} position={[0, sy, -0.05]}><boxGeometry args={[0.02, 0.02, 0.07]} /><meshStandardMaterial color={handleColor} metalness={0.95} roughness={0.2} /></mesh>
                ))}
              </group>
            </group>
          </group>
        </group>
      ) : doorStyle === "sliding_barn" ? (
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
            // 室内 + 外观图都用精细 glTF 门（用户明确要这种，不要程序化木门）。
            // 外观图（outwardProtrude>0）南面常在阴影里，门板贴图下半又偏暗 → 会
            // 渲成「黑下半」；给 glTF 门加中性浅灰自发光地板抵消阴影（见 GltfDoorPanel
            // 的 exterior 分支），保持漫游那种浅灰门质感、不黑。
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
                    <GltfDoorPanel doorW={doorW} doorH={doorH} exterior={outwardProtrude > 0} onClick={() => onToggle()} />
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
