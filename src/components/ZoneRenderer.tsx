"use client";

/**
 * ZoneRenderer — turns a YardZone into a 3D paving polygon.
 *
 * v3 (technical-drawing aesthetic): drops the procedural PBR texture path
 * entirely (it was never reliably rendering and even when it did, it
 * fought the technical-drawing aesthetic). Zones are now:
 *   - A flat-shaded polygon in a single muted colour
 *   - A precise dark edge line tracing the polygon perimeter (the
 *     architect's "boundary line" — what differentiates "designed
 *     surface" from "raw ground")
 *
 * The result reads as a Vectorworks site-plan slab, not a video-game
 * patch of differently-coloured grass.
 */

import { useMemo } from "react";
import * as THREE from "three";
import type { YardZone } from "@/lib/types";
import { ZONE_STYLES } from "@/lib/outdoorZones";

const CM = 0.01;

// ── 烤制铺装纹理（模块级缓存）────────────────────────────────────
// 参考真实庭院：社交/功能区是大板石材带灰缝，私密区是木平台板条。
// shapeGeometry 的 UV 即多边形局部米坐标，repeat = 1/板宽 ⇒ 一格一块板。
const texCache = new Map<string, THREE.CanvasTexture>();

function bakeTile(key: string, draw: (ctx: CanvasRenderingContext2D, S: number) => void): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  draw(canvas.getContext("2d")!, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/** 大板石材：底色 + 右/下两条灰缝 + 轻微明度斑驳。 */
function paverTexture(base: string): THREE.CanvasTexture {
  return bakeTile(`paver:${base}`, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    // 板面斑驳（几块半透明明暗斑）
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.05)";
      const x = (i * 37) % S, y = (i * 53) % S;
      ctx.fillRect(x, y, 38, 26);
    }
    // 灰缝（右 + 下，拼接后即网格）
    ctx.fillStyle = "rgba(40,38,34,0.55)";
    ctx.fillRect(S - 3, 0, 3, S);
    ctx.fillRect(0, S - 3, S, 3);
  });
}

/** 木平台板条：竖向板 + 板间缝 + 木纹明暗条。 */
function plankTexture(base: string): THREE.CanvasTexture {
  return bakeTile(`plank:${base}`, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const planks = 4;
    const w = S / planks;
    for (let i = 0; i < planks; i++) {
      // 每块板明度微差，读出"一条条"
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
      ctx.fillRect(i * w, 0, w, S);
      // 板缝
      ctx.fillStyle = "rgba(30,24,18,0.6)";
      ctx.fillRect(i * w, 0, 2, S);
    }
  });
}

export function ZoneMesh({ zone }: { zone: YardZone }) {
  const style = ZONE_STYLES[zone.zoneKind];

  // 铺装纹理：社交/功能 = 0.6m 大板石材带灰缝；私密 = 12cm 木平台板条；
  // 草坪/菜园保持平色（草另有地面纹理，菜园是土）。UV 即米坐标。
  const pavingMap = useMemo(() => {
    if (zone.zoneKind === "social" || zone.zoneKind === "utility") {
      const t = paverTexture(style.fallbackColor).clone();
      t.repeat.set(1 / 0.6, 1 / 0.6);
      t.needsUpdate = true;
      return t;
    }
    if (zone.zoneKind === "private") {
      const t = plankTexture(style.fallbackColor).clone();
      t.repeat.set(1 / 0.48, 1 / 0.48);
      t.needsUpdate = true;
      return t;
    }
    return null;
  }, [zone.zoneKind, style.fallbackColor]);

  // Build THREE.Shape from polygon (cm → m), centred on the zone pivot.
  // We render the whole group at world (x, 0, z) so vertices stay local.
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    zone.polygon.forEach(([px, pz], i) => {
      const wx = px * CM;
      const wz = pz * CM;
      if (i === 0) s.moveTo(wx, wz); else s.lineTo(wx, wz);
    });
    s.closePath();
    return s;
  }, [zone.polygon]);

  // Edge curb — short narrow boxes along each polygon segment. This is
  // architecturally truthful (a paved area meets lawn at a stone curb)
  // AND avoids the JSX <line> namespace headache. Casts a real shadow.
  const edgeSegments = useMemo(() => {
    const segs: Array<{ cx: number; cz: number; len: number; angle: number }> = [];
    for (let i = 0; i < zone.polygon.length; i++) {
      const [x1, z1] = zone.polygon[i];
      const [x2, z2] = zone.polygon[(i + 1) % zone.polygon.length];
      const wx1 = x1 * CM, wz1 = z1 * CM;
      const wx2 = x2 * CM, wz2 = z2 * CM;
      const dx = wx2 - wx1, dz = wz2 - wz1;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      segs.push({
        cx: (wx1 + wx2) / 2,
        cz: (wz1 + wz2) / 2,
        len,
        angle: Math.atan2(-dz, dx),
      });
    }
    return segs;
  }, [zone.polygon]);

  // Y position: zone fill at -0.495 (above ground -0.5), curb sits on top.
  const Y_FILL = -0.495;

  return (
    <group position={[zone.x * CM, 0, zone.z * CM]} rotation={[0, zone.rot ?? 0, 0]}>
      {/* Paving polygon — 硬质区带铺装纹理（石板缝/木板条），软质区平色 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y_FILL, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={pavingMap ? "#FFFFFF" : style.fallbackColor}
          map={pavingMap ?? undefined}
          roughness={0.92}
          flatShading={!pavingMap}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stone curb along each polygon edge — 8cm wide × 4cm tall */}
      {edgeSegments.map((seg, i) => (
        <mesh
          key={i}
          position={[seg.cx, Y_FILL + 0.02, seg.cz]}
          rotation={[0, seg.angle, 0]}
          castShadow receiveShadow
        >
          <boxGeometry args={[seg.len, 0.04, 0.08]} />
          <meshStandardMaterial color="#3A3A38" roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}
