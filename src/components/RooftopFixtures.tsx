"use client";
import * as THREE from "three";
import { FurnitureItem } from "@/lib/types";

/**
 * Rooftop fixtures that used to be building-level hardcoded decorations in
 * FloorPlanExterior (vents / HVAC / skylight / green roof / weather station …).
 * They are now ordinary furniture: placed via PlacedItem on a rooftop room,
 * configured with the normal drag / resize / rotate handles.
 *
 * Each fixture component renders centred on the local origin with its base
 * sitting on y = 0 (the slab surface). PlacedItemMesh wraps it in a group
 * positioned at the item's x/z/elevation and rotated by the item's rotation,
 * so these components must NOT bake in any building-relative offset.
 *
 * `fw`/`fd`/`fh` are the item footprint in metres (width × depth × height,
 * including the per-instance scale handles).
 */

export const ROOFTOP_FIXTURE_IDS = new Set<string>([
  "pergola",
  "roof-vent",
  "hvac-condenser",
  "roof-skylight",
  "green-roof-patch",
  "lightning-rod",
  "antenna-mast",
  "weather-station",
  "roof-scupper",
  "solar-thermal-collector",
  "helipad-marking",
  "reflecting-pool",
  "hot-tub",
  "cold-plunge-pool",
  "sky-bar",
]);

type FixtureProps = { item: FurnitureItem; fw: number; fd: number; fh: number };

/** 把十六进制色按因子缩放亮度（用于自动派生暗/亮色块）。 */
function shade(hex: string, factor: number, fallback: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * factor)));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 屋顶通风排气管 — 主管 + 顶部防雨风帽。 */
function RoofVent({ fw, fh, item }: FixtureProps) {
  const rBot = Math.max(0.03, (fw / 2) * 0.62);
  const rTop = rBot * 0.80;
  const capH = 0.08;
  const stackH = Math.max(0.10, fh - capH);
  const color = item.color || "#606468";
  const capColor = shade(color, 0.75, "#484C52");
  return (
    <group>
      <mesh position={[0, stackH / 2, 0]} castShadow>
        <cylinderGeometry args={[rTop, rBot, stackH, 8]} />
        <meshStandardMaterial color={color} roughness={0.60} metalness={0.30} />
      </mesh>
      <mesh position={[0, stackH + 0.02, 0]}>
        <cylinderGeometry args={[rTop + 0.025, rTop + 0.006, capH, 8]} />
        <meshStandardMaterial color={capColor} roughness={0.55} metalness={0.38} />
      </mesh>
    </group>
  );
}

/** HVAC 冷凝器外机 — 机体箱 + 顶部风扇格栅 + 侧面百叶。 */
function HvacCondenser({ fw, fd, fh, item }: FixtureProps) {
  const color = item.color || "#C4C0B8";
  const fanR = Math.min(fw, fd) * 0.33;
  return (
    <group position={[0, fh / 2, 0]}>
      {/* 机体箱 */}
      <mesh castShadow>
        <boxGeometry args={[fw, fh, fd]} />
        <meshStandardMaterial color={color} roughness={0.70} metalness={0.18} envMapIntensity={0.8} />
      </mesh>
      {/* 顶部风扇圆格栅 */}
      <mesh position={[0, fh / 2 + 0.006, 0]}>
        <cylinderGeometry args={[fanR, fanR, 0.012, 16]} />
        <meshStandardMaterial color="#888480" roughness={0.40} metalness={0.60} />
      </mesh>
      {/* 格栅叶片感 */}
      {Array.from({ length: 6 }, (_, gi) => {
        const ga = (gi / 6) * Math.PI;
        return (
          <mesh key={gi} position={[Math.cos(ga) * fanR * 0.47, fh / 2 + 0.012, Math.sin(ga) * fanR * 0.47]} rotation={[0, ga, 0]}>
            <boxGeometry args={[fanR * 1.87, 0.008, 0.025]} />
            <meshStandardMaterial color="#606060" roughness={0.50} metalness={0.55} />
          </mesh>
        );
      })}
      {/* 侧面百叶（前面板） */}
      {Array.from({ length: 6 }, (_, li) => (
        <mesh key={li} position={[0, -fh * 0.35 + li * (fh * 0.13), fd / 2 + 0.003]}>
          <boxGeometry args={[fw * 0.89, 0.022, 0.045]} />
          <meshStandardMaterial color={shade(color, 0.88, "#AEAAA4")} roughness={0.72} metalness={0.14} />
        </mesh>
      ))}
    </group>
  );
}

/** 线性天窗 — 钢框 curb + 夹胶玻璃 + 纵向分隔条 + 室内透光。 */
function RoofSkylight({ fw, fd, item }: FixtureProps) {
  const slW = fw, slD = fd;
  const glassColor = item.color || "#AACCD8";
  return (
    <group>
      {/* Frame curb — dark aluminium channel */}
      <mesh position={[0, 0.045, 0]} castShadow>
        <boxGeometry args={[slW + 0.06, 0.09, slD + 0.06]} />
        <meshStandardMaterial color="#1E2028" roughness={0.20} metalness={0.92} envMapIntensity={2.2} />
      </mesh>
      {/* Glass infill */}
      <mesh position={[0, 0.094, 0]}>
        <boxGeometry args={[slW - 0.02, 0.012, slD - 0.02]} />
        <meshStandardMaterial color={glassColor} transparent opacity={0.58} roughness={0.04} metalness={0.06} envMapIntensity={3.5} emissive="#60B0C8" emissiveIntensity={0.06} />
      </mesh>
      <pointLight position={[0, -0.30, 0]} intensity={2.0} distance={4.0} decay={2.0} color="#D8F0FF" />
      {/* Longitudinal mullion dividers (3 sections) */}
      {[-slW * 0.28, 0, slW * 0.28].map((mx, mi) => (
        <mesh key={mi} position={[mx, 0.094, 0]}>
          <boxGeometry args={[0.028, 0.016, slD - 0.02]} />
          <meshStandardMaterial color="#1E2028" roughness={0.18} metalness={0.94} envMapIntensity={2.0} />
        </mesh>
      ))}
    </group>
  );
}

/** 屋顶绿化块 — 景天科草毯 + 表面色块 + 木栈道 + 边梁。 */
function GreenRoofPatch({ fw, fd, item }: FixtureProps) {
  const grW = fw, grD = fd;
  const substrate = item.color || "#3A6420";
  const boardwalk = "#8B6240";
  const patchLight = shade(substrate, 1.20, substrate);
  const patchDark = shade(substrate, 0.75, substrate);
  const stringer = shade(boardwalk, 0.78, "#6A4828");
  return (
    <group>
      {/* Substrate */}
      <mesh position={[0, 0.045, 0]} receiveShadow>
        <boxGeometry args={[grW, 0.090, grD]} />
        <meshStandardMaterial color={substrate} roughness={0.98} metalness={0.0} />
      </mesh>
      {/* Surface texture patches */}
      {Array.from({ length: 16 }, (_, gi) => {
        const gHash = (gi * 17 + 5) % 13;
        const gx = -grW / 2 + 0.30 + (gi % 4) * (grW - 0.60) / 3;
        const gz = -grD / 2 + 0.30 + Math.floor(gi / 4) * (grD - 0.60) / 3;
        return (
          <mesh key={gi} position={[gx + (gHash - 6) * 0.08, 0.092, gz + (gHash % 4 - 2) * 0.08]}>
            <sphereGeometry args={[0.28 + (gHash % 3) * 0.07, 5, 3]} />
            <meshStandardMaterial color={gHash % 2 === 0 ? patchLight : patchDark} roughness={0.98} />
          </mesh>
        );
      })}
      {/* Boardwalk — 5 deck boards */}
      {Array.from({ length: 5 }, (_, bi) => {
        const bz = -grD / 2 + 0.35 + bi * (grD - 0.70) / 4;
        return (
          <mesh key={bi} position={[0, 0.115, bz]} castShadow>
            <boxGeometry args={[grW * 0.70, 0.028, 0.14]} />
            <meshStandardMaterial color={boardwalk} roughness={0.80} metalness={0.05} emissive="#4A2C10" emissiveIntensity={0.04} />
          </mesh>
        );
      })}
      {/* Boardwalk side stringers */}
      {[-grW * 0.355, grW * 0.355].map((sx, si) => (
        <mesh key={si} position={[sx, 0.112, 0]} castShadow>
          <boxGeometry args={[0.040, 0.022, grD * 0.70]} />
          <meshStandardMaterial color={stringer} roughness={0.75} metalness={0.06} />
        </mesh>
      ))}
    </group>
  );
}

/** 避雷针 — 底座夹具 + 镀锌杆 + 顶端球。 */
function LightningRod({ fh }: FixtureProps) {
  const shaftH = Math.max(0.30, fh - 0.10);
  return (
    <group>
      <mesh position={[0, 0.020, 0]}>
        <boxGeometry args={[0.055, 0.040, 0.055]} />
        <meshStandardMaterial color="#607080" roughness={0.35} metalness={0.72} />
      </mesh>
      <mesh position={[0, 0.04 + shaftH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.007, 0.010, shaftH, 6]} />
        <meshStandardMaterial color="#9AAAB4" roughness={0.25} metalness={0.82} />
      </mesh>
      <mesh position={[0, 0.04 + shaftH + 0.012, 0]}>
        <sphereGeometry args={[0.012, 6, 4]} />
        <meshStandardMaterial color="#C0D0D8" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
      </mesh>
    </group>
  );
}

/** 通信天线杆 — 法兰底座 + 桅杆 + 小型卫星天线 + 三根拉线。 */
function AntennaMast({ fh }: FixtureProps) {
  const mH = Math.max(0.60, fh - 0.05);
  return (
    <group>
      <mesh position={[0, 0.015, 0]}>
        <boxGeometry args={[0.14, 0.030, 0.14]} />
        <meshStandardMaterial color="#484C58" roughness={0.40} metalness={0.72} />
      </mesh>
      <mesh position={[0, mH / 2 + 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.020, mH, 6]} />
        <meshStandardMaterial color="#3C4050" roughness={0.30} metalness={0.80} />
      </mesh>
      <group position={[0, mH + 0.05, 0]} rotation={[0.35, 0, 0]}>
        <mesh>
          <cylinderGeometry args={[0.18, 0.18, 0.012, 12]} />
          <meshStandardMaterial color="#B8C0CC" roughness={0.45} metalness={0.52} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.10, -0.10]}>
          <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
          <meshStandardMaterial color="#8A9098" roughness={0.40} metalness={0.65} />
        </mesh>
      </group>
      {[0, 120, 240].map((deg, gi) => {
        const radians = (deg * Math.PI) / 180;
        const wireX = Math.sin(radians) * 0.55;
        const wireZ = Math.cos(radians) * 0.55;
        const wireLen = Math.sqrt(wireX * wireX + (mH * 0.65) * (mH * 0.65) + wireZ * wireZ);
        const wireAngle = Math.atan2(mH * 0.65, 0.55);
        return (
          <mesh key={gi} position={[wireX / 2, mH * 0.35, wireZ / 2]} rotation={[wireAngle, radians, 0]}>
            <boxGeometry args={[0.006, wireLen, 0.006]} />
            <meshStandardMaterial color="#505860" roughness={0.60} metalness={0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 屋顶气象站 — 镀锌杆 + 横臂 + 风速仪/风向标/雨量计/辐射罩/数据采集盒。 */
function WeatherStation({ fh }: FixtureProps) {
  const poleH = Math.max(0.80, fh - 0.04);
  return (
    <group>
      <mesh position={[0, 0.018, 0]}>
        <boxGeometry args={[0.16, 0.036, 0.16]} />
        <meshStandardMaterial color="#505860" roughness={0.40} metalness={0.70} />
      </mesh>
      <mesh position={[0, poleH / 2 + 0.036, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.022, poleH, 6]} />
        <meshStandardMaterial color="#9AAAB4" roughness={0.28} metalness={0.78} />
      </mesh>
      <mesh position={[0, poleH * 0.72, 0]}>
        <boxGeometry args={[0.65, 0.018, 0.018]} />
        <meshStandardMaterial color="#8A9AA4" roughness={0.30} metalness={0.75} />
      </mesh>
      {/* Cup anemometer */}
      <group position={[0.30, poleH * 0.72 + 0.15, 0]}>
        <mesh>
          <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
          <meshStandardMaterial color="#606870" roughness={0.35} metalness={0.70} />
        </mesh>
        {[0, 120, 240].map((deg, ci) => {
          const rad = (deg * Math.PI) / 180;
          const sx = Math.cos(rad) * 0.060;
          const sz = Math.sin(rad) * 0.060;
          return (
            <group key={ci}>
              <mesh position={[sx / 2, 0.055, sz / 2]} rotation={[0, -rad, 0]}>
                <boxGeometry args={[0.12, 0.006, 0.006]} />
                <meshStandardMaterial color="#707880" roughness={0.30} metalness={0.72} />
              </mesh>
              <mesh position={[sx * 1.7, 0.055, sz * 1.7]}>
                <sphereGeometry args={[0.028, 6, 4]} />
                <meshStandardMaterial color="#C8D0D8" roughness={0.20} metalness={0.80} />
              </mesh>
            </group>
          );
        })}
      </group>
      {/* Wind vane */}
      <group position={[-0.28, poleH * 0.72 + 0.08, 0]}>
        <mesh position={[0, 0.060, 0]}>
          <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
          <meshStandardMaterial color="#606870" roughness={0.35} metalness={0.70} />
        </mesh>
        <mesh position={[0.055, 0.120, 0]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[0.16, 0.008, 0.05]} />
          <meshStandardMaterial color="#D0D8E0" roughness={0.22} metalness={0.80} />
        </mesh>
        <mesh position={[-0.044, 0.120, 0]}>
          <coneGeometry args={[0.022, 0.055, 4]} />
          <meshStandardMaterial color="#B0B8C4" roughness={0.22} metalness={0.80} />
        </mesh>
      </group>
      {/* Tipping-bucket rain gauge */}
      <group position={[0.04, poleH * 0.50, 0.04]}>
        <mesh><boxGeometry args={[0.045, 0.010, 0.045]} /><meshStandardMaterial color="#707880" roughness={0.40} metalness={0.68} /></mesh>
        <mesh position={[0, 0.065, 0]}>
          <cylinderGeometry args={[0.042, 0.055, 0.085, 10]} />
          <meshStandardMaterial color="#E0E4E8" roughness={0.20} metalness={0.60} />
        </mesh>
        <mesh position={[0, 0.018, 0]}>
          <cylinderGeometry args={[0.032, 0.032, 0.040, 8]} />
          <meshStandardMaterial color="#B8C0CC" roughness={0.25} metalness={0.65} />
        </mesh>
      </group>
      {/* Solar radiation shield */}
      <group position={[-0.04, poleH * 0.38, -0.04]}>
        {[0, 0.026, 0.052].map((dy, di) => (
          <mesh key={di} position={[0, dy, 0]}>
            <cylinderGeometry args={[0.050, 0.062, 0.018, 10]} />
            <meshStandardMaterial color="#F0F0EC" roughness={0.35} metalness={0.25} />
          </mesh>
        ))}
        <mesh position={[0, 0.035, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.10, 5]} />
          <meshStandardMaterial color="#808890" roughness={0.40} metalness={0.60} />
        </mesh>
      </group>
      {/* Data logger box */}
      <mesh position={[0, poleH * 0.22, 0.060]} castShadow>
        <boxGeometry args={[0.110, 0.075, 0.060]} />
        <meshStandardMaterial color="#2A2E38" roughness={0.50} metalness={0.45} />
      </mesh>
      <mesh position={[0.020, poleH * 0.22 + 0.020, 0.092]}>
        <sphereGeometry args={[0.006, 5, 4]} />
        <meshStandardMaterial color="#00FF60" emissive="#00FF60" emissiveIntensity={0.40} roughness={0.20} metalness={0.10} />
      </mesh>
      <mesh position={[0.024, poleH * 0.30, 0]}>
        <cylinderGeometry args={[0.007, 0.007, poleH * 0.60, 4]} />
        <meshStandardMaterial color="#303840" roughness={0.65} metalness={0.25} />
      </mesh>
    </group>
  );
}

/** 屋顶排水口 — 金属排水管 + 滴水唇。 */
function RoofScupper({ item }: FixtureProps) {
  const color = item.color || "#5A6070";
  const dripLip = shade(color, 0.80, "#484E5C");
  return (
    <group position={[0, 0.09, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.042, 0.042, 0.18, 8]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.45} />
      </mesh>
      <mesh position={[0.092, -0.022, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.052, 0.052, 0.018, 8]} />
        <meshStandardMaterial color={dripLip} roughness={0.50} metalness={0.48} />
      </mesh>
    </group>
  );
}

/** 太阳能热水真空管集热器（单组，南向倾斜 35°）。 */
function SolarThermalCollector({ fw, fd }: FixtureProps) {
  const tilt = 0.61;            // ≈35°
  const tubeR = 0.035;
  const tubeGap = 0.065;
  const bankW = Math.max(0.30, fw);
  const tubeL = Math.max(0.60, fd);
  const tubeCount = Math.max(4, Math.round(bankW / tubeGap));
  const span = tubeCount * tubeGap;
  const lift = (tubeL / 2) * Math.cos(tilt) + 0.04;
  return (
    <group position={[0, lift, 0]} rotation={[tilt, 0, 0]}>
      {[-tubeL * 0.28, tubeL * 0.28].map((fz, fi) => (
        <mesh key={fi} position={[0, 0, fz]} castShadow>
          <boxGeometry args={[span + 0.08, 0.040, 0.035]} />
          <meshStandardMaterial color="#B0B8C0" roughness={0.28} metalness={0.75} />
        </mesh>
      ))}
      <mesh position={[0, tubeL * 0.38, 0]} castShadow>
        <boxGeometry args={[span + 0.06, 0.080, 0.080]} />
        <meshStandardMaterial color="#8892A0" roughness={0.35} metalness={0.68} />
      </mesh>
      {[-span / 2 - 0.025, span / 2 + 0.025].map((ex, ei) => (
        <mesh key={ei} position={[ex, tubeL * 0.38, 0]}>
          <boxGeometry args={[0.04, 0.09, 0.09]} />
          <meshStandardMaterial color="#606870" roughness={0.40} metalness={0.55} />
        </mesh>
      ))}
      {Array.from({ length: tubeCount }, (_, ti) => {
        const tx = -span / 2 + ti * tubeGap + tubeGap / 2;
        return (
          <group key={ti} position={[tx, 0, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[tubeR, tubeR, tubeL, 10]} />
              <meshPhysicalMaterial color="#C8D8E4" transparent opacity={0.55} roughness={0.04} metalness={0.05} transmission={0.30} side={2} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[tubeR * 0.55, tubeR * 0.55, tubeL - 0.02, 10]} />
              <meshStandardMaterial color="#142030" roughness={0.18} metalness={0.55} emissive="#0A1820" emissiveIntensity={0.10} />
            </mesh>
            <mesh position={[0, tubeL / 2 - 0.015, 0]}>
              <cylinderGeometry args={[0.010, 0.010, 0.06, 6]} />
              <meshStandardMaterial color="#C87844" roughness={0.40} metalness={0.70} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[span / 2 - 0.03, tubeL * 0.10, -0.055]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, tubeL * 0.58, 6]} />
        <meshStandardMaterial color="#404850" roughness={0.60} metalness={0.20} />
      </mesh>
    </group>
  );
}

/** 屋顶直升机停机坪标志（ICAO 视觉标记）。 */
function HelipadMarking({ fw }: FixtureProps) {
  const hpR = Math.max(0.40, fw / 2 - 0.10);
  const segments = 32;
  return (
    <group position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[hpR + 0.10, segments]} />
        <meshStandardMaterial color="#E8E4DE" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[hpR - 0.18, hpR, segments]} />
        <meshStandardMaterial color="#EFEFEF" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0, 0.003]}>
        <circleGeometry args={[hpR - 0.18, segments]} />
        <meshStandardMaterial color="#E8C830" roughness={0.86} />
      </mesh>
      <mesh position={[-hpR * 0.26, 0, 0.006]}>
        <planeGeometry args={[hpR * 0.16, hpR * 0.72]} />
        <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
      </mesh>
      <mesh position={[hpR * 0.26, 0, 0.006]}>
        <planeGeometry args={[hpR * 0.16, hpR * 0.72]} />
        <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
      </mesh>
      <mesh position={[0, 0, 0.006]}>
        <planeGeometry args={[hpR * 0.52 + hpR * 0.16, hpR * 0.16]} />
        <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((ang, ti) => {
        const tx = Math.sin(ang) * (hpR - 0.08);
        const ty = Math.cos(ang) * (hpR - 0.08);
        return (
          <mesh key={ti} position={[tx, ty, 0.005]} rotation={[0, 0, -ang]}>
            <planeGeometry args={[0.15, 0.24]} />
            <meshStandardMaterial color="#FF6020" roughness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 屋顶浅水景观镜面池。 */
function ReflectingPool({ fw, fd }: FixtureProps) {
  const rpW = Math.max(0.60, fw);
  const rpL = Math.max(0.40, fd);
  const rpDp = 0.18;
  return (
    <group>
      <mesh position={[0, rpDp / 2, 0]} castShadow>
        <boxGeometry args={[rpW + 0.14, rpDp + 0.04, rpL + 0.14]} />
        <meshStandardMaterial color="#282A30" roughness={0.45} metalness={0.35} envMapIntensity={1.4} />
      </mesh>
      <mesh position={[0, 0.008, 0]}>
        <boxGeometry args={[rpW, 0.016, rpL]} />
        <meshStandardMaterial color="#1A1C22" roughness={0.55} metalness={0.12} />
      </mesh>
      <mesh position={[0, rpDp - 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
        <planeGeometry args={[rpW - 0.02, rpL - 0.02]} />
        <meshStandardMaterial color="#4898C0" transparent opacity={0.88} depthWrite={false} roughness={0.02} metalness={0.15} envMapIntensity={6.0} emissive="#2070A0" emissiveIntensity={0.06} />
      </mesh>
      <mesh position={[0, rpDp + 0.022, 0]}>
        <boxGeometry args={[rpW + 0.16, 0.014, rpL + 0.16]} />
        <meshStandardMaterial color="#484C58" roughness={0.22} metalness={0.78} envMapIntensity={2.0} />
      </mesh>
    </group>
  );
}

/** 屋顶按摩浴缸（柚木围边 + 蓝色水面）。 */
function HotTub({ fw }: FixtureProps) {
  const teakW = 0.28;
  const htW = Math.max(0.60, fw - teakW * 2);
  const htH = 0.65;
  const outer = htW + teakW * 2;
  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[outer, 0.075, outer]} />
        <meshStandardMaterial color="#7A5030" roughness={0.72} metalness={0.03} />
      </mesh>
      {Array.from({ length: 5 }, (_, pi) => (
        <mesh key={pi} position={[0, 0.078, -outer / 2 - 0.002 + pi * (outer / 5)]}>
          <boxGeometry args={[outer, 0.006, 0.008]} />
          <meshStandardMaterial color="#5A3820" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, htH / 2, 0]}>
        <boxGeometry args={[htW, htH, htW]} />
        <meshStandardMaterial color="#E8E4E0" roughness={0.35} metalness={0.08} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[htW - 0.06, htW - 0.06]} />
        <meshStandardMaterial color="#1A2A40" roughness={0.52} metalness={0.15} />
      </mesh>
      <mesh position={[0, htH - 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
        <planeGeometry args={[htW - 0.06, htW - 0.06]} />
        <meshStandardMaterial color="#2870B8" transparent opacity={0.85} roughness={0.02} metalness={0.10} envMapIntensity={5.0} emissive="#1858A0" emissiveIntensity={0.06} depthWrite={false} />
      </mesh>
      {Array.from({ length: 4 }, (_, ji) => {
        const ang = (ji / 4) * Math.PI * 2;
        const jx = Math.sin(ang) * (htW * 0.44);
        const jz = Math.cos(ang) * (htW * 0.44);
        return (
          <mesh key={ji} position={[jx, htH * 0.45, jz]} rotation={[0, ang, 0]}>
            <cylinderGeometry args={[0.030, 0.030, 0.025, 8]} />
            <meshStandardMaterial color="#C8D0D8" roughness={0.25} metalness={0.80} envMapIntensity={2.0} />
          </mesh>
        );
      })}
      <mesh position={[htW / 2 + teakW * 0.55, 0.090, -htW / 2 - teakW * 0.55]} rotation={[0.05, 0.3, 0.05]}>
        <boxGeometry args={[0.28, 0.040, 0.22]} />
        <meshStandardMaterial color="#F0EBE0" roughness={0.88} />
      </mesh>
    </group>
  );
}

/** 屋顶不锈钢冷水泳池（带玻璃观景面 + 扶手）。 */
function ColdPlungePool({ fw, fd }: FixtureProps) {
  const wallT = 0.06;
  const cpW = Math.max(0.60, fw - wallT * 2);
  const cpD = Math.max(0.40, fd - wallT * 2);
  const cpH = 0.90;
  return (
    <group>
      <mesh position={[0, cpH / 2, 0]} castShadow>
        <boxGeometry args={[cpW + wallT * 2, cpH + wallT, cpD + wallT * 2]} />
        <meshStandardMaterial color="#282C36" roughness={0.22} metalness={0.70} envMapIntensity={2.5} />
      </mesh>
      <mesh position={[0, cpH / 2, 0]}>
        <boxGeometry args={[cpW, cpH, cpD]} />
        <meshStandardMaterial color="#8A9298" roughness={0.18} metalness={0.90} envMapIntensity={3.0} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, cpH - 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
        <planeGeometry args={[cpW - 0.02, cpD - 0.02]} />
        <meshStandardMaterial color="#3888B0" transparent opacity={0.88} roughness={0.01} metalness={0.08} envMapIntensity={6.0} emissive="#206898" emissiveIntensity={0.04} depthWrite={false} />
      </mesh>
      <mesh position={[0, cpH * 0.46, -cpD / 2 - wallT * 0.5]} renderOrder={11}>
        <boxGeometry args={[cpW * 0.70, cpH * 0.80, 0.014]} />
        <meshStandardMaterial color="#A0D0E8" transparent opacity={0.25} roughness={0.02} metalness={0.06} envMapIntensity={5.0} emissive="#70B8D8" emissiveIntensity={0.02} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {([
        [0, cpD / 2 + wallT, cpW + wallT * 4, wallT * 2 + 0.06],
        [0, -cpD / 2 - wallT, cpW + wallT * 4, wallT * 2 + 0.06],
        [cpW / 2 + wallT, 0, wallT * 2 + 0.06, cpD + wallT * 4 + 0.06],
        [-cpW / 2 - wallT, 0, wallT * 2 + 0.06, cpD + wallT * 4 + 0.06],
      ] as [number, number, number, number][]).map(([x, z, w, d], ci) => (
        <mesh key={ci} position={[x, cpH + wallT * 0.5 + 0.006, z]}>
          <boxGeometry args={[w, 0.018, d]} />
          <meshStandardMaterial color="#1A1C20" roughness={0.10} metalness={0.65} envMapIntensity={3.0} />
        </mesh>
      ))}
      {[-0.10, 0.10].map((hx, hi) => (
        <group key={hi} position={[cpW / 2 + wallT + 0.02, 0, hx]}>
          <mesh position={[0, cpH * 0.55, 0]}>
            <cylinderGeometry args={[0.016, 0.016, cpH * 1.06, 6]} />
            <meshStandardMaterial color="#C0C8D0" roughness={0.16} metalness={0.92} envMapIntensity={2.5} />
          </mesh>
          <mesh position={[0, cpH * 0.28, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.012, 0.012, 0.20, 6]} />
            <meshStandardMaterial color="#B8C0C8" roughness={0.18} metalness={0.90} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, cpH + 0.025, cpD / 2 + wallT + 0.04]}>
        <boxGeometry args={[0.55, 0.030, 0.018]} />
        <meshStandardMaterial color="#9AA0A8" roughness={0.18} metalness={0.88} envMapIntensity={2.0} />
      </mesh>
    </group>
  );
}

/** 屋顶露天酒吧台（L 形吧台 + 吧椅 + 后吧酒架）。 */
function SkyBar({ fw, fd, fh }: FixtureProps) {
  const barEmi = 0.30;
  const ctopCol = "#2C3040";
  const bodyCol = "#1A1C22";
  return (
    <group scale={[fw / 3.0, fh / 1.95, fd / 2.2]}>
      {/* Main bar counter body */}
      <mesh position={[0, 0.90, 0]} castShadow>
        <boxGeometry args={[2.20, 0.040, 0.65]} />
        <meshStandardMaterial color={ctopCol} roughness={0.10} metalness={0.50} envMapIntensity={3.5} />
      </mesh>
      <mesh position={[0, 0.872, -0.33]}>
        <boxGeometry args={[2.20, 0.020, 0.018]} />
        <meshStandardMaterial color="#303848" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
      </mesh>
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[2.20, 0.88, 0.62]} />
        <meshStandardMaterial color={bodyCol} roughness={0.30} metalness={0.60} envMapIntensity={2.0} />
      </mesh>
      <mesh position={[0, 0.040, -0.32]}>
        <boxGeometry args={[2.10, 0.010, 0.012]} />
        <meshStandardMaterial color="#FFE4A0" emissive="#FFD060" emissiveIntensity={barEmi} roughness={0.60} />
      </mesh>
      {/* Return leg */}
      <mesh position={[1.10, 0.90, 0.52]} castShadow>
        <boxGeometry args={[0.65, 0.040, 1.40]} />
        <meshStandardMaterial color={ctopCol} roughness={0.10} metalness={0.50} envMapIntensity={3.5} />
      </mesh>
      <mesh position={[1.10, 0.44, 0.52]} castShadow>
        <boxGeometry args={[0.62, 0.88, 1.40]} />
        <meshStandardMaterial color={bodyCol} roughness={0.30} metalness={0.60} envMapIntensity={2.0} />
      </mesh>
      <mesh position={[0.79, 0.040, 0.52]}>
        <boxGeometry args={[0.012, 0.010, 1.30]} />
        <meshStandardMaterial color="#FFE4A0" emissive="#FFD060" emissiveIntensity={barEmi} roughness={0.60} />
      </mesh>
      {/* 5 bar stools */}
      {Array.from({ length: 5 }, (_, si) => {
        const sx = -0.88 + si * 0.44;
        return (
          <group key={si} position={[sx, 0, -0.76]}>
            <mesh position={[0, 0.75, 0]}>
              <cylinderGeometry args={[0.18, 0.17, 0.048, 10]} />
              <meshStandardMaterial color="#1A1C22" roughness={0.24} metalness={0.82} envMapIntensity={2.0} />
            </mesh>
            <mesh position={[0, 0.778, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 0.030, 10]} />
              <meshStandardMaterial color="#383050" roughness={0.80} metalness={0.02} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.022, 0.028, 0.74, 8]} />
              <meshStandardMaterial color="#505868" roughness={0.22} metalness={0.84} envMapIntensity={1.8} />
            </mesh>
            <mesh position={[0, 0.025, 0]}>
              <cylinderGeometry args={[0.22, 0.24, 0.025, 12]} />
              <meshStandardMaterial color="#404858" roughness={0.28} metalness={0.80} envMapIntensity={1.6} />
            </mesh>
          </group>
        );
      })}
      {/* Back bar */}
      <group position={[1.42, 0, 0]}>
        <mesh position={[0, 1.05, 0.15]} castShadow>
          <boxGeometry args={[0.12, 1.80, 0.80]} />
          <meshStandardMaterial color="#161820" roughness={0.45} metalness={0.40} />
        </mesh>
        {[0.80, 1.18, 1.52].map((sy, si) => (
          <mesh key={si} position={[0.065, sy, 0.15]}>
            <boxGeometry args={[0.020, 0.012, 0.70]} />
            <meshStandardMaterial color="#B0C8D8" transparent opacity={0.55} roughness={0.04} metalness={0.10} envMapIntensity={4.0} />
          </mesh>
        ))}
        {Array.from({ length: 6 }, (_, bi) => {
          const bz = -0.30 + bi * 0.12;
          return (
            <group key={bi} position={[0.065, 1.24, bz]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.030, 0.028, 0.28, 7]} />
                <meshStandardMaterial color={bi % 3 === 0 ? "#3A5020" : bi % 3 === 1 ? "#6A3010" : "#1A2840"} roughness={0.08} metalness={0.08} envMapIntensity={3.0} transparent opacity={0.85} />
              </mesh>
              <mesh position={[0, 0.17, 0]}>
                <cylinderGeometry args={[0.012, 0.020, 0.10, 6]} />
                <meshStandardMaterial color="#C0A060" roughness={0.20} metalness={0.60} />
              </mesh>
            </group>
          );
        })}
        {Array.from({ length: 4 }, (_, wi) => (
          <mesh key={wi} position={[0.065, 0.70 - wi * 0.14, wi % 2 === 0 ? 0.05 : -0.05]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.033, 0.033, 0.30, 7]} />
            <meshStandardMaterial color={wi % 2 === 0 ? "#4A2840" : "#2A4820"} transparent opacity={0.82} roughness={0.06} metalness={0.06} envMapIntensity={2.5} />
          </mesh>
        ))}
        <mesh position={[-0.002, 1.05, 0.15]}>
          <boxGeometry args={[0.006, 1.78, 0.78]} />
          <meshStandardMaterial color="#C8D4DC" roughness={0.04} metalness={0.96} envMapIntensity={5.0} />
        </mesh>
        <mesh position={[0.060, 1.88, 0.15]}>
          <boxGeometry args={[0.012, 0.010, 0.72]} />
          <meshStandardMaterial color="#FFF0D0" emissive="#FFE090" emissiveIntensity={barEmi} roughness={0.60} />
        </mesh>
      </group>
      {/* Decorative plant */}
      <group position={[-1.08, 0.94, -0.18]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.075, 0.065, 0.12, 8]} />
          <meshStandardMaterial color="#D0A878" roughness={0.72} metalness={0.06} />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshStandardMaterial color="#2E6020" roughness={0.95} metalness={0.01} />
        </mesh>
      </group>
    </group>
  );
}

/** 凉亭 / 遮阳棚 — 四角钢柱 + 横梁 + 木格栅顶（按物件尺寸参数化）。 */
function Pergola({ fw, fd, fh, item }: FixtureProps) {
  const postH  = Math.max(1.6, fh);
  const postR  = 0.07;
  const roofT  = 0.04;
  const inset  = Math.min(0.2, fw / 2 - 0.05, fd / 2 - 0.05);
  const slats  = Math.max(3, Math.round(fw / 0.45));
  const postCol = item.color && /steel|metal/i.test(item.color) ? item.color : "#5C5C5C";
  const slatCol = "#6B4C2A";
  const posts: [number, number][] = [
    [-fw / 2 + inset,  fd / 2 - inset],
    [ fw / 2 - inset,  fd / 2 - inset],
    [-fw / 2 + inset, -fd / 2 + inset],
    [ fw / 2 - inset, -fd / 2 + inset],
  ];
  return (
    <group>
      {/* steel posts */}
      {posts.map(([px, pz], i) => (
        <mesh key={i} position={[px, postH / 2, pz]} castShadow>
          <cylinderGeometry args={[postR, postR, postH, 10]} />
          <meshStandardMaterial color={postCol} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      {/* cross-beams along X */}
      {[-fd / 2 + inset, fd / 2 - inset].map((pz, i) => (
        <mesh key={i} position={[0, postH, pz]} castShadow>
          <boxGeometry args={[fw - inset * 2, 0.06, 0.10]} />
          <meshStandardMaterial color={postCol} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      {/* wooden slats along Z */}
      {Array.from({ length: slats }, (_, i) => {
        const t = slats > 1 ? i / (slats - 1) : 0.5;
        const sx = (-fw / 2 + inset) + (fw - inset * 2) * t;
        return (
          <mesh key={i} position={[sx, postH + 0.04, 0]} castShadow>
            <boxGeometry args={[0.06, roofT, fd - inset * 2]} />
            <meshStandardMaterial color={slatCol} roughness={0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

export function RooftopFixtureMesh(props: FixtureProps) {
  switch (props.item.id) {
    case "pergola": return <Pergola {...props} />;
    case "roof-vent": return <RoofVent {...props} />;
    case "hvac-condenser": return <HvacCondenser {...props} />;
    case "roof-skylight": return <RoofSkylight {...props} />;
    case "green-roof-patch": return <GreenRoofPatch {...props} />;
    case "lightning-rod": return <LightningRod {...props} />;
    case "antenna-mast": return <AntennaMast {...props} />;
    case "weather-station": return <WeatherStation {...props} />;
    case "roof-scupper": return <RoofScupper {...props} />;
    case "solar-thermal-collector": return <SolarThermalCollector {...props} />;
    case "helipad-marking": return <HelipadMarking {...props} />;
    case "reflecting-pool": return <ReflectingPool {...props} />;
    case "hot-tub": return <HotTub {...props} />;
    case "cold-plunge-pool": return <ColdPlungePool {...props} />;
    case "sky-bar": return <SkyBar {...props} />;
    default: return null;
  }
}
