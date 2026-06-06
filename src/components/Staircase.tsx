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
  shape?: "straight" | "L-shaped" | "u-shaped" | "spiral";
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

    // Nosing — each tread oversteps its riser by ~2.5cm at the front, the
    // way real treads do. Reads as a proper step lip, not a floating slab.
    const NOSING   = 0.025;
    const treads = useMemo(() => Array.from({ length: STEPS }, (_, i) => ({
      midY:   baseY + (i + 1) * riserH - treadT / 2,
      midZ:   i * treadDepth + treadDepth / 2 - runD / 2,
      topY:   baseY + (i + 1) * riserH,
      frontZ: i * treadDepth - runD / 2,
    })), [runD, riserH, treadDepth, baseY]); // eslint-disable-line react-hooks/exhaustive-deps

    // Closed risers — the vertical face beneath the front of each tread,
    // spanning from the previous step's top up to this step's top. This is
    // what turns "floating slats" into a solid, climbable staircase.
    const risers = useMemo(() => Array.from({ length: STEPS }, (_, i) => ({
      y: baseY + (i + 0.5) * riserH,
      z: i * treadDepth - runD / 2,
    })), [riserH, treadDepth, runD, baseY]); // eslint-disable-line react-hooks/exhaustive-deps

    const railDY  = runH - railH;
    const railLen = Math.sqrt(railDY * railDY + runD * runD);
    const cylRotX  = Math.atan2(runD, railDY);
    const railMidY = baseY + (railH + runH) / 2;

    // Side stringers — the angled structural boards the treads sit on, one
    // per side, running the full slope. Give the run visible mass so it
    // reads as built, not floating.
    const strLen   = Math.sqrt(runD * runD + runH * runH);
    const strRotX  = Math.atan2(runD, runH);
    const strMidY  = baseY + (riserH + runH) / 2 - 0.12;
    const STR_DEPTH = 0.26;

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
        {/* Treads — sit on the stringers, with a front nosing lip. */}
        <Instances limit={treads.length} castShadow receiveShadow>
          <boxGeometry args={[treadW2, treadT, treadDepth + NOSING]} />
          <meshStandardMaterial color={color} metalness={0.10} roughness={0.55} />
          {treads.map((t, i) => (
            <Instance key={i} position={[0, t.midY, t.midZ - NOSING / 2]} />
          ))}
        </Instances>

        {/* Closed risers — vertical face under each tread front. */}
        <Instances limit={risers.length} castShadow receiveShadow>
          <boxGeometry args={[treadW2, riserH, 0.02]} />
          <meshStandardMaterial color={color} metalness={0.06} roughness={0.75} />
          {risers.map((r, i) => (
            <Instance key={i} position={[0, r.y, r.z]} />
          ))}
        </Instances>

        {/* Side stringers — angled structural boards giving the run mass. */}
        {([-1, 1] as const).map(side => (
          <mesh key={`stringer-${side}`}
            position={[side * (treadW2 / 2 + 0.03), strMidY, 0]}
            rotation={[strRotX, 0, 0]}
            castShadow receiveShadow
          >
            <boxGeometry args={[0.05, strLen, STR_DEPTH]} />
            <meshStandardMaterial color={color} metalness={0.08} roughness={0.70} />
          </mesh>
        ))}

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

  // ── U-shaped switchback: two half-flights + a half-landing ──
  // 真实双跑转折楼梯。下行半跑(西半)从南端(入口侧)爬到北端的中段休息
  // 平台 → 转 180° → 上行半跑(东半)从平台爬回南端到上一层。关键好处：
  // 上下都在同一侧(南/走廊端)进出，到层后人就站在南端，可直接走到走廊
  // 或同一梯井的下一跑起点，连接天然顺畅。
  function UShapedRun() {
    const HALF_STEPS = 9;                 // 每半跑级数
    const landD   = Math.min(D * 0.24, 1.2); // 北端休息平台进深
    const flightRun = D - landD;          // 每半跑水平投影长
    const halfH   = H / 2;
    const riserH  = halfH / HALF_STEPS;
    const treadDepth = flightRun / HALF_STEPS;
    // 墙体厚度会吃掉 footprint ~0.12m/边（家具尺寸=墙中心线，内净更小），
    // 所以内收要大于墙半厚，否则结构会从墙面探出。
    const MARGIN  = 0.16;                  // 左右(X)离墙留缝：所有结构都收在墙内
    const EDGE_Z  = 0.16;                  // 承重梁/柱北缘内收（藏在墙内不外探）
    const WALL_T  = 0.12;                  // 北墙内净面 = footprint 边内收一个墙厚
    const Wi      = W - 2 * MARGIN;        // 墙内实际可用宽（楼梯整体内收）
    const wellGap = 0.05;                  // 两跑中间梯井缝
    const flightW = Wi / 2 - wellGap;      // 每半跑占宽
    const treadW  = Math.max(0.3, flightW - 0.05);
    const xL = -(Wi / 2) + flightW / 2;    // 西半跑中心 x（下层这跑）
    const xR =  (Wi / 2) - flightW / 2;    // 东半跑中心 x（上层这跑）
    // 扶手装在每跑「临空」的内侧（朝中间梯井），不是贴墙的外侧——
    // 墙本身就是护栏，悬空的中井才需要扶手。
    const innerXL = xL + treadW / 2;       // 西跑朝中井(东)的内缘
    const innerXR = xR - treadW / 2;       // 东跑朝中井(西)的内缘
    const NOSING = 0.025;
    const ROD_R  = 0.020;
    const RAIL_H = 0.90;
    const treadMat = <meshStandardMaterial color={color} metalness={0.10} roughness={0.55} />;
    const riserMat = <meshStandardMaterial color={color} metalness={0.06} roughness={0.75} />;
    const landMat  = <meshStandardMaterial color={color} metalness={0.08} roughness={0.60} />;
    const railMetal = <meshStandardMaterial color="#7c8fa0" metalness={0.85} roughness={0.15} />;

    // 西半跑：y 0→halfH，z 由南(-D/2)爬向北
    const f1 = useMemo(() => Array.from({ length: HALF_STEPS }, (_, i) => ({
      midY:  (i + 1) * riserH - treadT / 2,
      z:     -D / 2 + i * treadDepth + treadDepth / 2,
      frontZ:-D / 2 + i * treadDepth,
      riserY:(i + 0.5) * riserH,
    })), [riserH, treadDepth]); // eslint-disable-line react-hooks/exhaustive-deps
    // 东半跑：y halfH→H，z 由北(D/2-landD)爬回南
    const f2 = useMemo(() => Array.from({ length: HALF_STEPS }, (_, i) => ({
      midY:  halfH + (i + 1) * riserH - treadT / 2,
      z:     (D / 2 - landD) - i * treadDepth - treadDepth / 2,
      frontZ:(D / 2 - landD) - i * treadDepth,
      riserY:halfH + (i + 0.5) * riserH,
    })), [riserH, treadDepth]); // eslint-disable-line react-hooks/exhaustive-deps

    const strLen   = Math.sqrt(flightRun * flightRun + halfH * halfH);
    const strRotX  = Math.atan2(flightRun, halfH);
    const railLen  = strLen;

    return (
      <group>
        {/* 西半跑 踏板 + 踢面 */}
        <Instances limit={HALF_STEPS} castShadow receiveShadow>
          <boxGeometry args={[treadW, treadT, treadDepth + NOSING]} />
          {treadMat}
          {f1.map((t, i) => <Instance key={i} position={[xL, t.midY, t.z - NOSING / 2]} />)}
        </Instances>
        <Instances limit={HALF_STEPS} castShadow receiveShadow>
          <boxGeometry args={[treadW, riserH, 0.02]} />
          {riserMat}
          {f1.map((t, i) => <Instance key={i} position={[xL, t.riserY, t.frontZ]} />)}
        </Instances>
        {/* 东半跑 踏板 + 踢面 */}
        <Instances limit={HALF_STEPS} castShadow receiveShadow>
          <boxGeometry args={[treadW, treadT, treadDepth + NOSING]} />
          {treadMat}
          {f2.map((t, i) => <Instance key={i} position={[xR, t.midY, t.z + NOSING / 2]} />)}
        </Instances>
        <Instances limit={HALF_STEPS} castShadow receiveShadow>
          <boxGeometry args={[treadW, riserH, 0.02]} />
          {riserMat}
          {f2.map((t, i) => <Instance key={i} position={[xR, t.riserY, t.frontZ]} />)}
        </Instances>

        {/* 北端 半层休息平台 —— 横跨梯井，连接上下两跑。底下留空。
            南缘接上下跑顶(z=D/2-landD)，北缘内收 EDGE_Z 不穿北墙。 */}
        {(() => {
          const slabN  = D / 2 - WALL_T;          // 平台板北缘：刚好贴到北墙内净面（无缝、不外探）
          const beamN  = D / 2 - EDGE_Z;          // 承重梁北缘：再多收一点，藏在墙内
          const landS  = D / 2 - landD;           // 平台南缘（接梯跑顶）
          const slabDepth = slabN - landS;        // 平台板进深（一直接到墙）
          const slabCz = (slabN + landS) / 2;     // 平台板中心 z
          const beamDepth = beamN - landS;        // 承重梁进深
          const beamCz = (beamN + landS) / 2;     // 承重梁中心 z
          return (
            <>
              <mesh position={[0, halfH - treadT / 2, slabCz]} castShadow receiveShadow>
                <boxGeometry args={[Wi, treadT, slabDepth]} />
                {landMat}
              </mesh>
              {/* —— 平台承重（真实受力，且全部收在墙内）——
                  平台板正下方一根横向主梁 + 两根落地梯柱，X/Z 双向内收。 */}
              <mesh position={[0, halfH - treadT - 0.075, beamCz]} castShadow receiveShadow>
                <boxGeometry args={[Wi - 0.06, 0.13, Math.max(0.12, beamDepth - 0.18)]} />
                {landMat}
              </mesh>
              {([-1, 1] as const).map(s => (
                <mesh key={`spost-${s}`} position={[s * (Wi / 2 - 0.16), (halfH - treadT) / 2, landS + 0.12]} castShadow receiveShadow>
                  <boxGeometry args={[0.1, halfH - treadT, 0.1]} />
                  {landMat}
                </mesh>
              ))}
            </>
          );
        })()}

        {/* 外侧斜梯梁（每半跑一条） */}
        <mesh position={[-(Wi / 2) + 0.03, (riserH + halfH) / 2 - 0.12, -landD / 2]}
          rotation={[strRotX, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.05, strLen, 0.26]} />
          {landMat}
        </mesh>
        <mesh position={[(Wi / 2) - 0.03, halfH + (riserH + halfH) / 2 - 0.12, -landD / 2]}
          rotation={[-strRotX, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.05, strLen, 0.26]} />
          {landMat}
        </mesh>

        {/* —— 扶手：装在每跑朝中井的内侧（临空侧），顶斜扶手 + 一排栏杆立柱 —— */}
        {/* 西半跑：内侧顶扶手 + 立柱 */}
        <mesh position={[innerXL, RAIL_H + (riserH + halfH) / 2, -landD / 2]}
          rotation={[strRotX, 0, 0]} castShadow>
          <cylinderGeometry args={[ROD_R, ROD_R, railLen, 10]} />
          {railMetal}
        </mesh>
        <Instances limit={HALF_STEPS} castShadow>
          <cylinderGeometry args={[0.012, 0.012, RAIL_H, 6]} />
          {railMetal}
          {f1.map((t, i) => <Instance key={i} position={[innerXL, (i + 1) * riserH + RAIL_H / 2, t.z]} />)}
        </Instances>
        {/* 东半跑（上跑→天台）内侧扶手：随梯爬升，但到天台地面标高(y=H)即封平，
            绝不高出天台。立柱同步缩短，顶端始终落在扶手线上。 */}
        {(() => {
          const ROOF_Y = H;                       // 天台地面 = 楼梯 footprint 顶
          const pts = f2.map((t, i) => ({
            z: t.z,
            treadTop: halfH + (i + 1) * riserH,    // 该级踏面顶高
            y: Math.min(halfH + (i + 1) * riserH + RAIL_H, ROOF_Y), // 扶手高度，封顶到天台
          }));
          const seg = (a: typeof pts[number], b: typeof pts[number], key: string) => {
            const dz = b.z - a.z, dy = b.y - a.y;
            const len = Math.hypot(dz, dy);
            const ang = Math.atan2(dz, dy);
            return (
              <mesh key={key} position={[innerXR, (a.y + b.y) / 2, (a.z + b.z) / 2]}
                rotation={[ang, 0, 0]} castShadow>
                <cylinderGeometry args={[ROD_R, ROD_R, len, 10]} />
                {railMetal}
              </mesh>
            );
          };
          return (
            <>
              {pts.slice(0, -1).map((p, i) => seg(p, pts[i + 1], `f2rail-${i}`))}
              {pts.map((p, i) => {
                const postH = p.y - p.treadTop;    // 立柱高（封顶后自动缩短）
                if (postH < 0.04) return null;     // 顶端贴近天台的省略
                return (
                  <mesh key={`f2post-${i}`} position={[innerXR, p.treadTop + postH / 2, p.z]} castShadow>
                    <cylinderGeometry args={[0.012, 0.012, postH, 6]} />
                    {railMetal}
                  </mesh>
                );
              })}
            </>
          );
        })()}
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
        {shape === "u-shaped"  && <UShapedRun />}
        {shape === "spiral"    && <SpiralRun />}
      </group>
    </group>
  );
}

// ── 楼梯家具：目录 id → 形状 ─────────────────────────────────
export const STAIR_FURNITURE_IDS = new Set<string>([
  "staircase-straight",
  "staircase-l-shaped",
  "staircase-u-shaped",
  "staircase-spiral",
]);

const STAIR_SHAPE_BY_ID: Record<string, "straight" | "L-shaped" | "u-shaped" | "spiral"> = {
  "staircase-straight": "straight",
  "staircase-l-shaped": "L-shaped",
  "staircase-u-shaped": "u-shaped",
  "staircase-spiral":   "spiral",
};

/**
 * StaircaseMesh — PlacedItemMesh 派发到这里的楼梯家具。几何体填满
 * fw×fd×fh（米，已含家具缩放），base 在 y=0、居中。方位由外层 group
 * 的家具 rotation 决定，大小由家具宽深高缩放决定 —— 完全走通用机制。
 */
export function StaircaseMesh({ item, fw, fd, fh, roomH }: {
  item: FurnitureItem; fw: number; fd: number; fh: number;
  /** 楼梯所在房间的净层高（米，= 地面到天花）。楼梯垂直方向恰好填满它：
   *  底踏接地板、顶踏接天花。不传则退回目录高度。 */
  roomH?: number;
}) {
  const shape = STAIR_SHAPE_BY_ID[item.id] ?? "straight";
  // 占地（宽 × 深）必须与平面图里看到的完全一致 —— 平面图用的就是缩放后的
  // fw × fd，所以这里也用 fw × fd，用户在平面图怎么拖，效果图就怎么画。
  // 高度方向则"和自己比较，不和上面楼层比较"：恰好填满所在房间的净层高 roomH
  // （底踏接地板、顶踏接天花）。高度在平面图里看不到，不影响平面↔效果的一致性。
  const W = fw;
  const D = fd;
  const rise = roomH ?? fh;
  return (
    <StaircaseGeom
      W={W} D={D} height={rise}
      color={item.color ?? "#9aa3ad"}
      shape={shape}
    />
  );
}
