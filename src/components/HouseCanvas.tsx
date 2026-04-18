"use client";

import { useRef, useMemo, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, ExteriorSettings } from "@/lib/types";

// ─── Constants ─────────────────────────────────────────────
const FLOOR_H = 2.8;
const WT      = 0.24;
const OV      = 0.55;

// ─── Footprint ─────────────────────────────────────────────
function useFootprint() {
  const enabledRooms   = useDesignerStore(s => s.enabledRooms);
  const roomLayout     = useDesignerStore(s => s.roomLayout);
  const roomDimensions = useDesignerStore(s => s.roomDimensions);
  const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
  if (!indoor.length) return { W: 8, D: 6 };
  const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
  const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
  return {
    W: Math.max(4, (Math.max(...xs) - Math.min(...xs)) / 100),
    D: Math.max(3, (Math.max(...zs) - Math.min(...zs)) / 100),
  };
}

// ─── Camera ────────────────────────────────────────────────
function CameraRig({ W, D, floors }: { W: number; D: number; floors: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const h    = floors * FLOOR_H;
    const dist = (Math.max(W, D) + h) * 1.55;
    camera.position.set(dist * 0.85, dist * 0.55, dist * 0.95);
    camera.lookAt(0, h * 0.35, 0);
  }, [W, D, floors]);
  return null;
}

// ─── Roof styles ────────────────────────────────────────────

function FlatRoof({ W, D, color }: { W: number; D: number; color: string }) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[W + OV * 2, 0.22, D + OV * 2]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {[
        { pos: [0, 0.28, -(D / 2 + OV)], args: [W + OV * 2 + WT, 0.35, WT] as [number,number,number] },
        { pos: [0, 0.28,  (D / 2 + OV)], args: [W + OV * 2 + WT, 0.35, WT] as [number,number,number] },
        { pos: [-(W / 2 + OV), 0.28, 0], args: [WT, 0.35, D + OV * 2] as [number,number,number] },
        { pos: [ (W / 2 + OV), 0.28, 0], args: [WT, 0.35, D + OV * 2] as [number,number,number] },
      ].map((p, i) => (
        <mesh key={i} position={p.pos as [number,number,number]} castShadow>
          <boxGeometry args={p.args} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function GableRoof({ W, D, color }: { W: number; D: number; color: string }) {
  const H = D * 0.38;
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-(W / 2 + OV), 0);
    shape.lineTo(W / 2 + OV, 0);
    shape.lineTo(0, H);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: D + OV * 2, bevelEnabled: false });
    g.translate(0, 0, -(D / 2 + OV));
    return g;
  }, [W, D]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

function HipRoof({ W, D, color, upturn = 0 }: { W: number; D: number; color: string; upturn?: number }) {
  const H = D * 0.38;
  const geo = useMemo(() => {
    const ov = OV, w2 = W / 2 + ov, d2 = D / 2 + ov;
    const rLen = Math.max(0.3, (W - D) / 2);
    const pos = new Float32Array([
      -w2, upturn, -d2,  w2, upturn, -d2,
       w2, upturn,  d2, -w2, upturn,  d2,
      -rLen, H, 0,  rLen, H, 0,
    ]);
    const idx = [0,5,1, 0,4,5, 3,5,4, 3,2,5, 0,3,4, 1,5,2];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [W, D, upturn]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={color} roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

function MansardRoof({ W, D, color }: { W: number; D: number; color: string }) {
  const lowerH = D * 0.22;
  const shrink = 0.7;
  const iW = W * shrink, iD = D * shrink;
  const lGeo = useMemo(() => {
    const ov = OV, iOv = -OV * 0.3;
    const outer = [[-(W/2+ov),0,-(D/2+ov)],[W/2+ov,0,-(D/2+ov)],[W/2+ov,0,D/2+ov],[-(W/2+ov),0,D/2+ov]];
    const inner = [[-(iW/2+iOv),lowerH,-(iD/2+iOv)],[iW/2+iOv,lowerH,-(iD/2+iOv)],[iW/2+iOv,lowerH,iD/2+iOv],[-(iW/2+iOv),lowerH,iD/2+iOv]];
    const verts: number[] = [...outer.flat(), ...inner.flat()];
    const idx = [0,4,5, 0,5,1, 2,6,7, 2,7,3, 3,7,4, 3,4,0, 1,5,6, 1,6,2];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [W, D]);
  return (
    <group>
      <mesh geometry={lGeo} castShadow>
        <meshStandardMaterial color={color} roughness={0.88} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, lowerH, 0]} castShadow>
        <boxGeometry args={[iW + OV, 0.18, iD + OV]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
    </group>
  );
}

function ChineseRoof({ W, D, color }: { W: number; D: number; color: string }) {
  return (
    <group>
      <HipRoof W={W} D={D} color={color} upturn={0.55} />
      <mesh position={[0, D * 0.38 + 0.08, 0]} castShadow>
        <boxGeometry args={[Math.max(0.4, W - D), 0.18, 0.28]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz],i) => (
        <mesh key={i} position={[sx * (W/2 + OV * 0.7), 0.55 + 0.15, sz * (D/2 + OV * 0.7)]}
          rotation={[0, Math.atan2(sz, sx), Math.PI / 6]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.15]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function RoofSwitch({ W, D, roofStyle, roofColor }: { W: number; D: number; roofStyle: string; roofColor: string }) {
  switch (roofStyle) {
    case "gable":   return <GableRoof   W={W} D={D} color={roofColor} />;
    case "hip":     return <HipRoof     W={W} D={D} color={roofColor} />;
    case "mansard": return <MansardRoof W={W} D={D} color={roofColor} />;
    case "chinese": return <ChineseRoof W={W} D={D} color={roofColor} />;
    default:        return <FlatRoof    W={W} D={D} color={roofColor} />;
  }
}

// ─── Wall face ──────────────────────────────────────────────
function WallFace({ width, height, color, accentColor, hasDoor = false, winCount }: {
  width: number; height: number; color: string; accentColor: string;
  hasDoor?: boolean; winCount: number;
}) {
  const winW = 1.05, winH = 1.25, winY = height * 0.58;
  const doorW = 1.0, doorH = 2.15;
  const halfW = width / 2;
  const slots = winCount + (hasDoor ? 1 : 0);
  const spacing = width / (slots + 1);
  const windowXs: number[] = [];
  let doorX = 0;
  for (let i = 0; i < slots; i++) {
    const x = -halfW + spacing * (i + 1);
    if (hasDoor && i === Math.floor(slots / 2)) { doorX = x; }
    else { windowXs.push(x); }
  }
  return (
    <group>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[width, height, WT]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {windowXs.map((x, i) => (
        <group key={i} position={[x, winY - height / 2, WT / 2 + 0.01]}>
          <mesh><boxGeometry args={[winW + 0.12, winH + 0.12, 0.06]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.04]}><boxGeometry args={[winW, winH, 0.04]} /><meshStandardMaterial color="#A8CDE8" transparent opacity={0.65} roughness={0.05} metalness={0.15} /></mesh>
          <mesh position={[0, 0, 0.05]}><boxGeometry args={[winW + 0.04, 0.04, 0.03]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.05]}><boxGeometry args={[0.04, winH + 0.04, 0.03]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
        </group>
      ))}
      {hasDoor && (
        <group position={[doorX, doorH / 2 - height / 2, WT / 2 + 0.01]}>
          <mesh><boxGeometry args={[doorW + 0.14, doorH + 0.1, 0.06]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.04]}><boxGeometry args={[doorW, doorH, 0.04]} /><meshStandardMaterial color={accentColor} roughness={0.6} /></mesh>
          <mesh position={[doorW * 0.3, -0.1, 0.08]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#C8B060" roughness={0.2} metalness={0.8} /></mesh>
        </group>
      )}
    </group>
  );
}

// ─── Floor shell ────────────────────────────────────────────
function FloorShell({ floorIndex, W, D, settings, totalFloors }: {
  floorIndex: number; W: number; D: number; settings: ExteriorSettings; totalFloors: number;
}) {
  const { wallColor, accentColor } = settings;
  const H = FLOOR_H;
  const isGround = floorIndex === 0;
  const winCountFront = Math.max(1, Math.floor(W / 2.6) - (isGround ? 1 : 0));
  const winCountSide  = Math.max(1, Math.floor(D / 2.6));
  return (
    <group position={[0, floorIndex * H, 0]}>
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[W, 0.18, D]} />
        <meshStandardMaterial color="#D0CABB" roughness={0.95} />
      </mesh>
      <group position={[0, H / 2, -(D / 2 - WT / 2)]}>
        <WallFace width={W} height={H} color={wallColor} accentColor={accentColor} hasDoor={isGround} winCount={winCountFront} />
      </group>
      <group position={[0, H / 2, D / 2 - WT / 2]} rotation={[0, Math.PI, 0]}>
        <WallFace width={W} height={H} color={wallColor} accentColor={accentColor} winCount={winCountFront} />
      </group>
      <group position={[-(W / 2 - WT / 2), H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={wallColor} accentColor={accentColor} winCount={winCountSide} />
      </group>
      <group position={[W / 2 - WT / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={wallColor} accentColor={accentColor} winCount={winCountSide} />
      </group>
      {floorIndex < totalFloors - 1 && (
        <mesh position={[0, H, 0]}>
          <boxGeometry args={[W, 0.18, D]} />
          <meshStandardMaterial color="#C8C0B0" roughness={0.95} />
        </mesh>
      )}
      {floorIndex > 0 && (
        <mesh position={[0, 0.09, 0]}>
          <boxGeometry args={[W + 0.04, 0.22, D + 0.04]} />
          <meshStandardMaterial color={accentColor} roughness={0.8} />
        </mesh>
      )}
    </group>
  );
}

// ─── Foundation ─────────────────────────────────────────────
function Foundation({ W, D, color }: { W: number; D: number; color: string }) {
  return (
    <mesh position={[0, -0.25, 0]} receiveShadow>
      <boxGeometry args={[W + 0.3, 0.5, D + 0.3]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

// ─── Tree variations ─────────────────────────────────────────
function Tree({ x, z, type = "round", scale = 1 }: { x: number; z: number; type?: "round" | "pine" | "palm"; scale?: number }) {
  const s = scale;
  if (type === "pine") {
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.15, 1.4, 7]} />
          <meshStandardMaterial color="#5A3A1A" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.8, 0]} castShadow>
          <coneGeometry args={[1.0, 2.2, 8]} />
          <meshStandardMaterial color="#1A5030" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.1, 0]} castShadow>
          <coneGeometry args={[1.3, 1.6, 8]} />
          <meshStandardMaterial color="#1E6038" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <coneGeometry args={[1.5, 1.2, 8]} />
          <meshStandardMaterial color="#227040" roughness={0.9} />
        </mesh>
      </group>
    );
  }
  if (type === "palm") {
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.18, 3.0, 7]} />
          <meshStandardMaterial color="#8B6A30" roughness={0.9} />
        </mesh>
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <mesh key={i} position={[Math.cos(rad) * 0.8, 3.3, Math.sin(rad) * 0.8]}
              rotation={[0.4, rad, 0]} castShadow>
              <boxGeometry args={[1.8, 0.05, 0.35]} />
              <meshStandardMaterial color="#3A8040" roughness={0.9} />
            </mesh>
          );
        })}
      </group>
    );
  }
  // default round
  return (
    <group position={[x, 0, z]} scale={[s, s, s]}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.6, 7]} />
        <meshStandardMaterial color="#6B4A28" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.5, 0]} castShadow>
        <sphereGeometry args={[1.0, 8, 7]} />
        <meshStandardMaterial color="#2E7020" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── Hedge / bush ────────────────────────────────────────────
function Bush({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <sphereGeometry args={[0.55, 7, 6]} />
        <meshStandardMaterial color="#3A8030" roughness={0.95} />
      </mesh>
      <mesh position={[0.4, 0.35, 0.2]} castShadow>
        <sphereGeometry args={[0.4, 7, 6]} />
        <meshStandardMaterial color="#3E8838" roughness={0.95} />
      </mesh>
    </group>
  );
}

// ─── Flower bed ───────────────────────────────────────────────
function FlowerBed({ x, z, w = 2, d = 0.8 }: { x: number; z: number; w?: number; d?: number }) {
  const flowers = useMemo(() => {
    const pts: { fx: number; fz: number; color: string }[] = [];
    const colors = ["#FF6090", "#FFD030", "#FF8030", "#CC60FF", "#FF4060"];
    for (let i = 0; i < 10; i++) {
      pts.push({
        fx: x + (Math.random() - 0.5) * w,
        fz: z + (Math.random() - 0.5) * d,
        color: colors[i % colors.length],
      });
    }
    return pts;
  }, [x, z, w, d]);
  return (
    <group>
      {/* Soil */}
      <mesh position={[x, -0.48, z]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.2, d + 0.2]} />
        <meshStandardMaterial color="#6B4A28" roughness={0.99} />
      </mesh>
      {flowers.map((f, i) => (
        <group key={i} position={[f.fx, 0, f.fz]}>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.45, 5]} />
            <meshStandardMaterial color="#50A050" />
          </mesh>
          <mesh position={[0, 0.45, 0]}>
            <sphereGeometry args={[0.1, 6, 5]} />
            <meshStandardMaterial color={f.color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Garden path ─────────────────────────────────────────────
function GardenPath({ W, D }: { W: number; D: number }) {
  return (
    <group>
      {/* Front path to door */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.499, -(D / 2 + 3.0)]} receiveShadow>
        <planeGeometry args={[1.4, 6.5]} />
        <meshStandardMaterial color="#C8BEA8" roughness={0.9} />
      </mesh>
      {/* Stepping stones */}
      {[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((offset, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}
          position={[
            (i % 2 === 0 ? -0.3 : 0.3),
            -0.498,
            -(D / 2 + 0.8 + i * 0.9),
          ]} receiveShadow>
          <circleGeometry args={[0.28, 7]} />
          <meshStandardMaterial color="#A8A090" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Swimming pool ───────────────────────────────────────────
function AnimatedWater({ w, d }: { w: number; d: number }) {
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame((_, dt) => {
    if (matRef.current) {
      // subtle shimmer: oscillate emissiveIntensity
      matRef.current.emissiveIntensity = 0.08 + 0.06 * Math.sin(Date.now() * 0.002);
    }
  });
  return (
    <mesh position={[0, -0.22, 0]} receiveShadow>
      <boxGeometry args={[w, 0.22, d]} />
      <meshPhysicalMaterial
        ref={matRef}
        color="#18A8D8"
        emissive="#006090"
        emissiveIntensity={0.08}
        transparent
        opacity={0.90}
        roughness={0.02}
        metalness={0.0}
        envMapIntensity={2.5}
        transmission={0.08}
      />
    </mesh>
  );
}

function Pool({ x, z, w = 5, d = 3 }: { x: number; z: number; w?: number; d?: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Pool shell */}
      <mesh position={[0, -0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.6, 0.7, d + 0.6]} />
        <meshStandardMaterial color="#D8D0C0" roughness={0.8} />
      </mesh>
      {/* Pool interior (slightly inset) */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[w - 0.02, 0.6, d - 0.02]} />
        <meshStandardMaterial color="#A8D8E8" roughness={0.3} />
      </mesh>
      {/* Animated water surface */}
      <AnimatedWater w={w - 0.1} d={d - 0.1} />
      {/* Coping tiles (rim) */}
      {[
        { pos: [0, 0.01, -(d / 2 + 0.25)] as [number,number,number], args: [w + 0.6, 0.08, 0.5] as [number,number,number] },
        { pos: [0, 0.01,  (d / 2 + 0.25)] as [number,number,number], args: [w + 0.6, 0.08, 0.5] as [number,number,number] },
        { pos: [-(w / 2 + 0.25), 0.01, 0] as [number,number,number], args: [0.5, 0.08, d] as [number,number,number] },
        { pos: [ (w / 2 + 0.25), 0.01, 0] as [number,number,number], args: [0.5, 0.08, d] as [number,number,number] },
      ].map((t, i) => (
        <mesh key={i} position={t.pos} receiveShadow>
          <boxGeometry args={t.args} />
          <meshStandardMaterial color="#F0EAD8" roughness={0.6} metalness={0.05} />
        </mesh>
      ))}
      {/* Lane lines */}
      {[-d / 4, 0, d / 4].map((lz, i) => (
        <mesh key={i} position={[0, -0.19, lz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w - 0.4, 0.1]} />
          <meshStandardMaterial color="#FFFFFF" transparent opacity={0.35} />
        </mesh>
      ))}
      {/* Poolside loungers */}
      {[-d / 2 - 0.7, d / 2 + 0.7].map((lz, i) => (
        <mesh key={i} position={[w / 2 + 1.2, -0.38, lz]} castShadow>
          <boxGeometry args={[1.9, 0.12, 0.65]} />
          <meshStandardMaterial color="#F5EDD8" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Gazebo ─────────────────────────────────────────────────
function Gazebo({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Floor */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[3.5, 0.12, 3.5]} />
        <meshStandardMaterial color="#C8A870" roughness={0.9} />
      </mesh>
      {/* Posts */}
      {[[-1.4, -1.4],[1.4,-1.4],[1.4,1.4],[-1.4,1.4]].map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.2, pz]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 2.4, 7]} />
          <meshStandardMaterial color="#B08040" roughness={0.85} />
        </mesh>
      ))}
      {/* Roof */}
      <mesh position={[0, 2.6, 0]} castShadow>
        <coneGeometry args={[2.4, 1.0, 8]} />
        <meshStandardMaterial color="#8B4020" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── Fountain ────────────────────────────────────────────────
function Fountain({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Basin */}
      <mesh position={[0, 0.0, 0]} receiveShadow>
        <cylinderGeometry args={[1.2, 1.3, 0.4, 16]} />
        <meshStandardMaterial color="#D8D0C0" roughness={0.9} />
      </mesh>
      {/* Water */}
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[1.0, 1.0, 0.08, 16]} />
        <meshStandardMaterial color="#60B8E0" transparent opacity={0.8} roughness={0.05} />
      </mesh>
      {/* Center pillar */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.14, 0.8, 10]} />
        <meshStandardMaterial color="#C0B890" roughness={0.85} />
      </mesh>
      {/* Top spray */}
      <mesh position={[0, 1.05, 0]}>
        <sphereGeometry args={[0.18, 8, 7]} />
        <meshStandardMaterial color="#A0DAEE" transparent opacity={0.75} roughness={0.1} />
      </mesh>
    </group>
  );
}

// ─── Lawn area ────────────────────────────────────────────────
function Lawn({ x, z, w = 6, d = 5 }: { x: number; z: number; w?: number; d?: number }) {
  return (
    <mesh position={[x, -0.495, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color="#5CBF40" roughness={0.98} />
    </mesh>
  );
}

// ─── Car ──────────────────────────────────────────────────
function Car({ x, z, color = "#2255AA" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Main body */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[1.85, 0.62, 4.3]} />
        <meshStandardMaterial color={color} metalness={0.55} roughness={0.38} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 0.82, 0.18]} castShadow>
        <boxGeometry args={[1.65, 0.52, 2.1]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.45} />
      </mesh>
      {/* Windshield (dark glass) */}
      <mesh position={[0, 0.82, -0.9]}>
        <boxGeometry args={[1.55, 0.44, 0.06]} />
        <meshStandardMaterial color="#111122" metalness={0.1} roughness={0.05} transparent opacity={0.85} />
      </mesh>
      {/* Wheels */}
      {([ [-0.88,-1.45], [0.88,-1.45], [-0.88,1.45], [0.88,1.45] ] as [number,number][]).map(([wx,wz],i) => (
        <mesh key={i} position={[wx, 0.2, wz]} rotation={[0,0,Math.PI/2]} castShadow>
          <cylinderGeometry args={[0.34, 0.34, 0.24, 14]} />
          <meshStandardMaterial color="#1A1A1A" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Driveway + Parking ───────────────────────────────────────
function DrivewayAndParking({ W, D }: { W: number; D: number }) {
  const driveW = 5.5;
  const driveLen = 9.0;
  const parkW = 6.5;
  const parkD = 5.8;
  const zFront = D / 2; // front of house

  return (
    <group>
      {/* Driveway slab */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.492, zFront + driveLen / 2]} receiveShadow>
        <planeGeometry args={[driveW, driveLen]} />
        <meshStandardMaterial color="#787878" roughness={0.92} />
      </mesh>
      {/* Center dashed line */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI/2, 0, 0]}
          position={[0, -0.490, zFront + 1.2 + i * 1.6]}>
          <planeGeometry args={[0.1, 0.8]} />
          <meshStandardMaterial color="#DDDDDD" opacity={0.55} transparent />
        </mesh>
      ))}
      {/* Parking area slab */}
      <mesh rotation={[-Math.PI/2, 0, 0]}
        position={[0, -0.491, zFront + driveLen + parkD / 2]} receiveShadow>
        <planeGeometry args={[parkW, parkD]} />
        <meshStandardMaterial color="#696969" roughness={0.95} />
      </mesh>
      {/* Parking spot lines (3 spots) */}
      {[-parkW/2, -parkW/6, parkW/6, parkW/2].map((lx, i) => (
        <mesh key={i} rotation={[-Math.PI/2, 0, 0]}
          position={[lx, -0.489, zFront + driveLen + parkD / 2]}>
          <planeGeometry args={[0.08, parkD]} />
          <meshStandardMaterial color="white" opacity={0.65} transparent />
        </mesh>
      ))}
      {/* Front/back boundary lines */}
      {[0, parkD].map((dz, i) => (
        <mesh key={i} rotation={[-Math.PI/2, 0, 0]}
          position={[0, -0.489, zFront + driveLen + dz]}>
          <planeGeometry args={[parkW, 0.08]} />
          <meshStandardMaterial color="white" opacity={0.65} transparent />
        </mesh>
      ))}
      {/* 2 parked cars */}
      <Car x={-parkW/6 + (parkW/6)/2} z={zFront + driveLen + parkD/2} color="#3366BB" />
      <Car x={ parkW/6 + (parkW/6)/2} z={zFront + driveLen + parkD/2} color="#AA3322" />
    </group>
  );
}

// ─── Yard presets ─────────────────────────────────────────────
function YardElements({ W, D, yardPreset, parking = false }: {
  W: number; D: number; yardPreset: string; parking?: boolean
}) {
  const xOff = W / 2 + 4.5;  // right side
  const zOff = -(D / 2 + 5); // front

  if (yardPreset === "minimal") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={-(W / 2 + 3.5)} z={  D / 2 + 1.8}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 1.8}  scale={0.9} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={W / 2 + 1.5} z={-(D / 2 - 0.5)} w={2} d={0.8} />
        {parking && <DrivewayAndParking W={W} D={D} />}
      </>
    );
  }

  if (yardPreset === "garden") {
    return (
      <>
        {/* Corner trees */}
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.2} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.0} type="pine" />
        <Tree x={-(W / 2 + 3.0)} z={  D / 2 + 2.0}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 2.0}  scale={1.1} type="pine" />
        <Tree x={0}               z={  D / 2 + 5.0}  scale={1.3} />
        {/* Hedges along sides */}
        {[-D/4, 0, D/4].map((z, i) => (
          <Bush key={i} x={-(W / 2 + 1.2)} z={z} scale={0.9} />
        ))}
        {/* Flower beds */}
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={4} d={1.0} />
        {/* Lawn */}
        <Lawn x={0} z={D / 2 + 5} w={W + 4} d={4} />
        <GardenPath W={W} D={D} />
        <Fountain x={0} z={-(D / 2 + 6.5)} />
        {parking && <DrivewayAndParking W={W} D={D} />}
      </>
    );
  }

  if (yardPreset === "pool") {
    return (
      <>
        <Pool x={xOff} z={0} w={5} d={3} />
        {/* Poolside loungers (as simple boxes) */}
        {[-0.8, 0.8].map((lz, i) => (
          <mesh key={i} position={[xOff + 3.5, -0.35, lz]} castShadow>
            <boxGeometry args={[1.8, 0.15, 0.6]} />
            <meshStandardMaterial color="#F0E0C0" roughness={0.8} />
          </mesh>
        ))}
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="palm" scale={1.0} />
        <Tree x={  xOff + 4.0}   z={-2.5}            type="palm" scale={0.9} />
        <Tree x={  xOff + 4.0}   z={ 2.5}            type="palm" scale={0.9} />
        <Bush x={xOff - 0.5}  z={-2.2} scale={0.8} />
        <Bush x={xOff - 0.5}  z={ 2.2} scale={0.8} />
        <Lawn x={xOff + 0.5} z={0} w={7} d={8} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={-(W / 2 + 1.5)} z={D / 2 + 1.5} w={3} d={0.8} />
        {parking && <DrivewayAndParking W={W} D={D} />}
      </>
    );
  }

  if (yardPreset === "full") {
    return (
      <>
        {/* Trees */}
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.2} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="pine"  scale={1.0} />
        <Tree x={-(W / 2 + 4.0)} z={  0}             scale={1.1} />
        <Tree x={  W / 2 + 4.0}  z={  0}             type="pine"  scale={1.0} />
        <Tree x={-(W / 2 + 3.0)} z={  D / 2 + 2.5}  scale={0.9} />
        <Tree x={  W / 2 + 3.0}  z={  D / 2 + 2.5}  scale={1.0} />
        <Tree x={0}               z={  D / 2 + 7.0}  scale={1.3} />
        <Tree x={xOff + 4.5}      z={-3.0}            type="palm"  scale={0.9} />
        <Tree x={xOff + 4.5}      z={ 3.0}            type="palm"  scale={0.9} />
        {/* Pool */}
        <Pool x={xOff} z={0} w={5} d={3} />
        {/* Gazebo */}
        <Gazebo x={-(xOff)} z={D / 2 + 5} />
        {/* Fountain */}
        <Fountain x={0} z={-(D / 2 + 7.0)} />
        {/* Flower beds */}
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={5} d={1.0} />
        {/* Hedges */}
        {[-D/3, 0, D/3].map((z, i) => (
          <Bush key={i} x={-(W / 2 + 1.4)} z={z} scale={1.0} />
        ))}
        {/* Lawns */}
        <Lawn x={xOff + 0.5} z={0} w={7} d={10} />
        <Lawn x={0} z={D / 2 + 5.5} w={W + 6} d={5} />
        {/* Path */}
        <GardenPath W={W} D={D} />
        {/* Poolside loungers */}
        {[-0.8, 0.8].map((lz, i) => (
          <mesh key={i} position={[xOff + 3.5, -0.35, lz]} castShadow>
            <boxGeometry args={[1.8, 0.15, 0.6]} />
            <meshStandardMaterial color="#F0E0C0" roughness={0.8} />
          </mesh>
        ))}
        {parking && <DrivewayAndParking W={W} D={D} />}
      </>
    );
  }

  return null;
}

// ─── Ground ─────────────────────────────────────────────────
function Ground({ W, D }: { W: number; D: number }) {
  const yardSize = Math.max(W, D) * 2.0;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.501, 0]} receiveShadow>
      <planeGeometry args={[W + yardSize * 2, D + yardSize * 2]} />
      <meshStandardMaterial color="#5A9040" roughness={0.95} />
    </mesh>
  );
}

// ─── House body ──────────────────────────────────────────────
function HouseBody({ W, D, settings }: { W: number; D: number; settings: ExteriorSettings }) {
  const { floors, roofStyle, roofColor, accentColor } = settings;
  const totalH = floors * FLOOR_H;
  return (
    <group>
      <Foundation W={W} D={D} color={accentColor} />
      {Array.from({ length: floors }).map((_, i) => (
        <FloorShell key={i} floorIndex={i} W={W} D={D} settings={settings} totalFloors={floors} />
      ))}
      <group position={[0, totalH, 0]}>
        <RoofSwitch W={W} D={D} roofStyle={roofStyle} roofColor={roofColor} />
      </group>
    </group>
  );
}

// ─── Main export ────────────────────────────────────────────
export default function HouseCanvas() {
  const exterior = useDesignerStore(s => s.exterior);
  const { W, D } = useFootprint();
  const { floors, yardPreset = "garden", showParking = false } = exterior;

  return (
    <div className="w-full h-full">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        camera={{ fov: 45, near: 0.1, far: 600 }}
      >
        <CameraRig W={W} D={D} floors={floors} />
        <OrbitControls
          enableDamping
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={3}
          maxDistance={120}
          target={[0, floors * FLOOR_H * 0.35, 0]}
        />
        <Environment preset="sunset" background backgroundBlurriness={0.04} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[20, 30, 15]} intensity={1.1} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={180}
          shadow-camera-left={-50} shadow-camera-right={50}
          shadow-camera-top={50} shadow-camera-bottom={-50}
        />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />

        <Ground W={W} D={D} />
        <HouseBody W={W} D={D} settings={exterior} />
        <YardElements W={W} D={D} yardPreset={yardPreset} parking={showParking} />
      </Canvas>
    </div>
  );
}
