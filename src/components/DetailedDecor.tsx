"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { FurnitureItem } from "@/lib/types";

/** Richer 3D geometry for exterior wall decor. Called BEFORE the generic
 *  plane/box fallback in RoomCanvas + HouseCanvas decor renderers — if it
 *  returns JSX, that wins; otherwise the caller falls back to the usual
 *  texture-plane / emissive-strip / colored-box path.
 *
 *  Input dims (w/h/d) are in METERS, already scaled by the user's
 *  per-instance scaleW/scaleH.
 *
 *  Coord system inside: origin at decor's center-bottom on the wall
 *  surface, +Z = outward from wall (into the viewer's space when looking
 *  at the outside of the wall). */
export function DetailedDecor({ item, w, h, d }: {
  item: FurnitureItem; w: number; h: number; d: number;
}): React.JSX.Element | null {
  switch (item.id) {
    case "wall-lamp-lantern":    return <ChineseLantern w={w} h={h} d={d} />;
    case "wall-lamp-modern":     return <ModernWallLamp w={w} h={h} d={d} />;
    case "light-strip-warm":     return <LightStrip w={w} h={h} d={d} color="#FFE8A8" />;
    case "light-strip-rgb":      return <LightStrip w={w} h={h} d={d} color="#60D0FF" />;
    case "mailbox-modern":       return <Mailbox w={w} h={h} d={d} />;
    case "ac-condenser":         return <AcCondenser w={w} h={h} d={d} />;
    case "climbing-vine":        return <ClimbingVine w={w} h={h} d={d} />;
    case "border-meander":       return <BorderStrip w={w} h={h} d={d} base="#7A3518" accent="#D4A030" pattern="meander" />;
    case "border-floral":        return <BorderStrip w={w} h={h} d={d} base="#F0EADB" accent="#B87030" pattern="floral" />;
    case "house-number":         return <MetalPlate w={w} h={h} d={d} text="888" textColor="#1A1C1E" plateColors={["#D0D2D4","#E8EAEC","#A8ABAE"]} />;
    case "nameplate-family":     return <MetalPlate w={w} h={h} d={d} text="之家" textColor="#3A2410" plateColors={["#D4A85A","#F0C878","#8A6528"]} />;
    default: return null;
  }
}

// ─── Chinese lantern (红色宫灯) ──────────────────────────────
// Cylindrical flattened body (like a ellipsoid), wooden top/bottom caps,
// gold ring accents, hanging rope from above the wall, warm emissive
// light inside so it glows from within.
function ChineseLantern({ w, h, d }: { w: number; h: number; d: number }) {
  // h drives overall scale. Typical lantern: 1.4× as tall as wide.
  const bodyR  = Math.min(w, d) * 0.9;
  const bodyH  = h * 0.62;
  const bodyCY = h * 0.5;
  return (
    <group position={[0, 0, d / 2]}>
      {/* Body (flattened sphere / lantern shape) */}
      <mesh position={[0, bodyCY - h / 2, 0]} scale={[bodyR, bodyH / 2, bodyR]} castShadow>
        <sphereGeometry args={[1, 20, 16]} />
        <meshStandardMaterial
          color="#C82020"
          emissive="#601010"
          emissiveIntensity={0.4}
          roughness={0.78}
        />
      </mesh>
      {/* Gold upper ring */}
      <mesh position={[0, bodyCY + bodyH / 2 - 0.01 - h / 2, 0]}>
        <torusGeometry args={[bodyR * 0.7, bodyR * 0.06, 8, 24]} />
        <meshStandardMaterial color="#D4A030" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* Gold lower ring */}
      <mesh position={[0, bodyCY - bodyH / 2 + 0.01 - h / 2, 0]}>
        <torusGeometry args={[bodyR * 0.7, bodyR * 0.06, 8, 24]} />
        <meshStandardMaterial color="#D4A030" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* Top cap (wooden) */}
      <mesh position={[0, bodyCY + bodyH / 2 + 0.015 - h / 2, 0]}>
        <cylinderGeometry args={[bodyR * 0.55, bodyR * 0.55, 0.03, 16]} />
        <meshStandardMaterial color="#3A1810" roughness={0.85} />
      </mesh>
      {/* Bottom cap with tassel knob */}
      <mesh position={[0, bodyCY - bodyH / 2 - 0.015 - h / 2, 0]}>
        <cylinderGeometry args={[bodyR * 0.55, bodyR * 0.55, 0.03, 16]} />
        <meshStandardMaterial color="#3A1810" roughness={0.85} />
      </mesh>
      {/* Hanging rope up to the wall */}
      <mesh position={[0, h * 0.92 - h / 2, 0]}>
        <cylinderGeometry args={[0.006, 0.006, h * 0.16, 6]} />
        <meshStandardMaterial color="#8A6020" roughness={0.9} />
      </mesh>
      {/* Small tassel hanging below */}
      <mesh position={[0, bodyCY - bodyH / 2 - 0.06 - h / 2, 0]}>
        <coneGeometry args={[0.015, 0.06, 8]} />
        <meshStandardMaterial color="#D4A030" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Inner glow — point light so the lantern actually illuminates
          nearby wall surface. Low intensity so it doesn't blow out. */}
      <pointLight
        position={[0, bodyCY - h / 2, 0.04]}
        intensity={0.8} color="#FFAA60"
        distance={1.2} decay={2}
      />
    </group>
  );
}

// ─── Modern wall-sconce lamp (外墙壁灯) ────────────────────────
// Metal wall bracket + downward-facing cylindrical shade + small emissive
// bulb inside.
function ModernWallLamp({ w, h, d }: { w: number; h: number; d: number }) {
  return (
    <group position={[0, 0, 0]}>
      {/* Wall bracket plate */}
      <mesh position={[0, 0, d * 0.15]} castShadow>
        <boxGeometry args={[w * 0.4, h * 0.3, d * 0.3]} />
        <meshStandardMaterial color="#2A2A2A" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* Arm extending out */}
      <mesh position={[0, -h * 0.1, d * 0.45]}>
        <cylinderGeometry args={[0.012, 0.012, d * 0.6, 8]} />
        <meshStandardMaterial color="#2A2A2A" metalness={0.7} roughness={0.35} />
      </mesh>
      {/* Lamp shade (downward cylinder) */}
      <mesh position={[0, -h * 0.35, d * 0.7]}>
        <cylinderGeometry args={[w * 0.35, w * 0.42, h * 0.28, 14]} />
        <meshStandardMaterial color="#333" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Emissive bulb inside */}
      <mesh position={[0, -h * 0.48, d * 0.7]}>
        <sphereGeometry args={[w * 0.18, 10, 10]} />
        <meshStandardMaterial
          color="#FFE8B0" emissive="#FFE8B0"
          emissiveIntensity={1.4} roughness={0.1}
        />
      </mesh>
      {/* Subtle point light */}
      <pointLight
        position={[0, -h * 0.55, d * 0.75]}
        intensity={0.6} color="#FFE0A0"
        distance={0.8} decay={2}
      />
    </group>
  );
}

// ─── LED light strip (灯带) ──────────────────────────────────────
// Row of small emissive cubes along the length — gives visible segment
// look instead of a single uniform bar. Includes diffuse glow.
function LightStrip({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  const segments = Math.max(12, Math.floor(w / 0.05)); // 1 every ~5cm
  const segW = w / segments * 0.85;
  return (
    <group position={[0, 0, d / 2]}>
      {/* Aluminum channel housing */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[w, h, Math.max(0.01, d * 0.4)]} />
        <meshStandardMaterial color="#CFCFCF" metalness={0.55} roughness={0.45} />
      </mesh>
      {/* Individual LED segments along the strip */}
      {Array.from({ length: segments }).map((_, i) => {
        const x = -w / 2 + (i + 0.5) * (w / segments);
        return (
          <mesh key={i} position={[x, 0, d * 0.3]}>
            <boxGeometry args={[segW, h * 0.6, 0.005]} />
            <meshStandardMaterial
              color={color} emissive={color}
              emissiveIntensity={1.8} roughness={0.2}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Mailbox (现代信箱) ────────────────────────────────────────
// Box body + front door with handle + letter slot + red flag.
function Mailbox({ w, h, d }: { w: number; h: number; d: number }) {
  const bodyColor = "#4A4A4A";
  const accent = "#D0D0D0";
  return (
    <group position={[0, 0, d / 2]}>
      {/* Box body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[w * 0.98, h * 0.98, d]} />
        <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Front door (slightly recessed) */}
      <mesh position={[0, 0, d / 2 + 0.001]}>
        <boxGeometry args={[w * 0.88, h * 0.8, 0.006]} />
        <meshStandardMaterial color={bodyColor} metalness={0.35} roughness={0.55} />
      </mesh>
      {/* Letter slot (dark rectangle) */}
      <mesh position={[0, h * 0.15, d / 2 + 0.005]}>
        <boxGeometry args={[w * 0.5, h * 0.04, 0.002]} />
        <meshStandardMaterial color="#111" roughness={0.9} />
      </mesh>
      {/* Slot cover (horizontal accent bar) */}
      <mesh position={[0, h * 0.15 + h * 0.03, d / 2 + 0.006]}>
        <boxGeometry args={[w * 0.55, h * 0.015, 0.003]} />
        <meshStandardMaterial color={accent} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Handle (small protruding box) */}
      <mesh position={[0, -h * 0.2, d / 2 + 0.012]}>
        <boxGeometry args={[w * 0.2, h * 0.04, 0.018]} />
        <meshStandardMaterial color={accent} metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Red flag on side */}
      <mesh position={[w / 2 - 0.005, h * 0.1, d / 2 - d * 0.3]}>
        <boxGeometry args={[0.008, h * 0.35, 0.006]} />
        <meshStandardMaterial color="#C82020" roughness={0.5} />
      </mesh>
      <mesh position={[w / 2 + 0.015, h * 0.25, d / 2 - d * 0.3]}>
        <boxGeometry args={[0.025, h * 0.1, 0.002]} />
        <meshStandardMaterial color="#C82020" roughness={0.5} />
      </mesh>
    </group>
  );
}

// ─── AC condenser (空调外机) ───────────────────────────────────
// White box with horizontal grille slats on the front + mounting brackets.
function AcCondenser({ w, h, d }: { w: number; h: number; d: number }) {
  const slatCount = Math.max(6, Math.floor(h / 0.05));
  const slatSpacing = h * 0.8 / slatCount;
  return (
    <group position={[0, 0, d / 2]}>
      {/* Main body */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#E8E8E8" roughness={0.55} metalness={0.1} />
      </mesh>
      {/* Side panels (slightly darker accent) */}
      <mesh position={[-w / 2 + 0.002, 0, 0]}>
        <boxGeometry args={[0.005, h * 0.95, d * 0.95]} />
        <meshStandardMaterial color="#C8C8C8" roughness={0.6} metalness={0.15} />
      </mesh>
      <mesh position={[w / 2 - 0.002, 0, 0]}>
        <boxGeometry args={[0.005, h * 0.95, d * 0.95]} />
        <meshStandardMaterial color="#C8C8C8" roughness={0.6} metalness={0.15} />
      </mesh>
      {/* Horizontal grille slats on front */}
      {Array.from({ length: slatCount }).map((_, i) => {
        const y = -h * 0.4 + (i + 0.5) * slatSpacing;
        return (
          <mesh key={i} position={[0, y, d / 2 + 0.004]}>
            <boxGeometry args={[w * 0.85, slatSpacing * 0.55, 0.008]} />
            <meshStandardMaterial color="#D0D0D0" roughness={0.5} metalness={0.2} />
          </mesh>
        );
      })}
      {/* Dark inset around grille (suggests fan shroud) */}
      <mesh position={[0, 0, d / 2 + 0.0015]}>
        <boxGeometry args={[w * 0.88, h * 0.85, 0.002]} />
        <meshStandardMaterial color="#3A3A3A" roughness={0.9} />
      </mesh>
      {/* Logo plate (small) */}
      <mesh position={[w * 0.32, -h * 0.42, d / 2 + 0.006]}>
        <boxGeometry args={[w * 0.1, h * 0.04, 0.002]} />
        <meshStandardMaterial color="#2A2A2A" roughness={0.5} />
      </mesh>
      {/* Mounting brackets under the unit */}
      <mesh position={[-w / 3, -h / 2 - 0.008, 0]}>
        <boxGeometry args={[w * 0.08, 0.015, d * 0.6]} />
        <meshStandardMaterial color="#666" metalness={0.7} roughness={0.45} />
      </mesh>
      <mesh position={[w / 3, -h / 2 - 0.008, 0]}>
        <boxGeometry args={[w * 0.08, 0.015, d * 0.6]} />
        <meshStandardMaterial color="#666" metalness={0.7} roughness={0.45} />
      </mesh>
    </group>
  );
}

// ─── Climbing vine (爬藤) ──────────────────────────────────────
// Instanced leaves scattered across the vine area with subtle wind sway.
// Each leaf is a double-sided plane with an alpha-tested leaf shape.
function ClimbingVine({ w, h, d }: { w: number; h: number; d: number }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.z = Math.sin(performance.now() / 1800) * 0.015;
  });
  // Generate leaf positions with pseudo-random offsets (deterministic via seed)
  const leaves: Array<{ x: number; y: number; z: number; rot: number; scale: number; col: string }> = [];
  const density = Math.max(30, Math.floor((w * h) * 120));
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < density; i++) {
    leaves.push({
      x: (rand() - 0.5) * w * 0.95,
      y: (rand() - 0.5) * h * 0.95,
      z: rand() * d * 0.5 + 0.005,
      rot: (rand() - 0.5) * Math.PI * 0.6,
      scale: 0.7 + rand() * 0.6,
      col: rand() > 0.5 ? "#2D5A2A" : "#3A7030",
    });
  }
  const leafW = Math.max(0.06, Math.min(w, h) * 0.09);
  return (
    <group ref={groupRef} position={[0, h / 2, 0]}>
      {/* Backing wall tint for gaps between leaves */}
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#3A2818" roughness={0.95} opacity={0.3} transparent />
      </mesh>
      {/* Leaves */}
      {leaves.map((l, i) => (
        <mesh
          key={i}
          position={[l.x, l.y, l.z]}
          rotation={[0, 0, l.rot]}
          scale={[l.scale, l.scale, 1]}
        >
          <planeGeometry args={[leafW, leafW * 1.4]} />
          <meshStandardMaterial
            color={l.col}
            side={THREE.DoubleSide}
            roughness={0.85}
            transparent
            alphaTest={0.4}
          />
        </mesh>
      ))}
      {/* Main vine stems (3 zigzag lines) */}
      {[-w * 0.35, 0, w * 0.35].map((sx, si) => (
        <group key={si}>
          {Array.from({ length: 8 }).map((_, j) => {
            const y0 = -h / 2 + (j / 8) * h;
            const y1 = -h / 2 + ((j + 1) / 8) * h;
            const x0 = sx + Math.sin(j * 1.3) * 0.03;
            const x1 = sx + Math.sin((j + 1) * 1.3) * 0.03;
            const midX = (x0 + x1) / 2;
            const midY = (y0 + y1) / 2;
            const len = Math.hypot(x1 - x0, y1 - y0);
            const angle = Math.atan2(y1 - y0, x1 - x0);
            return (
              <mesh key={j} position={[midX, midY, 0.003]} rotation={[0, 0, angle - Math.PI / 2]}>
                <cylinderGeometry args={[0.004, 0.004, len, 4]} />
                <meshStandardMaterial color="#4A3020" roughness={0.9} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

// ─── Decorative border (回形饰带 / 花饰带) ────────────────────
// Extruded strip with relief — a long base with raised rectangular
// segments forming the pattern. Much more 3D than a flat canvas texture.
function BorderStrip({
  w, h, d, base, accent, pattern,
}: {
  w: number; h: number; d: number;
  base: string; accent: string;
  pattern: "meander" | "floral";
}) {
  const reps = Math.max(6, Math.floor(w / 0.1));
  return (
    <group position={[0, 0, d / 2]}>
      {/* Base moulding */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[w, h, Math.max(0.015, d * 1.3)]} />
        <meshStandardMaterial color={base} roughness={0.75} />
      </mesh>
      {/* Top + bottom thin lines in accent */}
      <mesh position={[0, h * 0.42, d / 2 + 0.005]}>
        <boxGeometry args={[w * 0.99, h * 0.05, 0.003]} />
        <meshStandardMaterial color={accent} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, -h * 0.42, d / 2 + 0.005]}>
        <boxGeometry args={[w * 0.99, h * 0.05, 0.003]} />
        <meshStandardMaterial color={accent} metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Repeat pattern blocks */}
      {Array.from({ length: reps }).map((_, i) => {
        const x = -w / 2 + (i + 0.5) * (w / reps);
        const unitW = (w / reps) * 0.8;
        if (pattern === "meander") {
          // Greek-key: interlocking L-shapes. Approximate with 3 small cubes.
          return (
            <group key={i} position={[x, 0, d / 2 + 0.006]}>
              <mesh position={[-unitW * 0.25, h * 0.1, 0]}>
                <boxGeometry args={[unitW * 0.6, h * 0.18, 0.005]} />
                <meshStandardMaterial color={accent} metalness={0.4} roughness={0.45} />
              </mesh>
              <mesh position={[unitW * 0.15, -h * 0.1, 0]}>
                <boxGeometry args={[unitW * 0.3, h * 0.18, 0.005]} />
                <meshStandardMaterial color={accent} metalness={0.4} roughness={0.45} />
              </mesh>
            </group>
          );
        } else {
          // Floral: a sphere (flower head) + small curves (petals)
          return (
            <group key={i} position={[x, 0, d / 2 + 0.006]}>
              <mesh>
                <sphereGeometry args={[h * 0.28, 10, 8]} />
                <meshStandardMaterial color={accent} roughness={0.55} />
              </mesh>
              <mesh position={[0, 0, 0.002]}>
                <sphereGeometry args={[h * 0.14, 8, 6]} />
                <meshStandardMaterial color="#8A4A18" roughness={0.6} />
              </mesh>
            </group>
          );
        }
      })}
    </group>
  );
}

// ─── Metal plate with raised text (门牌号 / 姓氏门牌) ──────────
// Brushed/brass plate base + extruded 3D text on top. Fallback uses canvas
// texture for the text (browsers rasterize CJK on canvas reliably).
function MetalPlate({
  w, h, d, text, textColor, plateColors,
}: {
  w: number; h: number; d: number;
  text: string;
  textColor: string;
  plateColors: [string, string, string];
}) {
  // Canvas text texture — used on the plate's front face so digits/CJK
  // render crisply. 3D extruded text would need drei <Text3D> + font
  // loading; the texture approach is lighter and visually similar.
  const tex = useCanvasTextTexture(text, plateColors, textColor);
  return (
    <group position={[0, 0, d / 2]}>
      {/* Plate body (with depth — feels mounted rather than pasted) */}
      <mesh castShadow>
        <boxGeometry args={[w, h, Math.max(0.01, d)]} />
        <meshStandardMaterial color={plateColors[1]} metalness={0.65} roughness={0.35} />
      </mesh>
      {/* Rim (inset line around the face) */}
      <mesh position={[0, 0, d / 2 + 0.001]}>
        <boxGeometry args={[w * 0.99, h * 0.99, 0.002]} />
        <meshStandardMaterial color={plateColors[0]} metalness={0.55} roughness={0.4} />
      </mesh>
      {/* Front face with text */}
      {tex && (
        <mesh position={[0, 0, d / 2 + 0.003]}>
          <planeGeometry args={[w * 0.95, h * 0.92]} />
          <meshBasicMaterial map={tex} transparent toneMapped />
        </mesh>
      )}
    </group>
  );
}

function useCanvasTextTexture(
  text: string, plateColors: [string, string, string], textColor: string,
): THREE.Texture | null {
  const cached = useRef<THREE.CanvasTexture | null>(null);
  if (cached.current) return cached.current;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 800; c.height = 320;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, plateColors[0]);
  grad.addColorStop(0.5, plateColors[1]);
  grad.addColorStop(1, plateColors[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#484A4C";
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, c.width - 24, c.height - 24);
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fs = text.length <= 3 ? c.height * 0.72 : c.height * 0.54;
  ctx.font = `bold ${fs}px "Arial Black", "Heiti SC", "Microsoft YaHei", sans-serif`;
  ctx.fillText(text, c.width / 2, c.height / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cached.current = tex;
  return tex;
}
