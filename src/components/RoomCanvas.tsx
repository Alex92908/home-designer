"use client";

import { useRef, useEffect, useMemo, Component, ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, useGLTF } from "@react-three/drei";
import { Suspense } from "react";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, PlacedItem, RoomDef, WindowConfig } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { FurnitureItem } from "@/lib/types";
import { getFloorTexture, getWallTexture, floorTileSize, wallTileSize } from "@/lib/textures";
import { fabricMap, fabricNormal, woodMap, brushedMetalMap, marbleMap } from "@/lib/furnitureTextures";

// ─── Error boundary ───────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm flex-col gap-2 bg-gray-900">
          <span>⚠️ 3D渲染错误</span>
          <span className="text-xs opacity-60">{this.state.error}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Helpers ───────────────────────────────────────────────
function shade(hex: string, pct: number): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return hex;
  const r = Math.min(255, Math.max(0, parseInt(c.slice(0, 2), 16) + pct * 2));
  const g = Math.min(255, Math.max(0, parseInt(c.slice(2, 4), 16) + pct * 2));
  const b = Math.min(255, Math.max(0, parseInt(c.slice(4, 6), 16) + pct * 2));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Camera controller (auto-fit room) ───────────────────
function CameraController({ W, D, H }: { W: number; D: number; H: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const camZ = D / 2 + Math.max(W, D) * 1.05;
    const camY = H * 0.48;
    camera.position.set(0, camY, camZ);
    (camera as THREE.PerspectiveCamera).lookAt(0, H * 0.3, 0);
  }, [W, D, H, camera]);
  return null;
}

// ─── Multi-angle capture — registers capture fn in store ─
function CameraAndCaptureSetup() {
  const { camera, gl, scene, controls } = useThree();
  const setCameraAndCapture = useDesignerStore(s => s.setCameraAndCapture);

  useEffect(() => {
    setCameraAndCapture((pos, lookAt) => {
      camera.position.set(...pos);
      const target = new THREE.Vector3(...lookAt);
      if (controls) {
        (controls as THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }).target.copy(target);
        (controls as THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }).update();
      } else {
        camera.lookAt(target);
      }
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/jpeg", 0.85);
    });

    return () => setCameraAndCapture(null);
  }, [camera, gl, scene, controls, setCameraAndCapture]);

  return null;
}

// ─── Room geometry ────────────────────────────────────────
function RoomShell({
  W, D, H,
  wallColor, floorColor,
  wallId, floorId,
  windows,
}: {
  W: number; D: number; H: number;
  wallColor: string; floorColor: string;
  wallId: string; floorId: string;
  windows: WindowConfig[];
}) {
  const skirtColor = shade(wallColor, -18);

  // ── PBR textures ──────────────────────────────────────────────────────
  // useMemo so we only rebuild when material ID or room size changes.
  // Texture objects are generated once (cached), clone avoids repeat-state sharing.
  const floorTex = useMemo(() => {
    const base = getFloorTexture(floorId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = floorTileSize(floorId);
    t.repeat.set(W / us, D / vs);
    t.needsUpdate = true;
    return t;
  }, [floorId, W, D]);

  const wallTex = useMemo(() => {
    const base = getWallTexture(wallId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = wallTileSize(wallId);
    t.repeat.set(W / us, H / vs);
    t.needsUpdate = true;
    return t;
  }, [wallId, W, H]);

  const sideTex = useMemo(() => {
    const base = getWallTexture(wallId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = wallTileSize(wallId);
    t.repeat.set(D / us, H / vs);
    t.needsUpdate = true;
    return t;
  }, [wallId, D, H]);

  const floorMat = { color: floorColor, roughness: 0.55, metalness: 0.08, ...(floorTex ? { map: floorTex } : {}) };
  const wallMat  = { color: wallColor,  roughness: 0.82, metalness: 0.0,  ...(wallTex  ? { map: wallTex  } : {}) };
  const sideMatProps = { color: wallColor, roughness: 0.82, metalness: 0.0, ...(sideTex  ? { map: sideTex  } : {}) };

  return (
    <>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial {...floorMat} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, H / 2, -D / 2]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial {...wallMat} side={THREE.FrontSide} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial {...sideMatProps} side={THREE.FrontSide} />
      </mesh>

      {/* Right wall */}
      <mesh position={[W / 2, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial {...sideMatProps} side={THREE.FrontSide} />
      </mesh>

      {/* Ceiling */}
      <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#F8F7F5" roughness={0.95} />
      </mesh>
      {/* Ceiling crown molding — thin ledge where wall meets ceiling */}
      <mesh position={[0, H - 0.04, -D / 2 + 0.04]}>
        <boxGeometry args={[W, 0.06, 0.08]} />
        <meshStandardMaterial color="#FAFAF8" roughness={0.85} />
      </mesh>
      <mesh position={[0, H - 0.04, D / 2 - 0.04]}>
        <boxGeometry args={[W, 0.06, 0.08]} />
        <meshStandardMaterial color="#FAFAF8" roughness={0.85} />
      </mesh>
      <mesh position={[-W / 2 + 0.04, H - 0.04, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[D, 0.06, 0.08]} />
        <meshStandardMaterial color="#FAFAF8" roughness={0.85} />
      </mesh>
      <mesh position={[W / 2 - 0.04, H - 0.04, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[D, 0.06, 0.08]} />
        <meshStandardMaterial color="#FAFAF8" roughness={0.85} />
      </mesh>

      {/* Skirting boards */}
      <mesh position={[0, 0.06, -D / 2 + 0.02]}>
        <boxGeometry args={[W, 0.12, 0.04]} />
        <meshStandardMaterial color={skirtColor} roughness={0.7} />
      </mesh>
      <mesh position={[-W / 2 + 0.02, 0.06, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[D, 0.12, 0.04]} />
        <meshStandardMaterial color={skirtColor} roughness={0.7} />
      </mesh>
      <mesh position={[W / 2 - 0.02, 0.06, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[D, 0.12, 0.04]} />
        <meshStandardMaterial color={skirtColor} roughness={0.7} />
      </mesh>

      {/* Windows — positioned from store data */}
      {windows.map(win => (
        <RoomWindow key={win.id} win={win} W={W} D={D} H={H} />
      ))}
    </>
  );
}

// ─── Parameterized window (back / right / left walls) ────────
function RoomWindow({ win, W, D, H }: { win: WindowConfig; W: number; D: number; H: number }) {
  const winLen = win.len / 100;          // window length in metres
  const winPos = win.pos / 100;          // position along wall in metres
  const winCenter = winPos + winLen / 2; // centre of window along wall
  // Use per-window height/sill if set; otherwise fall back to legacy computed defaults
  const winH = win.h   !== undefined ? win.h   / 100 : Math.min(H * 0.52, 1.5);
  const sill = win.sill !== undefined ? win.sill / 100 : 0.9;
  const winY = Math.max(0.05, Math.min(H - winH - 0.05, sill)) + winH / 2;
  const curtainColor = "#E8DDD0";

  if (win.wall === "back") {
    // back wall: X axis runs from -W/2 to W/2, window pos is from left (0) to right (W)
    const xc = winCenter - W / 2;
    return (
      <group position={[xc, winY, -D / 2 + 0.03]}>
        <mesh><boxGeometry args={[winLen + 0.08, winH + 0.08, 0.06]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[0, 0, 0.03]}><boxGeometry args={[winLen, winH, 0.02]} /><meshStandardMaterial color="#A8CCE8" transparent opacity={0.4} roughness={0.05} metalness={0.1} /></mesh>
        <mesh position={[0, 0, 0.04]}><boxGeometry args={[winLen + 0.04, 0.04, 0.03]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[0, 0, 0.04]}><boxGeometry args={[0.04, winH + 0.04, 0.03]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[-(winLen / 2 + 0.1), 0, 0.02]}><boxGeometry args={[0.16, winH + 0.3, 0.04]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <mesh position={[ winLen / 2 + 0.1,  0, 0.02]}><boxGeometry args={[0.16, winH + 0.3, 0.04]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <pointLight position={[0, 0, 0.5]} intensity={5} color="#FFF4E0" distance={4} decay={2} />
      </group>
    );
  }

  if (win.wall === "right") {
    // right wall: Z axis runs from -D/2 to D/2, window pos from front (0→near camera) to back (D)
    const zc = winCenter - D / 2;
    return (
      <group position={[W / 2 - 0.03, winY, zc]}>
        <mesh><boxGeometry args={[0.06, winH + 0.08, winLen + 0.08]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[-0.02, 0, 0]}><boxGeometry args={[0.02, winH, winLen]} /><meshStandardMaterial color="#A8CCE8" transparent opacity={0.4} roughness={0.05} metalness={0.1} /></mesh>
        <mesh position={[-0.02, 0, 0]}><boxGeometry args={[0.03, 0.04, winLen]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[-0.015, 0, -(winLen / 2 + 0.1)]}><boxGeometry args={[0.04, winH + 0.3, 0.16]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <mesh position={[-0.015, 0,  winLen / 2 + 0.1]}><boxGeometry args={[0.04, winH + 0.3, 0.16]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <pointLight position={[-0.5, 0, 0]} intensity={6} color="#FFF4E0" distance={4} decay={2} />
      </group>
    );
  }

  if (win.wall === "left") {
    const zc = winCenter - D / 2;
    return (
      <group position={[-W / 2 + 0.03, winY, zc]}>
        <mesh><boxGeometry args={[0.06, winH + 0.08, winLen + 0.08]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[0.02, 0, 0]}><boxGeometry args={[0.02, winH, winLen]} /><meshStandardMaterial color="#A8CCE8" transparent opacity={0.4} roughness={0.05} metalness={0.1} /></mesh>
        <mesh position={[0.02, 0, 0]}><boxGeometry args={[0.03, 0.04, winLen]} /><meshStandardMaterial color="#FFFFFF" roughness={0.4} /></mesh>
        <mesh position={[0.015, 0, -(winLen / 2 + 0.1)]}><boxGeometry args={[0.04, winH + 0.3, 0.16]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <mesh position={[0.015, 0,  winLen / 2 + 0.1]}><boxGeometry args={[0.04, winH + 0.3, 0.16]} /><meshStandardMaterial color={curtainColor} roughness={0.9} /></mesh>
        <pointLight position={[0.5, 0, 0]} intensity={6} color="#FFF4E0" distance={4} decay={2} />
      </group>
    );
  }

  return null;
}

// ─── Light fixture ─────────────────────────────────────────
function LightFixture({ H, lightColor, lightId }: { H: number; lightColor: string; lightId: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current && lightId === "light-chandelier") {
      ref.current.rotation.y += delta * 0.15;
    }
  });

  if (lightId === "light-spot") {
    return (
      <group position={[0, H - 0.06, 0]}>
        <mesh>
          <boxGeometry args={[1.8, 0.03, 0.03]} />
          <meshStandardMaterial color="#1A1A1A" metalness={0.8} roughness={0.3} />
        </mesh>
        {([-0.7, 0, 0.7] as const).map((x, i) => (
          <group key={i} position={[x, -0.1, 0]}>
            <mesh>
              <cylinderGeometry args={[0.04, 0.07, 0.14, 8]} />
              <meshStandardMaterial color="#111" metalness={0.9} roughness={0.2} />
            </mesh>
            <spotLight position={[x, H - 0.22, 0]} target-position={[x, 0, 0]} intensity={6} angle={0.35} penumbra={0.4} color="#FFF2D8" castShadow shadow-mapSize={[512, 512]} />
          </group>
        ))}
      </group>
    );
  }

  if (lightId === "light-chandelier") {
    return (
      <group position={[0, H - 0.15, 0]}>
        <mesh ref={ref}>
          <sphereGeometry args={[0.28, 20, 20]} />
          <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.6} roughness={0.1} metalness={0.2} transparent opacity={0.88} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
          <meshStandardMaterial color="#AAA" metalness={0.9} roughness={0.2} />
        </mesh>
        <pointLight position={[0, H - 0.22, 0]} intensity={10} color={lightColor} distance={5} decay={2} castShadow />
      </group>
    );
  }

  if (lightId === "light-linear-pendant") {
    return (
      <group position={[0, H - 0.15, 0]}>
        <mesh>
          <boxGeometry args={[1.2, 0.06, 0.08]} />
          <meshStandardMaterial color="#E8E8E8" metalness={0.3} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.28, 4]} />
          <meshStandardMaterial color="#AAA" metalness={0.9} />
        </mesh>
        <pointLight position={[0, H - 0.25, 0]} intensity={9} color={lightColor} distance={5} decay={2} castShadow />
      </group>
    );
  }

  // Japanese paper lantern (和紙ランプ)
  if (lightId === "light-japanese-paper") {
    return (
      <group position={[0, H - 0.12, 0]}>
        {/* Suspension cord */}
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 0.28, 4]} />
          <meshStandardMaterial color="#777" metalness={0.3} roughness={0.6} />
        </mesh>
        {/* Lantern body — flattened sphere */}
        <mesh position={[0, -0.12, 0]} scale={[1, 0.75, 1]}>
          <sphereGeometry args={[0.32, 16, 14]} />
          <meshStandardMaterial color="#F5EDD0" emissive="#F5EDD0" emissiveIntensity={0.18} roughness={0.92} transparent opacity={0.88} />
        </mesh>
        {/* Top/bottom caps */}
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.06, 8]} />
          <meshStandardMaterial color="#8B6A40" roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.36, 0]}>
          <cylinderGeometry args={[0.05, 0.02, 0.06, 8]} />
          <meshStandardMaterial color="#8B6A40" roughness={0.7} />
        </mesh>
        {/* Warm diffuse light */}
        <pointLight position={[0, H - 0.22, 0]} intensity={7} color="#FFF0C0" distance={5} decay={2} castShadow />
      </group>
    );
  }

  // Industrial Edison bulb cluster (工业裸泡灯)
  if (lightId === "light-industrial-bulb") {
    return (
      <group position={[0, H - 0.08, 0]}>
        {/* Ceiling canopy */}
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.05, 10]} />
          <meshStandardMaterial color="#222" metalness={0.85} roughness={0.3} />
        </mesh>
        {/* Three hanging cords at different heights */}
        {([[-0.28, -0.35], [0, -0.50], [0.28, -0.38]] as [number, number][]).map(([bx, by], i) => (
          <group key={i} position={[bx, by, 0]}>
            <mesh position={[0, 0.15, 0]}>
              <cylinderGeometry args={[0.003, 0.003, 0.30, 4]} />
              <meshStandardMaterial color="#333" />
            </mesh>
            {/* Socket */}
            <mesh position={[0, 0, 0]}>
              <cylinderGeometry args={[0.028, 0.022, 0.05, 8]} />
              <meshStandardMaterial color="#2A2A2A" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Edison bulb — slightly amber tinted glass */}
            <mesh position={[0, -0.07, 0]} scale={[1, 1.3, 1]}>
              <sphereGeometry args={[0.055, 10, 8]} />
              <meshStandardMaterial color="#F5C060" emissive="#F5A020" emissiveIntensity={0.9} roughness={0.05} transparent opacity={0.82} />
            </mesh>
            {/* Filament glow */}
            <pointLight position={[bx, H - 0.5 + Math.abs(by), 0]} intensity={2.5} color="#FF9800" distance={3} decay={2} />
          </group>
        ))}
        {/* Main area light */}
        <pointLight position={[0, H - 0.55, 0]} intensity={6} color="#FFB347" distance={5} decay={2} castShadow />
      </group>
    );
  }

  // Default pendant
  return (
    <group position={[0, H - 0.18, 0]}>
      <mesh>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.4} roughness={0.15} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.32, 6]} />
        <meshStandardMaterial color="#BBB" metalness={0.8} />
      </mesh>
      <pointLight position={[0, H - 0.25, 0]} intensity={8} color={lightColor} distance={4.5} decay={2} castShadow />
    </group>
  );
}

// ─── Furniture mesh renderers ──────────────────────────────

interface MeshProps { color: string; sc?: string; w: number; d: number; h: number; }

function Sofa({ color, sc, w, d, h }: MeshProps) {
  const arm = shade(color, -12);
  const back = shade(color, -8);
  const leg = shade(color, -25);
  const cushion = shade(color, 10);
  const seatH = h * 0.42;
  const backH = h * 0.55;
  const armW = Math.min(w * 0.09, 0.24);
  const seatsN = Math.max(1, Math.round(w / 0.85));
  const fabricA = useMemo(() => { const t = fabricMap(color).clone(); t.repeat.set(w * 3, d * 3); t.needsUpdate = true; return t; }, [color, w, d]);
  const fabricB = useMemo(() => { const t = fabricMap(back).clone(); t.repeat.set(w * 3, 2); t.needsUpdate = true; return t; }, [back, w]);
  const fabricC = useMemo(() => { const t = fabricMap(cushion).clone(); t.repeat.set(2, 2); t.needsUpdate = true; return t; }, [cushion]);
  const fabricN = useMemo(() => { const t = fabricNormal().clone(); t.repeat.set(6, 6); t.needsUpdate = true; return t; }, []);

  return (
    <group position={[0, 0, 0]}>
      {/* Seat */}
      <mesh position={[0, seatH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, seatH, d]} />
        <meshStandardMaterial color={color} map={fabricA} normalMap={fabricN} normalScale={new THREE.Vector2(0.35, 0.35)} roughness={0.92} metalness={0} />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, seatH + backH / 2, -d / 2 + 0.12]} castShadow>
        <boxGeometry args={[w, backH, d * 0.22]} />
        <meshStandardMaterial color={back} map={fabricB} normalMap={fabricN} normalScale={new THREE.Vector2(0.3, 0.3)} roughness={0.82} />
      </mesh>
      {/* Arms */}
      <mesh position={[-w / 2 + armW / 2, seatH + h * 0.15, 0]} castShadow>
        <boxGeometry args={[armW, h * 0.32, d]} />
        <meshStandardMaterial color={arm} map={fabricB} normalMap={fabricN} normalScale={new THREE.Vector2(0.3, 0.3)} roughness={0.82} />
      </mesh>
      <mesh position={[w / 2 - armW / 2, seatH + h * 0.15, 0]} castShadow>
        <boxGeometry args={[armW, h * 0.32, d]} />
        <meshStandardMaterial color={arm} map={fabricB} normalMap={fabricN} normalScale={new THREE.Vector2(0.3, 0.3)} roughness={0.82} />
      </mesh>
      {/* Cushions */}
      {Array.from({ length: seatsN }).map((_, i) => {
        const cx = (i - (seatsN - 1) / 2) * (w / seatsN);
        return (
          <mesh key={i} position={[cx, seatH + 0.055, d * 0.05]} castShadow>
            <boxGeometry args={[(w - armW * 2) / seatsN - 0.04, 0.1, d * 0.72]} />
            <meshStandardMaterial color={cushion} map={fabricC} normalMap={fabricN} normalScale={new THREE.Vector2(0.25, 0.25)} roughness={0.88} />
          </mesh>
        );
      })}
      {/* Legs */}
      {([[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.06, lz]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.12, 6]} />
          <meshStandardMaterial color={leg} metalness={0.2} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function CoffeeTable({ color, w, d, h }: MeshProps) {
  const leg = shade(color, -20);
  const wood = useMemo(() => { const t = woodMap(color, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.8), Math.max(1, d * 0.8)); t.needsUpdate = true; return t; }, [color, w, d]);
  return (
    <group>
      <mesh position={[0, h - 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.55} metalness={0.03} />
      </mesh>
      {([[-w / 2 + 0.08, -d / 2 + 0.08], [w / 2 - 0.08, -d / 2 + 0.08], [-w / 2 + 0.08, d / 2 - 0.08], [w / 2 - 0.08, d / 2 - 0.08]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, h / 2 - 0.04, lz]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, h - 0.06, 6]} />
          <meshStandardMaterial color={leg} metalness={0.3} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function TvUnit({ color, sc, w, d, h }: MeshProps) {
  const leg = shade(color, -20);
  const handle = "#B0B0B0";
  const bodyH = h * 0.45;
  const wood = useMemo(() => { const t = woodMap(color, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.9), 1); t.needsUpdate = true; return t; }, [color, w]);
  return (
    <group>
      {/* Body */}
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, bodyH, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.5} />
      </mesh>
      {/* Divider */}
      <mesh position={[0, bodyH / 2, 0]}>
        <boxGeometry args={[0.03, bodyH - 0.04, d - 0.04]} />
        <meshStandardMaterial color={shade(color, -12)} />
      </mesh>
      {/* Handles */}
      {([-w * 0.28, w * 0.28] as const).map((hx, i) => (
        <mesh key={i} position={[hx, bodyH / 2, d / 2 + 0.01]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.01, 0.01, 0.16, 6]} />
          <meshStandardMaterial color={handle} metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* Legs */}
      {([-w * 0.4, w * 0.4] as const).map((lx, i) =>
        ([-d * 0.25, d * 0.25] as const).map((lz, j) => (
          <mesh key={`${i}${j}`} position={[lx, -0.06, lz]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.1, 6]} />
            <meshStandardMaterial color={leg} metalness={0.4} roughness={0.5} />
          </mesh>
        ))
      )}
      {/* TV screen */}
      <mesh position={[0, bodyH + h * 0.5, -d * 0.05]} castShadow>
        <boxGeometry args={[w * 0.85, h * 0.9, 0.055]} />
        <meshStandardMaterial color="#0A0C12" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, bodyH + h * 0.5, -d * 0.05 + 0.03]}>
        <boxGeometry args={[w * 0.81, h * 0.85, 0.01]} />
        <meshStandardMaterial color="#0A1520" metalness={0.1} roughness={0.05} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function BedMesh({ color, sc, w, d, h }: MeshProps) {
  const frame = "#C4A87A";
  const mattress = "#F2EDE4";
  const duvet = sc ?? "#EAE2D8";
  const pillow = "#FAFAF5";
  const headH = h * 0.85;
  const matH = h * 0.25;
  const platformH = h * 0.18;
  const frameWood = useMemo(() => { const t = woodMap(frame, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.6), 1); t.needsUpdate = true; return t; }, [frame, w]);
  const duvetTex = useMemo(() => { const t = fabricMap(duvet).clone(); t.repeat.set(Math.max(1, w * 2), Math.max(1, d * 1.5)); t.needsUpdate = true; return t; }, [duvet, w, d]);
  const headboardTex = useMemo(() => { const t = fabricMap(color).clone(); t.repeat.set(Math.max(1, w * 1.6), 2); t.needsUpdate = true; return t; }, [color, w]);
  const fabricN = useMemo(() => { const t = fabricNormal().clone(); t.repeat.set(8, 8); t.needsUpdate = true; return t; }, []);

  return (
    <group>
      {/* Platform */}
      <mesh position={[0, platformH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.04, platformH, d + 0.04]} />
        <meshStandardMaterial color={frame} map={frameWood} roughness={0.72} />
      </mesh>
      {/* Mattress */}
      <mesh position={[0, platformH + matH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, matH, d * 0.92]} />
        <meshStandardMaterial color={mattress} roughness={0.9} />
      </mesh>
      {/* Duvet */}
      <mesh position={[0, platformH + matH + 0.04, d * 0.1]} castShadow>
        <boxGeometry args={[w * 0.97, 0.09, d * 0.65]} />
        <meshStandardMaterial color={duvet} map={duvetTex} normalMap={fabricN} normalScale={new THREE.Vector2(0.3, 0.3)} roughness={0.92} />
      </mesh>
      {/* Pillows */}
      {([-w * 0.22, w * 0.22] as const).map((px, i) => (
        <mesh key={i} position={[px, platformH + matH + 0.07, -d * 0.32]} castShadow>
          <boxGeometry args={[w * 0.38, 0.12, d * 0.2]} />
          <meshStandardMaterial color={pillow} roughness={0.88} />
        </mesh>
      ))}
      {/* Headboard */}
      <mesh position={[0, platformH + headH / 2, -d / 2]} castShadow>
        <boxGeometry args={[w + 0.04, headH, 0.12]} />
        <meshStandardMaterial color={color} map={headboardTex} normalMap={fabricN} normalScale={new THREE.Vector2(0.35, 0.35)} roughness={0.84} />
      </mesh>
      {/* Legs */}
      {([[-w / 2, -d / 2 + 0.08], [w / 2, -d / 2 + 0.08], [-w / 2, d / 2 - 0.08], [w / 2, d / 2 - 0.08]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.1, lz]} castShadow>
          <boxGeometry args={[0.06, 0.2, 0.06]} />
          <meshStandardMaterial color="#8A6840" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Nightstand({ color, w, d, h }: MeshProps) {
  const wood = useMemo(() => { const t = woodMap(color, "vertical").clone(); t.repeat.set(Math.max(1, w * 2), Math.max(1, h * 2)); t.needsUpdate = true; return t; }, [color, w, h]);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.55} />
      </mesh>
      {/* Drawer */}
      <mesh position={[0, h * 0.28, d / 2 + 0.005]}>
        <boxGeometry args={[w - 0.04, h * 0.32, 0.01]} />
        <meshStandardMaterial color={shade(color, -10)} roughness={0.5} />
      </mesh>
      {/* Handle */}
      <mesh position={[0, h * 0.28, d / 2 + 0.02]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.008, 0.008, 0.1, 6]} />
        <meshStandardMaterial color="#C0C0C0" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Lamp */}
      <mesh position={[0, h + 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 0.2, 8]} />
        <meshStandardMaterial color="#F0E8D0" roughness={0.8} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, h + 0.12, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.12, 6]} />
        <meshStandardMaterial color="#C0A870" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Wardrobe({ color, sc, w, d, h }: MeshProps) {
  const door = shade(color, -8);
  const handle = "#B8B8B8";
  const wood = useMemo(() => { const t = woodMap(color, "vertical").clone(); t.repeat.set(Math.max(1, w * 1.2), Math.max(1, h * 1.2)); t.needsUpdate = true; return t; }, [color, w, h]);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.5} />
      </mesh>
      {/* Door lines */}
      {[-1, 0, 1].map(dx => (
        <mesh key={dx} position={[dx * w / 3, h / 2, d / 2 + 0.005]}>
          <boxGeometry args={[0.015, h - 0.04, 0.01]} />
          <meshStandardMaterial color={shade(color, -18)} roughness={0.4} />
        </mesh>
      ))}
      {/* Handles */}
      {[-1, 1].map((dx, i) => (
        <mesh key={i} position={[dx * w / 6, h * 0.5, d / 2 + 0.02]}>
          <cylinderGeometry args={[0.008, 0.008, 0.12, 6]} />
          <meshStandardMaterial color={handle} metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function DiningTable({ color, w, d, h }: MeshProps) {
  const leg = shade(color, -22);
  const wood = useMemo(() => { const t = woodMap(color, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.8), Math.max(1, d * 0.8)); t.needsUpdate = true; return t; }, [color, w, d]);
  return (
    <group>
      <mesh position={[0, h - 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.45} metalness={0.05} />
      </mesh>
      {([[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, (h - 0.06) / 2, lz]} castShadow>
          <boxGeometry args={[0.06, h - 0.06, 0.06]} />
          <meshStandardMaterial color={leg} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function DiningChair({ color, w, d, h }: MeshProps) {
  const leg = shade(color, -20);
  const seatH = h * 0.5;
  return (
    <group>
      {/* Seat */}
      <mesh position={[0, seatH, 0]} castShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
      </mesh>
      {/* Back */}
      <mesh position={[0, seatH + h * 0.28, -d / 2 + 0.04]} castShadow>
        <boxGeometry args={[w, h * 0.55, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
      </mesh>
      {/* Legs */}
      {([[-w / 2 + 0.04, -d / 2 + 0.04], [w / 2 - 0.04, -d / 2 + 0.04], [-w / 2 + 0.04, d / 2 - 0.04], [w / 2 - 0.04, d / 2 - 0.04]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, seatH / 2, lz]} castShadow>
          <boxGeometry args={[0.04, seatH, 0.04]} />
          <meshStandardMaterial color={leg} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function KitchenCabinet({ color, w, d, h }: MeshProps) {
  const door = shade(color, -10);
  const counter = shade(color, -5);
  const handle = "#909090";
  const counterH = h * 0.06;
  return (
    <group>
      <mesh position={[0, (h - counterH) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h - counterH, d]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* Counter top */}
      {(() => {
        const marble = marbleMap("#E8E0D8");
        const mt = marble.clone(); mt.repeat.set(Math.max(1, w * 0.6), 1); mt.needsUpdate = true;
        return (
          <mesh position={[0, h - counterH / 2, 0]}>
            <boxGeometry args={[w + 0.02, counterH, d + 0.04]} />
            <meshStandardMaterial color="#E8E0D8" map={mt} roughness={0.25} metalness={0.1} />
          </mesh>
        );
      })()}
      {/* Door lines */}
      {Array.from({ length: Math.round(w / 0.6) }).map((_, i) => {
        const n = Math.round(w / 0.6);
        const cx = (i - (n - 1) / 2) * (w / n);
        return (
          <mesh key={i} position={[cx, (h - counterH) / 2, d / 2 + 0.005]}>
            <boxGeometry args={[0.012, h - counterH - 0.04, 0.01]} />
            <meshStandardMaterial color={door} roughness={0.4} />
          </mesh>
        );
      })}
      {/* Handles */}
      <mesh position={[0, (h - counterH) * 0.55, d / 2 + 0.02]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.008, 0.008, w * 0.6, 6]} />
        <meshStandardMaterial color={handle} metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Refrigerator({ color, w, d, h }: MeshProps) {
  const metal = useMemo(() => { const t = brushedMetalMap(color).clone(); t.repeat.set(1, Math.max(1, h * 0.8)); t.needsUpdate = true; return t; }, [color, h]);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} map={metal} roughness={0.4} metalness={0.55} />
      </mesh>
      {/* Door line */}
      <mesh position={[0, h * 0.35, d / 2 + 0.005]}>
        <boxGeometry args={[w - 0.04, 0.008, 0.01]} />
        <meshStandardMaterial color={shade(color, -20)} roughness={0.3} />
      </mesh>
      {/* Handle */}
      <mesh position={[w * 0.35, h * 0.6, d / 2 + 0.03]}>
        <boxGeometry args={[0.03, h * 0.25, 0.06]} />
        <meshStandardMaterial color="#888" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Toilet({ color, w, d, h }: MeshProps) {
  return (
    <group>
      {/* Tank */}
      <mesh position={[0, h * 0.7, -d * 0.3]} castShadow>
        <boxGeometry args={[w * 0.85, h * 0.45, d * 0.3]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Bowl base */}
      <mesh position={[0, h * 0.2, d * 0.05]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.42, d * 0.7]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Seat */}
      <mesh position={[0, h * 0.42, d * 0.07]}>
        <boxGeometry args={[w * 0.94, 0.04, d * 0.64]} />
        <meshStandardMaterial color={shade(color, -8)} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Bathtub({ color, w, d, h }: MeshProps) {
  const rimColor = shade(color, -12);
  return (
    <group>
      {/* Outer shell */}
      <mesh position={[0, h * 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.8, d]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} />
      </mesh>
      {/* Inner bowl */}
      <mesh position={[0, h * 0.5, 0]}>
        <boxGeometry args={[w - 0.1, h * 0.55, d - 0.1]} />
        <meshStandardMaterial color="#D0E8F0" roughness={0.2} metalness={0.05} />
      </mesh>
      {/* Rim */}
      <mesh position={[0, h * 0.8, 0]}>
        <boxGeometry args={[w + 0.04, 0.04, d + 0.04]} />
        <meshStandardMaterial color={rimColor} roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Faucet */}
      <mesh position={[w * 0.4, h * 0.9, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.15, 6]} />
        <meshStandardMaterial color="#C8C8C8" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

function Shower({ color, w, d, h }: MeshProps) {
  return (
    <group>
      {/* Glass walls */}
      <mesh position={[0, h / 2, d / 2]}>
        <boxGeometry args={[w, h, 0.015]} />
        <meshStandardMaterial color="#B8D4E8" transparent opacity={0.35} roughness={0.05} metalness={0.1} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]}>
        <boxGeometry args={[0.015, h, d]} />
        <meshStandardMaterial color="#B8D4E8" transparent opacity={0.35} roughness={0.05} metalness={0.1} />
      </mesh>
      {/* Frame */}
      <mesh position={[0, h - 0.01, 0]}>
        <boxGeometry args={[w, 0.02, d]} />
        <meshStandardMaterial color="#C0C8D0" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Floor tray */}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color="#E8E8E8" roughness={0.6} />
      </mesh>
    </group>
  );
}

function BathroomVanity({ color, sc, w, d, h }: MeshProps) {
  return (
    <group>
      {/* Cabinet */}
      <mesh position={[0, h * 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.82, d]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* Counter */}
      <mesh position={[0, h * 0.82, 0]}>
        <boxGeometry args={[w + 0.02, h * 0.06, d + 0.04]} />
        <meshStandardMaterial color="#E8E0D8" roughness={0.25} metalness={0.1} />
      </mesh>
      {/* Sink */}
      <mesh position={[0, h * 0.87, 0]}>
        <boxGeometry args={[w * 0.6, 0.08, d * 0.65]} />
        <meshStandardMaterial color="#F5F5F5" roughness={0.3} metalness={0.05} />
      </mesh>
      {/* Faucet */}
      <mesh position={[0, h + 0.1, -d * 0.12]}>
        <cylinderGeometry args={[0.015, 0.015, 0.14, 6]} />
        <meshStandardMaterial color="#C8C8C8" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Mirror */}
      <mesh position={[0, h + 0.28, -d / 2 + 0.01]}>
        <boxGeometry args={[w * 0.9, h * 0.65, 0.02]} />
        <meshStandardMaterial color="#A8B8C0" metalness={0.5} roughness={0.05} />
      </mesh>
    </group>
  );
}

function Desk({ color, w, d, h }: MeshProps) {
  const leg = shade(color, -22);
  const wood = useMemo(() => { const t = woodMap(color, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.8), Math.max(1, d * 0.8)); t.needsUpdate = true; return t; }, [color, w, d]);
  return (
    <group>
      <mesh position={[0, h - 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.05, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.45} />
      </mesh>
      {([[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, (h - 0.05) / 2, lz]} castShadow>
          <boxGeometry args={[0.05, h - 0.05, 0.05]} />
          <meshStandardMaterial color={leg} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function Bookshelf({ color, w, d, h }: MeshProps) {
  const back = shade(color, -12);
  const shelfCount = Math.max(2, Math.floor(h / 0.38));
  const wood = useMemo(() => { const t = woodMap(color, "vertical").clone(); t.repeat.set(Math.max(1, w * 1.2), Math.max(1, h * 1.2)); t.needsUpdate = true; return t; }, [color, w, h]);
  return (
    <group>
      {/* Sides */}
      <mesh position={[-w / 2 + 0.02, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.03, h, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.5} />
      </mesh>
      <mesh position={[w / 2 - 0.02, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.03, h, d]} />
        <meshStandardMaterial color={color} map={wood} roughness={0.5} />
      </mesh>
      {/* Back */}
      <mesh position={[0, h / 2, -d / 2 + 0.01]}>
        <boxGeometry args={[w, h, 0.02]} />
        <meshStandardMaterial color={back} map={wood} roughness={0.6} />
      </mesh>
      {/* Shelves */}
      {Array.from({ length: shelfCount + 1 }).map((_, i) => {
        const y = (i / shelfCount) * h;
        return (
          <mesh key={i} position={[0, y, 0]} castShadow>
            <boxGeometry args={[w - 0.04, 0.025, d]} />
            <meshStandardMaterial color={color} map={wood} roughness={0.5} />
          </mesh>
        );
      })}
      {/* Books (simple colored rectangles) */}
      {Array.from({ length: shelfCount }).map((_, si) => {
        const shelfY = ((si + 0.5) / shelfCount) * h;
        return Array.from({ length: Math.floor((w - 0.08) / 0.07) }).map((_, bi) => {
          const bx = -w / 2 + 0.06 + bi * 0.07 + 0.02;
          const bColor = ["#8B3A3A", "#3A5F8B", "#3A8B4A", "#8B8B3A", "#6B3A8B"][bi % 5];
          return (
            <mesh key={`${si}-${bi}`} position={[bx, shelfY + 0.04, 0]}>
              <boxGeometry args={[0.05, 0.26, d * 0.75]} />
              <meshStandardMaterial color={bColor} roughness={0.7} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

function Plant({ color, w, d, h }: MeshProps) {
  const potH = h * 0.28;
  const potColor = "#8B7355";
  return (
    <group>
      {/* Pot */}
      <mesh position={[0, potH / 2, 0]} castShadow>
        <cylinderGeometry args={[w * 0.35, w * 0.28, potH, 10]} />
        <meshStandardMaterial color={potColor} roughness={0.7} />
      </mesh>
      {/* Soil */}
      <mesh position={[0, potH, 0]}>
        <cylinderGeometry args={[w * 0.34, w * 0.34, 0.04, 10]} />
        <meshStandardMaterial color="#3A2A1A" roughness={0.9} />
      </mesh>
      {/* Leaves */}
      <mesh position={[0, potH + h * 0.36, 0]} castShadow>
        <sphereGeometry args={[w * 0.46, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* Stem */}
      <mesh position={[0, potH + h * 0.2, 0]}>
        <cylinderGeometry args={[0.02, 0.025, h * 0.42, 6]} />
        <meshStandardMaterial color="#4A6A30" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Rug({ color, w, d }: MeshProps) {
  return (
    <mesh position={[0, 0.01, 0]} receiveShadow>
      <boxGeometry args={[w, 0.015, d]} />
      <meshStandardMaterial color={color} roughness={0.98} metalness={0} />
    </mesh>
  );
}

function FloorLamp({ color, w, d, h }: MeshProps) {
  return (
    <group>
      {/* Base */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[w * 0.35, w * 0.4, 0.06, 10]} />
        <meshStandardMaterial color="#888" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, h * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, h - 0.3, 6]} />
        <meshStandardMaterial color={color} metalness={0.7} roughness={0.35} />
      </mesh>
      {/* Shade */}
      <mesh position={[0, h - 0.12, 0]} castShadow>
        <cylinderGeometry args={[w * 0.42, w * 0.28, h * 0.25, 10]} />
        <meshStandardMaterial color="#F5EED8" roughness={0.82} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, h - 0.18, 0]} intensity={4} color="#FFF0D0" distance={3} decay={2} />
    </group>
  );
}

function Storage({ color, w, d, h }: MeshProps) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* Rods/bars */}
      {Array.from({ length: 3 }).map((_, i) => (
        <mesh key={i} position={[(i - 1) * w * 0.28, h * 0.7, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.01, d * 0.8, 6]} />
          <meshStandardMaterial color="#AAAAAA" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Artwork({ color, w, d, h }: MeshProps) {
  // Render at wall height (eye level)
  return (
    <group>
      {/* Canvas */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[w, h, 0.03]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Frame */}
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[w + 0.04, h + 0.04, 0.02]} />
        <meshStandardMaterial color="#5A4A3A" roughness={0.6} />
      </mesh>
    </group>
  );
}

// ─── Per-category material properties ─────────────────────
function furnitureMat(category: string, color: string): { color: string; roughness: number; metalness: number; envMapIntensity?: number } {
  switch (category) {
    case "sofa":
    case "dining_chair":
    case "office_chair":
      return { color, roughness: 0.92, metalness: 0 };                     // fabric
    case "coffee_table":
    case "dining_table":
    case "desk":
    case "nightstand":
    case "sideboard":
    case "bookshelf":
    case "tv_unit":
    case "wardrobe":
    case "dresser":
    case "storage":
      return { color, roughness: 0.58, metalness: 0.02, envMapIntensity: 0.4 }; // wood
    case "floor_lamp":
    case "range_hood":
      return { color, roughness: 0.28, metalness: 0.75 };                  // metal
    case "kitchen_cabinet":
    case "kitchen_sink":
    case "bathroom_vanity":
      return { color, roughness: 0.45, metalness: 0.08 };                  // painted cabinet
    case "refrigerator":
      return { color, roughness: 0.22, metalness: 0.55 };                  // appliance
    case "bathtub":
    case "toilet":
    case "shower":
      return { color, roughness: 0.35, metalness: 0.04 };                  // ceramic
    case "rug":
      return { color, roughness: 0.98, metalness: 0 };                     // carpet
    case "plant":
      return { color, roughness: 0.85, metalness: 0 };
    case "artwork":
      return { color, roughness: 0.75, metalness: 0 };
    case "bed":
      return { color, roughness: 0.88, metalness: 0 };                     // upholstered
    default:
      return { color, roughness: 0.65, metalness: 0.02 };
  }
}

// Generic fallback
function GenericBox({ color, w, d, h, category }: MeshProps & { category?: string }) {
  const mat = furnitureMat(category ?? "", color);
  return (
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial {...mat} />
    </mesh>
  );
}

// ─── Placed furniture mesh dispatcher ─────────────────────

function FurnitureMesh({ item, w, d, h }: { item: FurnitureItem; w: number; d: number; h: number }) {
  const props: MeshProps = { color: item.color, sc: item.secondaryColor, w, d, h };
  switch (item.category) {
    case "sofa":             return <Sofa {...props} />;
    case "coffee_table":    return <CoffeeTable {...props} />;
    case "tv_unit":         return <TvUnit {...props} />;
    case "bed":             return <BedMesh {...props} />;
    case "nightstand":      return <Nightstand {...props} />;
    case "wardrobe":        return <Wardrobe {...props} />;
    case "dresser":         return <Wardrobe {...props} />;
    case "dining_table":    return <DiningTable {...props} />;
    case "dining_chair":    return <DiningChair {...props} />;
    case "kitchen_cabinet": return <KitchenCabinet {...props} />;
    case "refrigerator":    return <Refrigerator {...props} />;
    case "range_hood":      return <GenericBox {...props} category="range_hood" />;
    case "kitchen_sink":    return <BathroomVanity {...props} />;
    case "toilet":          return <Toilet {...props} />;
    case "bathtub":         return <Bathtub {...props} />;
    case "shower":          return <Shower {...props} />;
    case "bathroom_vanity": return <BathroomVanity {...props} />;
    case "desk":            return <Desk {...props} />;
    case "bookshelf":       return <Bookshelf {...props} />;
    case "office_chair":    return <DiningChair {...props} />;
    case "storage":         return <Storage {...props} />;
    case "floor_lamp":      return <FloorLamp {...props} />;
    case "plant":           return <Plant {...props} />;
    case "rug":             return <Rug {...props} />;
    case "artwork":         return <Artwork {...props} />;
    case "sideboard":       return <CoffeeTable {...props} />;
    default:                return <GenericBox {...props} category={item.category} />;
  }
}

// ─── Placed item in 3D ─────────────────────────────────────

// ─── glTF-backed furniture (Step 2) ─────────────────────────
// Renders a real 3D asset from .glb/.gltf. Scaled to match the item's
// declared footprint (width/depth/height in cm) so clearance rules +
// spatial reasoning still apply even when geometry comes from an asset.
// Errors during load fall back to the procedural mesh via <Suspense> +
// <ErrorBoundary> in the parent.

function GltfFurniture({
  url, scale, rotation, yOffset, w, d, h,
}: { url: string; scale?: number; rotation?: number; yOffset?: number; w: number; d: number; h: number }) {
  const { scene } = useGLTF(url) as unknown as { scene: THREE.Object3D };

  // Clone so multiple instances don't share transforms or materials.
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    // Measure the asset's native bounding box so we can scale to our
    // declared furniture size (width/depth/height in meters).
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Safety: if any dim is zero (broken model), skip auto-scale.
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      const sx = w / size.x;
      const sy = h / size.y;
      const sz = d / size.z;
      const baseScale = Math.min(sx, sy, sz);
      c.scale.setScalar(baseScale * (scale ?? 1));
    } else if (scale) {
      c.scale.setScalar(scale);
    }
    return c;
  }, [scene, w, d, h, scale]);

  return (
    <group rotation={[0, rotation ?? 0, 0]} position={[0, yOffset ?? 0, 0]}>
      <primitive object={cloned} />
    </group>
  );
}

function PlacedItemMesh({ placed, def, roomW, roomD }: { placed: PlacedItem; def: RoomDef; roomW: number; roomD: number }) {
  const item = getFurnitureById(placed.furnitureId);
  if (!item) return null;

  // Convert floor plan cm coords to 3D world units using actual room dimensions
  const x3d = placed.x / 100 - roomW / 2;
  const z3d = placed.z / 100 - roomD / 2;

  // Apply per-instance scale from the floor plan (scaleW/scaleD/scaleH default to 1)
  const fw = (item.width  * (placed.scaleW ?? 1)) / 100;
  const fd = (item.depth  * (placed.scaleD ?? 1)) / 100;
  const fh = (item.height * (placed.scaleH ?? 1)) / 100;

  const rotY = (placed.rotation * Math.PI) / 180;

  // Artwork special case: mount on back wall
  if (item.category === "artwork") {
    return (
      <group position={[x3d, def.height / 100 * 0.52, -roomD / 2 + 0.04]} rotation={[0, 0, 0]}>
        <FurnitureMesh item={item} w={fw} d={fd} h={fh} />
      </group>
    );
  }

  // Upper kitchen cabinet: wall-mounted at ~1.3m, shallower, no counter top
  if (item.id.includes("cabinet-upper")) {
    const H = def.height / 100;
    const mountY = H * 0.48;  // bottom edge ~1.3m for 2.7m room
    const upperH = fh * 0.72; // upper cabinet is shorter than lower
    const upperD = fd * 0.60; // shallower than lower cabinet
    return (
      <group position={[x3d, mountY, z3d]} rotation={[0, rotY, 0]}>
        {/* Cabinet body */}
        <mesh position={[0, upperH / 2, 0]} castShadow>
          <boxGeometry args={[fw, upperH, upperD]} />
          <meshStandardMaterial color={item.color} roughness={0.45} />
        </mesh>
        {/* Door dividers */}
        {Array.from({ length: Math.max(1, Math.round(fw / 0.6)) }).map((_, i) => {
          const n = Math.max(1, Math.round(fw / 0.6));
          const cx = (i - (n - 1) / 2) * (fw / n);
          return (
            <mesh key={i} position={[cx, upperH / 2, upperD / 2 + 0.005]}>
              <boxGeometry args={[0.012, upperH - 0.03, 0.008]} />
              <meshStandardMaterial color={item.color} roughness={0.4} />
            </mesh>
          );
        })}
        {/* Handle */}
        <mesh position={[0, upperH * 0.38, upperD / 2 + 0.018]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.006, 0.006, fw * 0.55, 6]} />
          <meshStandardMaterial color="#909090" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    );
  }

  const baseY = (placed.elevationY ?? 0) / 100;

  // If the furniture item has a real 3D asset, render it; else fall
  // back to procedural box mesh. Suspense handles async glb load; if
  // loading throws (404, CORS, malformed) the ErrorBoundary higher up
  // catches it — for safety we also wrap in our own fallback.
  if (item.model3d?.url) {
    return (
      <group position={[x3d, baseY, z3d]} rotation={[0, rotY, 0]}>
        <Suspense fallback={<FurnitureMesh item={item} w={fw} d={fd} h={fh} />}>
          <GltfFurnitureWithFallback
            item={item}
            w={fw} d={fd} h={fh}
          />
        </Suspense>
      </group>
    );
  }

  return (
    <group position={[x3d, baseY, z3d]} rotation={[0, rotY, 0]}>
      <FurnitureMesh item={item} w={fw} d={fd} h={fh} />
    </group>
  );
}

/** Inner wrapper: catches GLTF load errors (404/malformed) and falls
 *  back to procedural geometry instead of crashing the scene. */
class GltfFurnitureWithFallback extends Component<
  { item: FurnitureItem; w: number; d: number; h: number },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[GltfFurniture] ${this.props.item.id}: ${err.message}`);
  }
  render() {
    const { item, w, d, h } = this.props;
    if (this.state.failed || !item.model3d) {
      return <FurnitureMesh item={item} w={w} d={d} h={h} />;
    }
    return (
      <GltfFurniture
        url={item.model3d.url}
        scale={item.model3d.scale}
        rotation={item.model3d.rotation}
        yOffset={item.model3d.yOffset}
        w={w} d={d} h={h}
      />
    );
  }
}

// ─── Main Scene ────────────────────────────────────────────

function Scene({ isIOS }: { isIOS: boolean }) {
  const activeRoom    = useDesignerStore((s) => s.activeRoom);
  const roomState     = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom]);
  const roomWindows   = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomWindows?.[activeRoom] ?? []);
  const roomDimensions = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDimensions[activeRoom]);
  const def = ROOM_DEFS[activeRoom];

  // Use store dimensions (reflects global plan resizes), fall back to ROOM_DEFS
  const W = (roomDimensions?.width  ?? def.width)  / 100;
  const D = (roomDimensions?.depth  ?? def.depth)  / 100;
  const H = def.height / 100;

  const wallColor  = roomState.materials.wall?.color  ?? def.defaultWallColor;
  const floorColor = roomState.materials.floor?.color ?? def.defaultFloorColor;
  const wallId     = roomState.materials.wall?.id     ?? "";
  const floorId    = roomState.materials.floor?.id    ?? "";
  const lightColor = roomState.materials.light?.color ?? "#FFE8A0";
  const lightId    = roomState.materials.light?.id    ?? "";

  return (
    <>
      <CameraController W={W} D={D} H={H} />
      <CameraAndCaptureSetup />

      {/* Environment — skip on iOS: PMREMGenerator.fromScene is broken on iPhone Metal
          (three.js bug #25888). Compensate with stronger ambient + fill lights. */}
      {!isIOS && <Environment preset="apartment" />}

      {/* Main directional light with shadows */}
      <directionalLight
        position={[W * 0.5, H * 2.2, D * 0.8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-W}
        shadow-camera-right={W}
        shadow-camera-top={D}
        shadow-camera-bottom={-D}
        shadow-bias={-0.001}
      />
      {/* Fill light */}
      <directionalLight position={[-W * 0.8, H * 1.5, -D * 0.5]} intensity={0.5} />
      {/* Ambient — brighter on iOS to compensate for missing Environment IBL */}
      <ambientLight intensity={isIOS ? 1.8 : 0.7} />
      {isIOS && <directionalLight position={[-3, 4, 3]} intensity={0.8} />}

      {/* Room geometry */}
      <RoomShell
        W={W} D={D} H={H}
        wallColor={wallColor}
        floorColor={floorColor}
        wallId={wallId}
        floorId={floorId}
        windows={roomWindows}
      />

      {/* Light fixture */}
      <LightFixture H={H} lightColor={lightColor} lightId={lightId} />

      {/* Placed furniture */}
      {roomState.placedItems.map((placed) => (
        <PlacedItemMesh key={placed.instanceId} placed={placed} def={def} roomW={W} roomD={D} />
      ))}
    </>
  );
}

// ─── Export ────────────────────────────────────────────────

// Detect iOS synchronously — safe here because RoomCanvas is loaded with ssr:false
// Fixes three.js bug #25888: PMREMGenerator.fromScene returns black envMap on iPhone (Metal WebGL)
function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export default function RoomCanvas() {
  const isIOS = detectIOS();

  return (
    <div className="w-full h-full">
      <ErrorBoundary>
        <Canvas
          gl={{
            // iOS: antialias causes pipeline issues (Safari ignores it anyway)
            antialias: !isIOS,
            // iOS Metal GLSL compiler fails on ACESFilmicToneMapping → use Linear
            toneMapping: isIOS ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.2,
            // Required for canvas.toDataURL() (AI render screenshot)
            preserveDrawingBuffer: true,
          }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          camera={{ position: [0, 1.4, 6], fov: 58, near: 0.1, far: 80 }}
          style={{ background: "#1a1c28" }}
        >
          <OrbitControls
            makeDefault
            enablePan={true}
            panSpeed={0.6}
            minDistance={1.5}
            maxDistance={18}
            maxPolarAngle={Math.PI * 0.52}
            target={[0, 0.6, 0]}
          />
          <Scene isIOS={isIOS} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
