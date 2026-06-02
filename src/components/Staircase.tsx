"use client";

import { useMemo } from "react";
import { Instances, Instance } from "@react-three/drei";
import { FurnitureItem } from "@/lib/types";

// 默认层高（米），仅当未显式传入 height 时用作楼梯垂直高度。
const FLOOR_H = 2.8;

/**
 * StaircaseGeom — 普通家具化的楼梯几何体。三种形状：直 / L 形 / 螺旋。
 * 几何体填满 W×D×height 的盒子，base 在 y=0、X/Z 居中，方位与大小完全由
 * 外层（PlacedItemMesh 的 group 旋转 + 家具宽深高缩放）决定 —— 不再读
 * 任何 stairConfig。footprint* 仅为历史兼容保留，家具路径恒传 1 / 0。
 */
export function StaircaseGeom({
  W: roomW, D: roomD, color,
  shape = "straight",
  height = FLOOR_H,
  stairRotation = 0,
  footprintW = 1,
  footprintD = 1,
  footprintOffsetX = 0,
  footprintOffsetZ = 0,
}: {
  W: number; D: number; color: string;
  shape?: "straight" | "L-shaped" | "spiral";
  /** 楼梯垂直总高（米）。家具路径 = 家具高度×缩放。默认一个层高。 */
  height?: number;
  stairRotation?: 0 | 90 | 180 | 270;
  /** 楼梯占盒宽 / 深的比例（0.2~1）。家具路径恒 1。 */
  footprintW?: number;
  footprintD?: number;
  /** 相对盒中心的偏移（比例，-0.5~0.5）。家具路径恒 0。 */
  footprintOffsetX?: number;
  footprintOffsetZ?: number;
}) {
  const H = Math.max(0.3, height);
  const fpW = Math.max(0.2, Math.min(1, footprintW));
  const fpD = Math.max(0.2, Math.min(1, footprintD));
  const W = roomW * fpW;
  const D = roomD * fpD;
  const fpOffX = Math.max(-0.5, Math.min(0.5, footprintOffsetX)) * roomW;
  const fpOffZ = Math.max(-0.5, Math.min(0.5, footprintOffsetZ)) * roomD;
  const treadT  = 0.06;
  const railH   = H * 0.95;
  const railMat = <meshStandardMaterial color="#A0A0A8" roughness={0.5} />;
  // 默认朝向：+180° 让 step-0 落在 +Z（南 / 入口端），与历史一致。家具旋转
  // 在外层 group 完成，这里只决定静止朝向。
  const rotY = ((stairRotation + 180) * Math.PI) / 180;

  // ── Straight run ───────────────────────────────────────────
  function StraightRun({ runW, runD, baseY = 0, runH = H }: {
    runW: number; runD: number; baseY?: number; runH?: number;
  }) {
    const STEPS      = 12;
    const treadDepth = runD / STEPS;
    const riserH     = runH / STEPS;
    const treadW2    = runW - 0.08;
    const ROD_R      = 0.020;
    const BAL_R      = 0.013;
    const railH      = 0.90;

    const treads = useMemo(() => Array.from({ length: STEPS }, (_, i) => ({
      midY:   baseY + (i + 1) * riserH - treadT / 2,
      midZ:   i * treadDepth + treadDepth / 2 - runD / 2,
      topY:   baseY + (i + 1) * riserH,
      frontZ: i * treadDepth - runD / 2,
    })), [runD, riserH, treadDepth, baseY]); // eslint-disable-line react-hooks/exhaustive-deps

    const railDY  = runH - railH;
    const railLen = Math.sqrt(railDY * railDY + runD * runD);
    const cylRotX  = Math.atan2(runD, railDY);
    const railMidY = baseY + (railH + runH) / 2;

    const balHOf = (i: number) =>
      railH + i * (railDY / STEPS) - (i + 1) * riserH;

    const balusters = useMemo(() => {
      const arr: Array<{ pos: [number, number, number]; height: number }> = [];
      for (let i = 0; i < STEPS; i++) {
        const bH = balHOf(i);
        if (bH <= 0.02) continue;
        const t = treads[i];
        ([-1, 1] as const).forEach(side => {
          const xSide = side * (treadW2 / 2 - ROD_R * 2);
          arr.push({ pos: [xSide, t.topY + bH / 2, t.frontZ], height: bH });
        });
      }
      return arr;
    }, [treads, treadW2, ROD_R]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <group>
        <Instances limit={treads.length} castShadow receiveShadow>
          <boxGeometry args={[treadW2, treadT, treadDepth]} />
          <meshStandardMaterial color="#6a7d8e" metalness={0.80} roughness={0.20} />
          {treads.map((t, i) => (
            <Instance key={i} position={[0, t.midY, t.midZ]} />
          ))}
        </Instances>

        {([-1, 1] as const).map(side => {
          const xSide = side * (treadW2 / 2 - ROD_R);
          return (
            <mesh key={`rail-${side}`}
              position={[xSide, railMidY, 0]}
              rotation={[cylRotX, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[ROD_R, ROD_R, railLen, 8]} />
              <meshStandardMaterial color="#7c8fa0" metalness={0.85} roughness={0.15} />
            </mesh>
          );
        })}

        {balusters.length > 0 && (
          <Instances limit={balusters.length} castShadow>
            <cylinderGeometry args={[BAL_R, BAL_R, 1, 6]} />
            <meshStandardMaterial color="#7c8fa0" metalness={0.85} roughness={0.15} />
            {balusters.map((b, i) => (
              <Instance key={i} position={b.pos} scale={[1, b.height, 1]} />
            ))}
          </Instances>
        )}
      </group>
    );
  }

  // ── L-shaped: two half-height runs at 90° ──────────────────
  function LShapedRun() {
    const halfH   = H / 2;
    const run1D   = D * 0.55;
    const run1W   = W;
    const run2D   = W * 0.55;
    const run2W   = D;
    const landD   = D * 0.45;
    const landW   = W;
    const landY   = halfH;
    const LSTEPS  = 6;
    const tD1     = run1D / LSTEPS;
    const rH1     = halfH / LSTEPS;
    const tD2     = run2D / LSTEPS;
    const rH2     = halfH / LSTEPS;
    const tW1     = run1W - 0.08;
    const tW2     = run2W - 0.08;
    const treadMat = <meshStandardMaterial color={color} roughness={0.7} />;
    const landMat  = <meshStandardMaterial color={color} roughness={0.8} />;
    const run1Treads = useMemo(() => Array.from({ length: LSTEPS }, (_, i) => ({
      y: i * rH1 + treadT / 2,
      z: i * tD1 + tD1 / 2 - run1D / 2,
    })), []); // eslint-disable-line react-hooks/exhaustive-deps
    const run2Treads = useMemo(() => Array.from({ length: LSTEPS }, (_, i) => ({
      x: i * tD2 + tD2 / 2 - run2D / 2,
      y: landY + i * rH2 + treadT / 2,
    })), []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <group>
        {run1Treads.map((t, i) => (
          <mesh key={`r1-${i}`} position={[0, t.y, t.z]} castShadow receiveShadow>
            <boxGeometry args={[tW1, treadT, tD1 + 0.01]} />
            {treadMat}
          </mesh>
        ))}
        <mesh position={[0, landY - treadT / 2, D / 2 - landD / 2]} receiveShadow>
          <boxGeometry args={[landW - 0.1, treadT, landD]} />
          {landMat}
        </mesh>
        {run2Treads.map((t, i) => (
          <mesh key={`r2-${i}`} position={[t.x, t.y, D / 2 - landD / 2]} castShadow receiveShadow>
            <boxGeometry args={[tD2 + 0.01, treadT, tW2]} />
            {treadMat}
          </mesh>
        ))}
        <mesh position={[-(tW1 / 2 + 0.04), railH / 2, 0]} castShadow>
          <boxGeometry args={[0.08, railH, run1D * 0.95]} />
          {railMat}
        </mesh>
        <mesh position={[tW1 / 2 + 0.04, railH / 2, 0]} castShadow>
          <boxGeometry args={[0.08, railH, run1D * 0.95]} />
          {railMat}
        </mesh>
      </group>
    );
  }

  // ── Spiral ─────────────────────────────────────────────────
  function SpiralRun() {
    const r     = Math.min(W, D) / 2 - 0.1;
    const poleR = Math.max(0.1, r * 0.15);
    const STEPS = 14;
    const dTheta = (Math.PI * 1.5) / STEPS;
    const treadLen = r - poleR - 0.05;

    const spiralTreads = useMemo(() => Array.from({ length: STEPS }, (_, i) => {
      const theta = -Math.PI / 2 + i * dTheta;
      const riseY = (i / STEPS) * H;
      const midR  = poleR + treadLen / 2;
      return {
        x: Math.cos(theta) * midR,
        z: Math.sin(theta) * midR,
        y: riseY + treadT / 2,
        rot: theta,
      };
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <group>
        <mesh position={[0, H / 2, 0]} castShadow>
          <cylinderGeometry args={[poleR, poleR, H, 12]} />
          <meshStandardMaterial color="#8A8890" roughness={0.6} />
        </mesh>
        {spiralTreads.map((t, i) => (
          <mesh key={i} position={[t.x, t.y, t.z]} rotation={[0, -t.rot, 0]} castShadow receiveShadow>
            <boxGeometry args={[treadLen, treadT, Math.min(W, D) * 0.22]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        ))}
        {spiralTreads.map((t, i) => {
          const outerX = Math.cos(t.rot) * (r - 0.04);
          const outerZ = Math.sin(t.rot) * (r - 0.04);
          return (
            <mesh key={`rail-${i}`} position={[outerX, t.y + railH * 0.5, outerZ]}>
              <boxGeometry args={[0.06, 0.15, 0.06]} />
              {railMat}
            </mesh>
          );
        })}
      </group>
    );
  }

  const isTransposed = stairRotation === 90 || stairRotation === 270;
  return (
    <group position={[fpOffX, 0, fpOffZ]}>
      <group rotation={[0, rotY, 0]}>
        {shape === "straight"  && <StraightRun runW={isTransposed ? D : W} runD={isTransposed ? W : D} />}
        {shape === "L-shaped"  && <LShapedRun />}
        {shape === "spiral"    && <SpiralRun />}
      </group>
    </group>
  );
}

// ── 楼梯家具：目录 id → 形状 ─────────────────────────────────
export const STAIR_FURNITURE_IDS = new Set<string>([
  "staircase-straight",
  "staircase-l-shaped",
  "staircase-spiral",
]);

const STAIR_SHAPE_BY_ID: Record<string, "straight" | "L-shaped" | "spiral"> = {
  "staircase-straight": "straight",
  "staircase-l-shaped": "L-shaped",
  "staircase-spiral":   "spiral",
};

/**
 * StaircaseMesh — PlacedItemMesh 派发到这里的楼梯家具。几何体填满
 * fw×fd×fh（米，已含家具缩放），base 在 y=0、居中。方位由外层 group
 * 的家具 rotation 决定，大小由家具宽深高缩放决定 —— 完全走通用机制。
 */
export function StaircaseMesh({ item, fw, fd, fh }: {
  item: FurnitureItem; fw: number; fd: number; fh: number;
}) {
  const shape = STAIR_SHAPE_BY_ID[item.id] ?? "straight";
  return (
    <StaircaseGeom
      W={fw} D={fd} height={fh}
      color={item.color ?? "#9aa3ad"}
      shape={shape}
    />
  );
}
