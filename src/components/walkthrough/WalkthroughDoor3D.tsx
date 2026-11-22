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

import { useRef, useState, useMemo, Component, ReactNode, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@/lib/drei";
import * as THREE from "three";
import type { DoorStyle } from "@/lib/types";
import { computeDoorTransform } from "@/lib/doorTransform";
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
      // Fill the door opening: width→doorW, height→doorH. door_with_frame's
      // own frame then lines the wall hole exactly. The earlier uniform
      // height-scale left this slender GLB ~13% narrower than the opening →
      // a visible gap between the GLB's frame and the surrounding jamb
      // ("门洞比门宽太多"). The GLB aspect is close to a real door opening's,
      // so the mild non-uniform stretch reads as a normal door; depth is
      // scaled to the smaller factor to keep it from ballooning in-wall.
      const sx = doorW / size.x;
      const sy = doorH / size.y;
      c.scale.set(sx, sy, Math.min(sx, sy));
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
      {/* 正反面校正：door_with_frame.glb 雕花面朝 -z 导出，本工程约定门板 +z=室内。
          铰链在父组 x=0，门把手须在锁边(x≈doorW)。GLB 原生把手就在锁边侧。
          曾用 180°Y 旋转翻正反面，但 Y 旋转会**左右镜像** → 把手被甩到铰链侧
          (几何实测:门局部 handleX 从 0.58 变 0.22)。改用 scale z=-1 只翻正反面、
          不镜像左右，把手留在原生锁边(handleX≈0.58)。GLB 已 z 居中,绕 z=0 翻转位置不变;
          负缩放的正反面剔除由 three.js 按矩阵行列式自动翻正。 */}
      <group scale={[1, 1, -1]}>
        <primitive object={cloned} />
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
// 两扇叶各有自己的铰链组：左扇组原点在门洞左梃（x=0），右扇组原点在右梃
// （x=doorW）；叶几何从铰链线向内展开，rotation.y 绕铰链摆动——这是真铰链
// （分组即铰链），不是静态张开的叶子，也不是整扇平移。半掩时只开左扇
// （父组件 animRef/animRef2 驱动：左扇 -30°、右扇 0°）；点击后两扇对开
// 90° / 回合。门槛石固定不动，不跟扇走。
// 叶内结构（每扇，宽 lw = doorW/2）：
//   french_double：暖白细框 + 一整片通透玻璃（glass_swing 同款玻璃参数，
//     无背板）+ 中横档 + 中缝铜球把手。旧版每扇是整块不透明白板 + 表面贴
//     玻璃片（假玻璃），现已拆除。
//   lattice_door：漆红木框 + 上半镂空方格（真空洞，无玻璃无背板）+ 中横档
//     + 下半实心雕花板（微凸内嵌板）+ 铜球把手。格栅间距与槛窗 sill_lattice
//     一致。隔扇门是 6 件无免费源头的 pieces 之一，程序化建造（three.js），
//     不依赖 Blender（铰链是分组问题，格栅是直条问题）。
//   plank_studded：深红漆厚木板 + 竖向拼缝 + 铜钉阵（3×4）+ 铜环拉手。
//     无格栅（秦汉/唐宫/石库门时代门禁令，见 REPORT.md §3）。
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
          {/* 漆红框：立梃 + 上/中/下横档（中横档分隔上格下板，兰苏园实拍结构） */}
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
// one leaf ~30° open (sliders: 35% slid) until the user first clicks it —
// a room never reads as a sealed box on first sight (cf. the 30° leaf of
// proc-door-frame-wood). Mechanism: internal `touched` state; the rest
// angle is ajar only while `!touched && !isOpen`; the first click sets
// `touched`, after which the toggle is the normal open (90°) / closed
// (0°). Double doors show ONE leaf open while ajar (left leaf only; the
// right leaf stays shut) — rule 2 of the 6 rules. Callers that keep their
// own open state (RoomCanvas store, GlobalCanvas per-door state) just pass
// isOpen/onToggle as before; this component owns only the ajar rest state.
export function WalkthroughDoor3D({
  W, D, H,
  doorWall, doorPosCm, doorLenCm, doorHCm,
  isOpen, onToggle, doorStyle,
  frameColor = "#F0EEEA",
  handleColor = "#B8A060",
  outwardProtrude = 0,
  wallInset = 0.08,
  frameT = 0.08,
  defaultAjar = false,
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
  /** 门板贴墙内缩(米)：厚盒子墙(漫游/外观)0.08 / 薄平面墙(效果图)0.02。 */
  wallInset?: number;
  /** 门框料厚(米)：厚墙 0.08 / 薄墙 0.04。 */
  frameT?: number;
  /** 半掩默认开（Phase A）：首次点击前左扇保持 ~30° 半掩（推拉门为 35%
   *  滑开），点击后进入正常开/合切换。效果图/全屋 3D 传 true；漫游/
   *  外观图不传（保持原样）。默认 false。 */
  defaultAjar?: boolean;
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
  // 第二扇(双开门的右扇)绕自己外侧边、反向对开。glass_swing / french_double /
  // lattice_door / plank_studded 共用。右扇铰链在 x=doorW 处（外侧边）。
  const panelRef2 = useRef<THREE.Group>(null);
  // 半掩：首次点击前 touched=false；点击后进入正常开/合切换。
  const [touched, setTouched] = useState(false);
  const handleToggle = () => { setTouched(true); onToggle(); };
  // Animated values, smoothed each frame toward their targets.
  // 左扇/主扇 (animRef)：铰链转角 (0 → -π/2)，推拉门为平移距离 (0 → -doorW)。
  // 右扇 (animRef2)：铰链转角 (0 → +π/2)，半掩时恒为 0——半掩只开左扇。
  // 铰链是真分组：左扇组原点在门洞左梃（x=0），右扇组原点在右梃（x=doorW），
  // rotation.y 绕组原点摆动 = 绕铰链摆动（不是整扇平移/静态张开）。
  const isSliding = doorStyle === "sliding_barn" || doorStyle === "glass_slide" || doorStyle === "shoji_slide";
  const isDouble = doorStyle === "glass_swing" || doorStyle === "french_double" || doorStyle === "lattice_door" || doorStyle === "plank_studded";
  const fullOpen = isSliding ? -(doorLenCm / 100) : -Math.PI / 2;
  const ajarOpen = isSliding ? -(doorLenCm / 100) * 0.35 : -Math.PI / 6;
  const leftTarget = isOpen ? fullOpen : (!touched && defaultAjar ? ajarOpen : 0);
  const rightTarget = isDouble && isOpen ? Math.PI / 2 : 0;
  const animRef = useRef(leftTarget);
  const animRef2 = useRef(rightTarget);
  useFrame((_, delta) => {
    // Exponential smoothing — feels far snappier than the old linear
    // ramp at the same average speed. Higher k = faster catch-up; the
    // animation visibly accelerates from rest and decelerates as it
    // approaches the target, the way real spring-loaded hinges read.
    // k≈12 for hinges, ≈6 for sliding barn (slower for heavier door).
    const k = isSliding ? 6 : 12;
    // 左扇/主扇
    const diff = leftTarget - animRef.current;
    if (Math.abs(diff) > 0.001) {
      // Frame-rate-independent lerp: c += (t-c) · (1 - e^(-Δt·k))
      // 60 fps → α ≈ 0.18, 30 fps → α ≈ 0.33, identical perceived speed.
      animRef.current += diff * (1 - Math.exp(-delta * k));
    } else if (animRef.current !== leftTarget) {
      // Snap to target so the door doesn't sit at 99.999 % forever.
      animRef.current = leftTarget;
    }
    // 右扇（双开门）：反向对开；半掩时保持关闭。
    if (isDouble) {
      const diff2 = rightTarget - animRef2.current;
      if (Math.abs(diff2) > 0.001) {
        animRef2.current += diff2 * (1 - Math.exp(-delta * k));
      } else if (animRef2.current !== rightTarget) {
        animRef2.current = rightTarget;
      }
    }
    // 每帧把动画值写回节点（含首帧）：初始半掩角就靠这一写落到门扇上，
    // 否则 useRef 的初值只存在 JS 变量里，门扇仍以 rotation 0 渲染。
    if (panelRef.current) {
      if (isSliding) panelRef.current.position.x = animRef.current;
      else panelRef.current.rotation.y = animRef.current;
    }
    if (isDouble && panelRef2.current) panelRef2.current.rotation.y = animRef2.current;
  });

  const doorH = doorHCm / 100;

  // 定位走共享真源 computeDoorTransform（wallInset：厚墙 0.08 / 薄墙 0.02；外观图
  // outwardProtrude 让门凸出墙面）。W 墙翻转 + 角落 clamp 与效果图统一——修掉漫游/
  // 外观里 W 墙门原本无翻转导致的错位(「关着的门 + 旁边空洞」)。
  const _dt = computeDoorTransform(doorWall, W, D, doorPosCm, doorLenCm, wallInset, outwardProtrude);
  if (!_dt) return null;
  const { groupPos, groupRot, hingeOffset, doorW } = _dt;

  return (
    <group position={groupPos} rotation={groupRot}>
      {/* Door frame (stays fixed, inside the wall hole).
          幕墙玻璃门(glass_swing/glass_slide)不画自带门框 —— 它正好填满幕墙的一格,
          左右两侧由幕墙竖挺(mullion/钢筋)充当门框,上方由楼层横梁充当门楣。再画一圈
          自带框就会和幕墙竖挺重叠成「双框」(用户:你没用红色位置的钢筋啊)。
          wood_panel 用 door_with_frame.glb —— 自带完整门框且已缩放填满门洞,再画程序
          框就成「双框」且比 GLB 宽 → 门洞比门宽的空当(用户实测)。故木门也跳过。 */}
      {!(doorStyle === "wood_panel" || doorStyle === "glass_swing" || doorStyle === "glass_slide" || doorStyle === "roller_shutter") && (<>
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
              onClick={(e) => { e.stopPropagation(); handleToggle(); }}
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
                <group onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
                  <Leaf glassCenterX={lw / 2} stileX={lw - 0.02} handleX={lw - 0.085} />
                </group>
              </group>
              {/* 右扇:铰链在外侧右边(x=doorW),组放在 doorW、玻璃 -lw..0,中缝/把手
                  在内侧(x≈-lw)。panelRef2 绕 x=doorW 反向旋开(双开对称)。 */}
              <group ref={panelRef2} position={[doorW, 0, 0]}>
                <group onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
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
            <group onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
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
      ) : doorStyle === "shoji_slide" ? (
        // 障子推拉门（Phase B）：木格 + 半透和纸（与 proc-shoji 同色同格：
        // 木 #8A6A42、纸 #F5EFDC 透光 0.65、横格 ×3 + 竖格 ×2），沿顶轨左滑。
        // 顶轨固定不动，只滑纸扇。半掩 = 滑开 35%。
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
            <boxGeometry args={[doorW * 2.1, 0.06, 0.08]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          <group ref={panelRef}>
          {/* Sliding panel */}
          <mesh
            position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
            onClick={(e) => { e.stopPropagation(); handleToggle(); }}
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
        </group>
      ) : doorStyle === "french_double" || doorStyle === "lattice_door" || doorStyle === "plank_studded" ? (
        // 真铰链对开门（Phase B）：french_double 的假玻璃已拆除——旧版每扇是整块
        // 不透明白板 + 表面贴玻璃片，现为真框 + 通透玻璃；lattice_door /
        // plank_studded 为新增中式对开门。两扇各绕自家外侧铰链对开。
        <HingedDoubleLeaves
          doorW={doorW} doorH={doorH}
          kind={doorStyle}
          handleColor={handleColor}
          onToggle={handleToggle}
          panelRef={panelRef} panelRef2={panelRef2}
        />
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
                    <GltfDoorPanel doorW={doorW} doorH={doorH} exterior={outwardProtrude > 0} onClick={() => handleToggle()} />
                  </Suspense>
                </GltfDoorFallback>
                {/* 门把手：门自带 GLB 已含锁边把手（scale z=-1 校正后落在开门侧），
                    不再叠加程序球形把手 —— 旧的球形把手在锁边、GLB 把手被 Y 翻转甩到
                    铰链侧，两者一左一右对不上（用户："把手没挨着门开的位置"）。 */}
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
