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

export function ZoneMesh({ zone }: { zone: YardZone }) {
  const style = ZONE_STYLES[zone.zoneKind];

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
      {/* Paving polygon — flat fill, no texture */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y_FILL, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={style.fallbackColor}
          roughness={0.95}
          flatShading
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
