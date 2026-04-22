"use client";

import { useRef, useMemo, useEffect, useState, Fragment, Suspense, Component, type ReactElement, type ReactNode } from "react";
import { Canvas, useThree, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, Html } from "@react-three/drei";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, ExteriorSettings, ExteriorWall } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";

// ─── Constants ─────────────────────────────────────────────
const FLOOR_H = 2.8;
const WT      = 0.24;
const OV      = 0.55;

// ─── Footprint ─────────────────────────────────────────────
function useFootprint() {
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
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

// ─── Exterior wall decor (per-room) ─────────────────────────
// Each room's RoomState may carry an `exteriorDecor` array pinning items
// (wall lights, mailboxes, numbers, vines…) to the OUTSIDE face of one
// of its 4 walls. In HouseCanvas we aggregate decor from every enabled
// room on every floor, and translate each item's local (u, v) into
// world coords using that room's layout + dimensions. In RoomCanvas the
// same data is rendered at room-local coords (see RoomExteriorDecorLayer
// there).
//
// Convention: decor wall names match WindowConfig (back = -Z, front = +Z
// in ROOM-local coords; left = -X, right = +X). Each decor sits on the
// OUTSIDE face of that wall, normal = outward from the room.

const DECOR_OFFSET = 0.025; // push decor this far off the wall surface

/** Shared with RoomCanvas — renders an exterior decor item. Handles three
 *  visual modes: textured image (has imageUrl), emissive light strip
 *  (id starts with "light-strip-"), or plain colored box. */
function DecorMesh({
  furnitureId, scaleW = 1, scaleH = 1, rotation = 0, selected, onSelect, onDragStart,
}: {
  furnitureId: string; scaleW?: number; scaleH?: number; rotation?: number;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: any) => void;
}) {
  const item = getFurnitureById(furnitureId);
  const canvasTex = useMemo(
    () => (item ? makeHouseCanvasDecorTexture(item) : null),
    [item]
  );
  useEffect(() => () => { canvasTex?.dispose(); }, [canvasTex]);
  if (!item) return null;
  const w = (item.width / 100) * scaleW;
  const h = (item.height / 100) * scaleH;
  const d = item.depth / 100;
  const isLightStrip = item.id.startsWith("light-strip-");
  const isVine = item.id === "climbing-vine";
  const hasImage = !!item.imageUrl;

  return (
    <group
      rotation={[0, 0, (rotation * Math.PI) / 180]}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); onDragStart(e); }}
    >
      {canvasTex ? (
        <mesh position={[0, 0, 0.005]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={canvasTex}
            transparent={isVine}
            alphaTest={isVine ? 0.1 : 0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : hasImage ? (
        <Suspense fallback={
          <mesh position={[0, 0, 0.005]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={item.color} side={THREE.DoubleSide} />
          </mesh>
        }>
          <HouseMuralPlane url={item.imageUrl!} w={w} h={h} />
        </Suspense>
      ) : isLightStrip ? (
        <mesh position={[0, 0, d / 2]}>
          <boxGeometry args={[w, h, Math.max(0.01, d)]} />
          <meshStandardMaterial
            color={item.color}
            emissive={item.color}
            emissiveIntensity={1.5}
            roughness={0.3}
          />
        </mesh>
      ) : (
        <mesh position={[0, 0, d / 2]} castShadow>
          <boxGeometry args={[w, h, Math.max(0.02, d)]} />
          <meshStandardMaterial color={item.color} roughness={0.55} metalness={0.3} />
        </mesh>
      )}
      {selected && (
        <>
          <mesh position={[0, h / 2 + 0.015, 0.01]}>
            <boxGeometry args={[w + 0.04, 0.02, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[0, -h / 2 - 0.015, 0.01]}>
            <boxGeometry args={[w + 0.04, 0.02, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[-w / 2 - 0.015, 0, 0.01]}>
            <boxGeometry args={[0.02, h, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[w / 2 + 0.015, 0, 0.01]}>
            <boxGeometry args={[0.02, h, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Suspense-loaded mural plane — the same pattern as RoomCanvas's
 *  MuralPlane: useLoader caches by URL globally and the mesh mounts only
 *  once the image is ready, so murals show reliably on add (no async
 *  setState timing quirks). */
function HouseMuralPlane({ url, w, h }: { url: string; w: number; h: number }) {
  const tex = useLoader(THREE.TextureLoader, url);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  }, [tex]);
  return (
    <mesh position={[0, 0, 0.005]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
  );
}

function makeHouseCanvasDecorTexture(item: import("@/lib/types").FurnitureItem): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const drawCouplet = (chars: string[], bgColor: string) => {
    const W = 256, H = 1536;
    c.width = W; c.height = H;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#F0D070";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = "#F8E090";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${W * 0.68}px "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif`;
    const slotH = H / chars.length;
    chars.forEach((ch, i) => ctx.fillText(ch, W / 2, slotH * (i + 0.5)));
  };
  const drawPlate = (text: string, bg: string[], textColor: string) => {
    const W = 800, H = 320;
    c.width = W; c.height = H;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, bg[0]); grad.addColorStop(0.5, bg[1]); grad.addColorStop(1, bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#484A4C"; ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = text.length <= 3 ? H * 0.75 : H * 0.55;
    ctx.font = `bold ${fs}px "Arial Black", "Heiti SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(text, W / 2, H / 2 + 6);
  };

  const drawMeander = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#7A3518"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#D4A030"; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    for (let x = 0; x < W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 10, 30); ctx.lineTo(x + 90, 30);
      ctx.lineTo(x + 90, 50); ctx.lineTo(x + 30, 50);
      ctx.lineTo(x + 30, 70); ctx.lineTo(x + 70, 70);
      ctx.lineTo(x + 70, 10);
      ctx.stroke();
    }
  };
  const drawFloral = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#F0EADB"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#8A4A18"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    for (let x = 0; x < W; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x + 20, 50);
      ctx.quadraticCurveTo(x + 40, 25, x + 60, 50);
      ctx.quadraticCurveTo(x + 80, 75, x + 100, 50);
      ctx.stroke();
      ctx.fillStyle = "#B87030"; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(x + 60, 50, 18, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#8A4A18";
      ctx.beginPath(); ctx.arc(x + 60, 50, 10, 0, Math.PI * 2); ctx.fill();
    }
  };
  const drawIvy = () => {
    const W = 400, H = 600;
    c.width = W; c.height = H;
    ctx.fillStyle = "#5A4028"; ctx.fillRect(0, 0, W, H);
    const leaf = (cx: number, cy: number, color: string, alpha: number, size = 22) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#1A3A18"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.quadraticCurveTo(cx - size, cy - size * 0.5, cx - size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx, cy + size, cx + size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx + size, cy - size * 0.5, cx, cy - size);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - size); ctx.lineTo(cx, cy + size); ctx.stroke();
      ctx.restore();
    };
    for (let y = 0; y < H; y += 50) {
      for (let x = 0; x < W; x += 40) {
        const ox = (Math.floor(y / 50) % 2 === 0) ? 0 : 20;
        leaf(x + ox, y, "#2D5A2A", 0.95);
      }
    }
    for (let y = 25; y < H; y += 50) {
      for (let x = 20; x < W; x += 40) leaf(x, y, "#3A7030", 0.85, 20);
    }
    ctx.strokeStyle = "#4A3020"; ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
    [50, 200, 350].forEach(sx => {
      ctx.beginPath(); ctx.moveTo(sx, 0);
      for (let y = 0; y <= H; y += 30) ctx.lineTo(sx + Math.sin(y / 40) * 20, y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };

  if (item.id === "couplet-spring")        drawCouplet(["春","回","大","地","千","山","秀"], "#C82020");
  else if (item.id === "couplet-prosperity") drawCouplet(["万","事","如","意","福","满","门"], "#A81818");
  else if (item.id === "house-number")     drawPlate("888", ["#D0D2D4","#E8EAEC","#A8ABAE"], "#1A1C1E");
  else if (item.id === "nameplate-family") drawPlate("之家", ["#D4A85A","#F0C878","#8A6528"], "#3A2410");
  else if (item.id === "border-meander")   drawMeander();
  else if (item.id === "border-floral")    drawFloral();
  else if (item.id === "climbing-vine")    drawIvy();
  else return null;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Compute the world-space transform for one room's exterior wall
 *  surface. Input is the room's world-centered X/Z (meters) + room
 *  dimensions + room height + which wall.
 *
 *  The returned frame is oriented so that inside the frame:
 *    local +X = "right" when standing outside the wall looking at it
 *    local +Y = up
 *    local +Z = outward normal (away from the room interior)
 */
function roomWallFrame(
  roomCx: number, roomCz: number, roomW: number, roomD: number, roomH: number,
  wall: import("@/lib/types").ExteriorWall,
): { position: [number, number, number]; rotation: [number, number, number]; wallW: number; wallH: number } {
  const y = roomH / 2;
  const off = DECOR_OFFSET;
  switch (wall) {
    case "back":  return { position: [roomCx, y, roomCz - roomD / 2 - off], rotation: [0, Math.PI, 0],     wallW: roomW, wallH: roomH };
    case "front": return { position: [roomCx, y, roomCz + roomD / 2 + off], rotation: [0, 0, 0],           wallW: roomW, wallH: roomH };
    case "left":  return { position: [roomCx - roomW / 2 - off, y, roomCz], rotation: [0, -Math.PI / 2, 0], wallW: roomD, wallH: roomH };
    case "right": return { position: [roomCx + roomW / 2 + off, y, roomCz], rotation: [0,  Math.PI / 2, 0], wallW: roomD, wallH: roomH };
  }
}

function WallFrame({
  decorRoom, wall, roomCx, roomCz, roomW, roomD, roomH, yOffset,
  items, selectedId, setSelected, draggingIdRef, orbitRef, updateDecor,
}: {
  /** Owning room — needed so updateDecor knows where to patch. */
  decorRoom: import("@/lib/types").RoomType;
  wall: import("@/lib/types").ExteriorWall;
  roomCx: number; roomCz: number; roomW: number; roomD: number; roomH: number;
  /** World Y offset for multi-floor stacking. */
  yOffset: number;
  items: Array<import("@/lib/types").ExteriorWallDecorItem>;
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  draggingIdRef: React.MutableRefObject<string | null>;
  orbitRef: React.MutableRefObject<any>;
  updateDecor: (room: import("@/lib/types").RoomType, id: string, patch: Partial<import("@/lib/types").ExteriorWallDecorItem>) => void;
}) {
  const { position, rotation, wallW, wallH } = roomWallFrame(roomCx, roomCz, roomW, roomD, roomH, wall);
  const groupRef = useRef<THREE.Group>(null);

  const onDragMove = (e: any) => {
    const id = draggingIdRef.current;
    if (!id || !groupRef.current) return;
    const worldPt = e.point as THREE.Vector3;
    const local = groupRef.current.worldToLocal(worldPt.clone());
    const u = local.x / wallW + 0.5;
    const v = local.y / wallH + 0.5;
    const clampedU = Math.max(0.04, Math.min(0.96, u));
    const clampedV = Math.max(0.04, Math.min(0.96, v));
    updateDecor(decorRoom, id, { u: clampedU, v: clampedV });
  };
  const onDragEnd = () => {
    if (draggingIdRef.current) {
      draggingIdRef.current = null;
      if (orbitRef.current) orbitRef.current.enabled = true;
    }
  };

  // Apply yOffset on top of roomWallFrame's Y (which is roomH/2 for this
  // floor's slice). The whole frame group's final world Y = yOffset + roomH/2.
  const finalPosition: [number, number, number] = [position[0], position[1] + yOffset, position[2]];

  return (
    <group ref={groupRef} position={finalPosition} rotation={rotation}>
      {/* Invisible drag plane */}
      <mesh
        position={[0, 0, 0.002]}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        <planeGeometry args={[wallW, wallH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {items.map(d => (
        <group
          key={d.instanceId}
          position={[(d.u - 0.5) * wallW, (d.v - 0.5) * wallH, 0.01]}
        >
          <DecorMesh
            furnitureId={d.furnitureId}
            scaleW={d.scaleW}
            scaleH={d.scaleH}
            rotation={d.rotation}
            selected={selectedId === d.instanceId}
            onSelect={() => setSelected(d.instanceId)}
            onDragStart={() => {
              draggingIdRef.current = d.instanceId;
              if (orbitRef.current) orbitRef.current.enabled = false;
            }}
          />
        </group>
      ))}
    </group>
  );
}

/** Aggregator: walks every enabled room on every floor, computes its
 *  world-centered X/Z (via roomLayout + roomDimensions), and renders a
 *  WallFrame per decor'd wall. The room's world center is derived the
 *  same way as `useFootprint` computes the house bbox — rooms layout
 *  in cm with Y-down screen coords → world: (layout.x - minX) - W*50
 *  shifts the cm-origin to house center. */
function WallDecorLayer({
  W, D, orbitRef,
}: {
  W: number; D: number;
  orbitRef: React.MutableRefObject<any>;
}) {
  const floorPlans = useDesignerStore(s => s.floorPlans);
  const selectedId = useDesignerStore(s => s.selectedExteriorDecorId);
  const setSelected = useDesignerStore(s => s.setSelectedExteriorDecor);
  const updateDecor = useDesignerStore(s => s.updateRoomExteriorDecor);
  const draggingIdRef = useRef<string | null>(null);

  const frames: ReactElement[] = [];
  floorPlans.forEach((plan, floorIdx) => {
    const indoor = plan.enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
    if (indoor.length === 0) return;
    const xs = indoor.flatMap(r => [plan.roomLayout[r].x, plan.roomLayout[r].x + plan.roomDimensions[r].width]);
    const zs = indoor.flatMap(r => [plan.roomLayout[r].y, plan.roomLayout[r].y + plan.roomDimensions[r].depth]);
    const minX = Math.min(...xs), minZ = Math.min(...zs);
    const planW_m = (Math.max(...xs) - minX) / 100;
    const planD_m = (Math.max(...zs) - minZ) / 100;
    for (const room of indoor) {
      const decor = plan.rooms[room]?.exteriorDecor;
      if (!decor || decor.length === 0) continue;
      const dims = plan.roomDimensions[room];
      const lay = plan.roomLayout[room];
      // Room world center (meters), relative to the whole-house footprint
      // centered at world origin.
      const roomCx = ((lay.x + dims.width / 2) - minX) / 100 - planW_m / 2;
      const roomCz = ((lay.y + dims.depth / 2) - minZ) / 100 - planD_m / 2;
      const roomW  = dims.width / 100;
      const roomD  = dims.depth / 100;
      // Use ROOM_DEFS height for the storey's interior height. HouseCanvas
      // itself stacks floors via FLOOR_H; we match that so the decor
      // aligns with its floor slab.
      const roomH  = FLOOR_H;
      const yOff   = floorIdx * FLOOR_H;
      const walls: import("@/lib/types").ExteriorWall[] = ["front", "back", "left", "right"];
      for (const wall of walls) {
        const items = decor.filter(d => d.wall === wall);
        if (items.length === 0) continue;
        frames.push(
          <WallFrame
            key={`${floorIdx}-${room}-${wall}`}
            decorRoom={room}
            wall={wall}
            roomCx={roomCx} roomCz={roomCz}
            roomW={roomW} roomD={roomD} roomH={roomH}
            yOffset={yOff}
            items={items}
            selectedId={selectedId}
            setSelected={setSelected}
            draggingIdRef={draggingIdRef}
            orbitRef={orbitRef}
            updateDecor={updateDecor}
          />
        );
      }
    }
  });

  // `W`, `D` parameters are unused at the moment (kept for call-site
  // backward compatibility).
  void W; void D;
  return <>{frames}</>;
}

/** Catches failures from drei's <Environment> — most commonly a CDN
 *  fetch error on the Poly Haven HDR used by presets like "sunset" /
 *  "apartment". Without this, a network failure crashes the whole
 *  Canvas; with it, we gracefully degrade to ambient + directional. */
class HouseEnvironmentFallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[HouseCanvas.Environment] HDR fetch failed: ${err.message}`);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
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
function Tree({ x, z, type = "round", scale = 1 }: { x: number; z: number; type?: "round" | "pine" | "palm" | "cypress"; scale?: number }) {
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
  if (type === "cypress") {
    // Italian Cypress — very tall, very narrow, columnar dark green
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        {/* Trunk */}
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.12, 1.0, 6]} />
          <meshStandardMaterial color="#3A2210" roughness={0.9} />
        </mesh>
        {/* Lower tier */}
        <mesh position={[0, 1.5, 0]} castShadow>
          <coneGeometry args={[0.38, 2.0, 7]} />
          <meshStandardMaterial color="#1A4A20" roughness={0.9} />
        </mesh>
        {/* Mid tier */}
        <mesh position={[0, 2.8, 0]} castShadow>
          <coneGeometry args={[0.26, 2.0, 7]} />
          <meshStandardMaterial color="#1C5224" roughness={0.9} />
        </mesh>
        {/* Top tier */}
        <mesh position={[0, 4.1, 0]} castShadow>
          <coneGeometry args={[0.14, 1.6, 6]} />
          <meshStandardMaterial color="#1E5826" roughness={0.9} />
        </mesh>
        {/* Tip */}
        <mesh position={[0, 5.1, 0]} castShadow>
          <coneGeometry args={[0.06, 0.7, 5]} />
          <meshStandardMaterial color="#1A4820" roughness={0.9} />
        </mesh>
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

// ─── Outdoor element interaction (furniture-like) ───────────
/**
 * Wraps an outdoor element so it behaves like 2D furniture:
 * - Click → select (shows action panel with rotate / remove)
 * - Drag → move (raw DOM pointermove + plane raycasting, no orbit conflict)
 * - Rotate button → 45° steps
 * - Remove button → reset to default position
 * - Click elsewhere → deselect
 */
function DraggableGroup({
  posKey, label, defaultX, defaultZ, hitW = 8, hitD = 8,
  orbitRef, selectedKey, onSelect, children,
}: {
  posKey: string;
  label: string;
  defaultX: number;
  defaultZ: number;
  hitW?: number;
  hitD?: number;
  orbitRef: React.MutableRefObject<any>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  children: React.ReactNode;
}) {
  const { gl, camera } = useThree();
  const setOutdoorPosition  = useDesignerStore(s => s.setOutdoorPosition);
  const rotateOutdoor       = useDesignerStore(s => s.rotateOutdoor);
  const resetOutdoorPosition = useDesignerStore(s => s.resetOutdoorPosition);
  const savedState = useDesignerStore(s => s.exterior.outdoorPositions?.[posKey]);

  const pos = { x: savedState?.x ?? defaultX, z: savedState?.z ?? defaultZ };
  const rotDeg = savedState?.rot ?? 0;
  const rotRad = rotDeg * (Math.PI / 180);

  const isSelected = selectedKey === posKey;
  const isDragging = useRef(false);
  const didDrag    = useRef(false);           // distinguish click vs drag
  const [hovered, setHovered] = useState(false);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // Panel float height above element centre
  const panelY = Math.max(hitW, hitD) * 0.35 + 2.5;
  const ringR  = Math.max(hitW, hitD) / 2;

  useEffect(() => {
    const canvas = gl.domElement;

    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      didDrag.current = true;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(groundPlane, hit)) {
        setOutdoorPosition(posKey, { x: hit.x, z: hit.z });
      }
    };

    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
      canvas.style.cursor = hovered ? "grab" : "default";
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup",   onUp);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup",   onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, posKey, hovered]);

  return (
    <group position={[pos.x, 0, pos.z]} rotation={[0, rotRad, 0]}>

      {/* ── Hit surface (pointer events) ── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          didDrag.current = false;
          isDragging.current = true;
          if (orbitRef.current) orbitRef.current.enabled = false;
          gl.domElement.style.cursor = "grabbing";
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          // Only toggle selection when it was a click (not a drag)
          if (!didDrag.current) {
            onSelect(isSelected ? null : posKey);
          }
        }}
        onPointerEnter={() => { setHovered(true);  gl.domElement.style.cursor = "grab"; }}
        onPointerLeave={() => { if (!isDragging.current) { setHovered(false); gl.domElement.style.cursor = "default"; } }}
      >
        <planeGeometry args={[hitW, hitD]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* ── Selection / hover ring ── */}
      {(isSelected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[ringR + 0.05, ringR + 0.55, 64]} />
          <meshBasicMaterial
            color={isSelected ? "#007AFF" : "#60A5FA"}
            transparent opacity={isSelected ? 0.85 : 0.45}
            side={THREE.DoubleSide} depthWrite={false}
          />
        </mesh>
      )}

      {/* ── Selected: solid border + fill tint ── */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <circleGeometry args={[ringR + 0.04, 64]} />
          <meshBasicMaterial color="#007AFF" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      {/* ── Floating action panel (Html overlay) ── */}
      {isSelected && (
        <Html
          position={[0, panelY, 0]}
          center
          distanceFactor={12}
          zIndexRange={[100, 200]}
          style={{ pointerEvents: "auto" }}
        >
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 14,
              padding: "6px 8px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              userSelect: "none",
              whiteSpace: "nowrap",
              border: "1px solid #E5E7EB",
              minWidth: 0,
            }}
          >
            {/* Label */}
            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", padding: "0 4px" }}>
              {label}
            </span>
            <div style={{ width: 1, height: 16, background: "#E5E7EB", margin: "0 2px" }} />
            {/* Rotate button */}
            <button
              onClick={(e) => { e.stopPropagation(); rotateOutdoor(posKey); }}
              style={{
                fontSize: 15, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#374151",
                display: "flex", alignItems: "center", gap: 3,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#F3F4F6")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              title="旋转 45°"
            >
              ↻ <span style={{ fontSize: 10 }}>45°</span>
            </button>
            {/* Reset position */}
            <button
              onClick={(e) => { e.stopPropagation(); resetOutdoorPosition(posKey); onSelect(null); }}
              style={{
                fontSize: 13, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#6B7280",
                display: "flex", alignItems: "center",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#FEF2F2")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              title="重置位置"
            >
              ↺
            </button>
            {/* Deselect / close */}
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(null); }}
              style={{
                fontSize: 13, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#9CA3AF",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
              onMouseLeave={e => (e.currentTarget.style.color = "#9CA3AF")}
              title="取消选中"
            >
              ✕
            </button>
          </div>
        </Html>
      )}

      {children}
    </group>
  );
}

// ─── Swimming pool ───────────────────────────────────────────
function AnimatedWater({ w, d }: { w: number; d: number }) {
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(() => {
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
        color="#0AACCC"
        emissive="#005580"
        emissiveIntensity={0.08}
        transparent
        opacity={0.92}
        roughness={0.01}
        metalness={0.0}
        envMapIntensity={3.5}
        transmission={0.06}
      />
    </mesh>
  );
}

// Luxury infinity-edge pool with travertine deck, spa, loungers, cabana
function Pool({ x, z, w = 9, d = 5 }: { x: number; z: number; w?: number; d?: number }) {
  // Travertine deck tiles
  const deckTiles = useMemo(() => {
    const tiles: { tx: number; tz: number }[] = [];
    const deckW = w + 3.0;
    const deckD = d + 3.0;
    const tileSize = 0.9;
    const cols = Math.ceil(deckW / tileSize);
    const rows = Math.ceil(deckD / tileSize);
    for (let ci = 0; ci < cols; ci++) {
      for (let ri = 0; ri < rows; ri++) {
        const tx = -deckW / 2 + ci * tileSize + tileSize / 2;
        const tz = -deckD / 2 + ri * tileSize + tileSize / 2;
        // Skip over pool area
        if (Math.abs(tx) < w / 2 + 0.1 && Math.abs(tz) < d / 2 + 0.1) continue;
        tiles.push({ tx, tz });
      }
    }
    return tiles;
  }, [w, d]);

  return (
    <group position={[x, 0, z]}>
      {/* ── Travertine deck ── */}
      {deckTiles.map((t, i) => (
        <mesh key={i} position={[t.tx, -0.02, t.tz]} receiveShadow>
          <boxGeometry args={[0.86, 0.04, 0.86]} />
          <meshStandardMaterial color="#EDE8D8" roughness={0.75} metalness={0.02} />
        </mesh>
      ))}

      {/* ── Pool shell (travertine coping surround) ── */}
      <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.7, 0.6, d + 0.7]} />
        <meshStandardMaterial color="#E2DDD0" roughness={0.7} />
      </mesh>

      {/* ── Pool interior walls (blue plaster) ── */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[w - 0.05, 0.55, d - 0.05]} />
        <meshStandardMaterial color="#85C8E0" roughness={0.25} />
      </mesh>

      {/* ── Water surface ── */}
      <AnimatedWater w={w - 0.15} d={d - 0.15} />

      {/* ── Infinity edge: +z side overflow lip (slightly lower) ── */}
      <mesh position={[0, -0.06, d / 2 + 0.18]} castShadow>
        <boxGeometry args={[w + 0.7, 0.04, 0.36]} />
        <meshStandardMaterial color="#C8C2B0" roughness={0.6} />
      </mesh>
      {/* Infinity wall below — dark, suggests water cascade */}
      <mesh position={[0, -0.55, d / 2 + 0.36]}>
        <boxGeometry args={[w + 0.7, 0.6, 0.12]} />
        <meshStandardMaterial color="#1A3A50" roughness={0.4} metalness={0.15} />
      </mesh>
      {/* Thin water sheet on infinity wall */}
      <mesh position={[0, -0.4, d / 2 + 0.43]}>
        <boxGeometry args={[w + 0.5, 0.45, 0.03]} />
        <meshPhysicalMaterial color="#0AACCC" transparent opacity={0.45} roughness={0.01} envMapIntensity={2.0} />
      </mesh>

      {/* ── Coping tiles (rim) — travertine ── */}
      {([
        { pos: [0, 0.02, -(d / 2 + 0.3)] as [number,number,number], args: [w + 0.8, 0.06, 0.55] as [number,number,number] },
        { pos: [0, 0.02,  (d / 2 + 0.3)] as [number,number,number], args: [w + 0.8, 0.06, 0.55] as [number,number,number] },
        { pos: [-(w / 2 + 0.3), 0.02, 0] as [number,number,number], args: [0.55, 0.06, d] as [number,number,number] },
        { pos: [ (w / 2 + 0.3), 0.02, 0] as [number,number,number], args: [0.55, 0.06, d] as [number,number,number] },
      ] as { pos: [number,number,number]; args: [number,number,number] }[]).map((t, i) => (
        <mesh key={i} position={t.pos} receiveShadow>
          <boxGeometry args={t.args} />
          <meshStandardMaterial color="#F0EAD8" roughness={0.55} metalness={0.05} />
        </mesh>
      ))}

      {/* ── Spa / hot tub (adjacent corner, slightly elevated) ── */}
      <group position={[w / 2 + 1.8, 0.15, -(d / 2 + 0.5)]}>
        {/* Spa shell */}
        <mesh position={[0, -0.1, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.35, 1.45, 0.55, 18]} />
          <meshStandardMaterial color="#E2DDD0" roughness={0.7} />
        </mesh>
        {/* Spa water */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[1.2, 1.2, 0.1, 18]} />
          <meshPhysicalMaterial color="#30C8E0" transparent opacity={0.88} roughness={0.01} envMapIntensity={3.0} />
        </mesh>
        {/* Jets bubbles hint */}
        {[0, 72, 144, 216, 288].map((deg, i) => {
          const r = (deg * Math.PI) / 180;
          return (
            <mesh key={i} position={[Math.cos(r) * 0.75, 0.22, Math.sin(r) * 0.75]}>
              <sphereGeometry args={[0.07, 6, 5]} />
              <meshStandardMaterial color="#AAEEFF" transparent opacity={0.6} roughness={0.05} />
            </mesh>
          );
        })}
      </group>

      {/* ── Lounger pairs with side tables and umbrellas ── */}
      {/* Pair A — far side of pool */}
      {([-1.0, 1.0] as number[]).map((lz, i) => (
        <group key={i} position={[w / 2 + 2.6, 0, lz * 1.6]}>
          {/* Lounger frame */}
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[2.1, 0.08, 0.72]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
          {/* Cushion */}
          <mesh position={[0, -0.31, 0]}>
            <boxGeometry args={[2.0, 0.06, 0.62]} />
            <meshStandardMaterial color="#FFFFF0" roughness={0.9} />
          </mesh>
          {/* Backrest raised */}
          <mesh position={[-0.7, -0.22, 0]} rotation={[0, 0, -0.35]} castShadow>
            <boxGeometry args={[0.65, 0.06, 0.62]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
        </group>
      ))}
      {/* Side table A */}
      <mesh position={[w / 2 + 2.6, -0.32, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.06, 10]} />
        <meshStandardMaterial color="#C8C0A8" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Umbrella A */}
      <group position={[w / 2 + 2.6, 0, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 2.0, 6]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.45, 0]} rotation={[0.15, 0, 0]} castShadow>
          <coneGeometry args={[1.4, 0.5, 16, 1, true]} />
          <meshStandardMaterial color="#F8F4E8" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Pair B — near side of pool */}
      {([-1.0, 1.0] as number[]).map((lz, i) => (
        <group key={i} position={[-(w / 2 + 2.6), 0, lz * 1.6]}>
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[2.1, 0.08, 0.72]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.31, 0]}>
            <boxGeometry args={[2.0, 0.06, 0.62]} />
            <meshStandardMaterial color="#FFFFF0" roughness={0.9} />
          </mesh>
          <mesh position={[0.7, -0.22, 0]} rotation={[0, 0, 0.35]} castShadow>
            <boxGeometry args={[0.65, 0.06, 0.62]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
        </group>
      ))}
      {/* Side table B */}
      <mesh position={[-(w / 2 + 2.6), -0.32, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.06, 10]} />
        <meshStandardMaterial color="#C8C0A8" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Umbrella B */}
      <group position={[-(w / 2 + 2.6), 0, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 2.0, 6]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.45, 0]} rotation={[-0.15, 0, 0]} castShadow>
          <coneGeometry args={[1.4, 0.5, 16, 1, true]} />
          <meshStandardMaterial color="#F8F4E8" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ── Pool cabana / pool house ── */}
      <group position={[0, 0, -(d / 2 + 4.5)]}>
        {/* Flat roof slab */}
        <mesh position={[0, 2.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[5.5, 0.18, 3.2]} />
          <meshStandardMaterial color="#E8E2D0" roughness={0.8} />
        </mesh>
        {/* 4 slim columns */}
        {([ [-2.3, -1.3], [2.3, -1.3], [-2.3, 1.3], [2.3, 1.3] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.6, 10]} />
            <meshStandardMaterial color="#F0EAD8" roughness={0.7} />
          </mesh>
        ))}
        {/* Curtain panels (translucent vertical planes) */}
        {([ [-1.0, 0], [1.0, 0] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]}>
            <boxGeometry args={[1.2, 2.4, 0.04]} />
            <meshStandardMaterial color="#FFFFF8" transparent opacity={0.35} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {/* Floor slab */}
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[5.3, 0.04, 3.0]} />
          <meshStandardMaterial color="#EDE8D8" roughness={0.75} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Pergola (replaces Gazebo) ───────────────────────────────
function Pergola({ x, z }: { x: number; z: number }) {
  // Rectangular 5×4 elegant pergola with open crossing-beam roof
  const pW = 5.0;
  const pD = 4.0;
  const colH = 2.8;

  const columns: [number, number][] = [
    [-pW / 2, -pD / 2], [pW / 2, -pD / 2],
    [-pW / 2,  pD / 2], [pW / 2,  pD / 2],
    [0, -pD / 2], [0, pD / 2], // extra mid columns
  ];

  // Longitudinal beams (along X)
  const longBeams: number[] = [-pD / 2, 0, pD / 2];
  // Cross beams (along Z)
  const crossBeams: number[] = [-pW / 2, -pW / 4, 0, pW / 4, pW / 2];

  return (
    <group position={[x, 0, z]}>
      {/* Stone floor */}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[pW + 0.3, 0.06, pD + 0.3]} />
        <meshStandardMaterial color="#D8D2C2" roughness={0.9} />
      </mesh>

      {/* Columns */}
      {columns.map(([cx, cz], i) => (
        <mesh key={i} position={[cx, colH / 2, cz]} castShadow>
          <cylinderGeometry args={[0.12, 0.14, colH, 10]} />
          <meshStandardMaterial color="#F0EAD8" roughness={0.7} />
        </mesh>
      ))}

      {/* Longitudinal beams (parallel to X axis) */}
      {longBeams.map((bz, i) => (
        <mesh key={i} position={[0, colH + 0.1, bz]} castShadow>
          <boxGeometry args={[pW + 0.4, 0.14, 0.16]} />
          <meshStandardMaterial color="#E8E2D0" roughness={0.75} />
        </mesh>
      ))}

      {/* Cross beams (parallel to Z axis, sit on top of long beams) */}
      {crossBeams.map((bx, i) => (
        <mesh key={i} position={[bx, colH + 0.22, 0]} castShadow>
          <boxGeometry args={[0.12, 0.12, pD + 0.2]} />
          <meshStandardMaterial color="#E8E2D0" roughness={0.75} />
        </mesh>
      ))}

      {/* Dining table — dark stone slab */}
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.1, 1.2]} />
        <meshStandardMaterial color="#3A3A3A" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Table legs */}
      {([ [-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45] ] as [number,number][]).map(([tx, tz], i) => (
        <mesh key={i} position={[tx, 0.36, tz]} castShadow>
          <boxGeometry args={[0.08, 0.72, 0.08]} />
          <meshStandardMaterial color="#2A2A2A" roughness={0.6} />
        </mesh>
      ))}

      {/* 6 chairs (simple boxes) */}
      {([ [-1.35,0], [1.35,0], [-0.5,-0.75], [0.5,-0.75], [-0.5,0.75], [0.5,0.75] ] as [number,number][]).map(([cx, cz], i) => (
        <group key={i} position={[cx, 0.46, cz]}>
          <mesh castShadow>
            <boxGeometry args={[0.48, 0.08, 0.48]} />
            <meshStandardMaterial color="#D8D0B8" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.3, -0.18]} castShadow>
            <boxGeometry args={[0.44, 0.55, 0.06]} />
            <meshStandardMaterial color="#D8D0B8" roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* Climbing plant hints — green mesh on sides */}
      {([ [0, -pD / 2 - 0.05], [0, pD / 2 + 0.05] ] as [number,number][]).map(([gx, gz], i) => (
        <mesh key={i} position={[gx, colH * 0.55, gz]}>
          <boxGeometry args={[pW, colH * 0.9, 0.05]} />
          <meshStandardMaterial color="#2E7030" transparent opacity={0.22} roughness={1.0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Outdoor Kitchen ─────────────────────────────────────────
function OutdoorKitchen({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* L-shape counter — long arm */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 1.0, 0.85]} />
        <meshStandardMaterial color="#555555" roughness={0.7} />
      </mesh>
      {/* Marble top — long arm */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[3.2, 0.06, 0.85]} />
        <meshStandardMaterial color="#E8E8E0" roughness={0.35} metalness={0.05} />
      </mesh>

      {/* L-shape counter — short arm */}
      <mesh position={[1.4, 0.5, 0.8]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 1.0, 1.65]} />
        <meshStandardMaterial color="#555555" roughness={0.7} />
      </mesh>
      {/* Marble top — short arm */}
      <mesh position={[1.4, 1.02, 0.8]} castShadow>
        <boxGeometry args={[0.85, 0.06, 1.65]} />
        <meshStandardMaterial color="#E8E8E0" roughness={0.35} metalness={0.05} />
      </mesh>

      {/* Built-in grill grate */}
      {([-0.5, 0, 0.5] as number[]).map((gx, i) => (
        <mesh key={i} position={[gx, 1.07, 0]} castShadow>
          <boxGeometry args={[0.22, 0.04, 0.55]} />
          <meshStandardMaterial color="#444444" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      {([-0.18, 0.18] as number[]).map((gz, i) => (
        <mesh key={i} position={[0, 1.07, gz]} castShadow>
          <boxGeometry args={[1.0, 0.04, 0.04]} />
          <meshStandardMaterial color="#444444" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* Small overhead pergola — 2 posts */}
      {([ [-1.4, 0], [1.4, 0] ] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.35, pz - 0.5]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.7, 8]} />
          <meshStandardMaterial color="#C8C0A8" roughness={0.75} />
        </mesh>
      ))}
      {/* Pergola beam */}
      <mesh position={[0, 2.22, -0.5]} castShadow>
        <boxGeometry args={[3.0, 0.12, 0.14]} />
        <meshStandardMaterial color="#D8D0B8" roughness={0.75} />
      </mesh>
      {/* Cross slats */}
      {([-0.9, 0, 0.9] as number[]).map((bx, i) => (
        <mesh key={i} position={[bx, 2.3, -0.5]} castShadow>
          <boxGeometry args={[0.08, 0.08, 1.1]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.75} />
        </mesh>
      ))}
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

// ─── Circular luxury driveway ────────────────────────────────
// Renders relative to its own origin (z=0 = house-front edge).
// Wrap in DraggableGroup at defaultZ=D/2 for world positioning.
function DrivewayAndParking() {
  // All z-coords are relative to house-front (z=0 here).
  const circleZ = 11.0; // center of circular driveway, 11 m from house front
  const outerR = 5.5;
  const innerR = 3.2;
  const roadW = outerR - innerR;
  const SEGS = 36;

  const ringSegments = useMemo(() => {
    const segs: { pos: [number,number,number]; rot: number; w: number; len: number }[] = [];
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGS) * Math.PI * 2;
      const midA = (a0 + a1) / 2;
      const midR = (outerR + innerR) / 2;
      segs.push({
        pos: [Math.cos(midA) * midR, -0.492, circleZ + Math.sin(midA) * midR],
        rot: midA + Math.PI / 2,
        w: roadW - 0.05,
        len: (2 * Math.PI * midR) / SEGS + 0.05,
      });
    }
    return segs;
  }, []);

  const islandPavers = useMemo(() => {
    const pvs: { px: number; pz: number }[] = [];
    const step = 0.55;
    for (let xi = -Math.ceil(innerR / step); xi <= Math.ceil(innerR / step); xi++) {
      for (let zi = -Math.ceil(innerR / step); zi <= Math.ceil(innerR / step); zi++) {
        const px = xi * step, pz = zi * step;
        if (px * px + pz * pz < (innerR - 0.3) * (innerR - 0.3)) pvs.push({ px, pz });
      }
    }
    return pvs;
  }, []);

  const carportX = outerR + 5.0;

  return (
    <group>
      {/* ── Straight approach from origin (house front) to circle ── */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.492, 5.5]} receiveShadow>
        <planeGeometry args={[4.2, 11.0]} />
        <meshStandardMaterial color="#B8A888" roughness={0.88} />
      </mesh>

      {/* ── Ring road segments ── */}
      {ringSegments.map((seg, i) => (
        <mesh key={i} rotation={[-Math.PI/2, seg.rot, 0]} position={seg.pos} receiveShadow>
          <planeGeometry args={[seg.w, seg.len]} />
          <meshStandardMaterial color="#B8A888" roughness={0.88} />
        </mesh>
      ))}

      {/* ── Center island: grass ── */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.494, circleZ]} receiveShadow>
        <circleGeometry args={[innerR - 0.15, 32]} />
        <meshStandardMaterial color="#5CBF40" roughness={0.98} />
      </mesh>

      {/* ── Center island ornamental topiary ── */}
      <group position={[0, 0, circleZ]}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.16, 1.2, 8]} />
          <meshStandardMaterial color="#5A3A1A" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.0, 0]} castShadow>
          <sphereGeometry args={[1.05, 10, 8]} />
          <meshStandardMaterial color="#2E7020" roughness={0.9} />
        </mesh>
      </group>

      {/* ── Bollard lights along approach ── */}
      {([-1.5, 1.5] as number[]).map((bx, side) =>
        [2.0, 5.0, 8.0].map((bz, j) => (
          <group key={`${side}-${j}`} position={[bx, 0, bz]}>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.09, 0.6, 8]} />
              <meshStandardMaterial color="#C8C0A0" roughness={0.6} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.64, 0]}>
              <sphereGeometry args={[0.1, 8, 7]} />
              <meshStandardMaterial color="#FFFFDD" emissive="#FFFFAA" emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
          </group>
        ))
      )}

      {/* ── Bollard lights around ring ── */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <group key={i} position={[Math.cos(a) * (outerR + 0.5), 0, circleZ + Math.sin(a) * (outerR + 0.5)]}>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.09, 0.6, 8]} />
              <meshStandardMaterial color="#C8C0A0" roughness={0.6} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.64, 0]}>
              <sphereGeometry args={[0.1, 8, 7]} />
              <meshStandardMaterial color="#FFFFDD" emissive="#FFFFAA" emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
          </group>
        );
      })}

      {/* ── Carport with 4 columns + flat roof ── */}
      <group position={[carportX, 0, circleZ]}>
        <mesh position={[0, 2.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[6.5, 0.18, 5.5]} />
          <meshStandardMaterial color="#D8D2C0" roughness={0.8} />
        </mesh>
        {([ [-2.8, -2.2], [2.8, -2.2], [-2.8, 2.2], [2.8, 2.2] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]} castShadow>
            <cylinderGeometry args={[0.14, 0.14, 2.6, 10]} />
            <meshStandardMaterial color="#F0EAD8" roughness={0.7} />
          </mesh>
        ))}
        <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.492, 0]} receiveShadow>
          <planeGeometry args={[6.2, 5.2]} />
          <meshStandardMaterial color="#B8A888" roughness={0.88} />
        </mesh>
        <Car x={-1.8} z={0} color="#E8E8E8" />
        <Car x={ 1.8} z={0} color="#1A1A2E" />
        <Car x={0}    z={4.0} color="#8B4513" />
      </group>
    </group>
  );
}

// ─── Yard presets ─────────────────────────────────────────────
function YardElements({ W, D, yardPreset, parking = false, orbitRef, selectedKey, onSelect }: {
  W: number; D: number; yardPreset: string; parking?: boolean;
  orbitRef: React.MutableRefObject<any>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const xOff = W / 2 + 7.5;   // right side (more room for luxury pool)

  if (yardPreset === "minimal") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={-(W / 2 + 3.5)} z={  D / 2 + 1.8}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 1.8}  scale={0.9} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={W / 2 + 1.5} z={-(D / 2 - 0.5)} w={2} d={0.8} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "garden") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.2} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.0} type="pine" />
        <Tree x={-(W / 2 + 3.0)} z={  D / 2 + 2.0}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 2.0}  scale={1.1} type="pine" />
        <Tree x={0}               z={  D / 2 + 5.0}  scale={1.3} />
        <Tree x={-(W / 2 + 5.5)} z={-(D / 2 + 2.0)} type="cypress" scale={1.0} />
        <Tree x={  W / 2 + 5.5}  z={-(D / 2 + 2.0)} type="cypress" scale={1.0} />
        <Tree x={-(W / 2 + 5.5)} z={  D / 2 + 2.5}  type="cypress" scale={0.9} />
        <Tree x={  W / 2 + 5.5}  z={  D / 2 + 2.5}  type="cypress" scale={0.9} />
        {[-D/4, 0, D/4].map((hz, i) => (
          <Bush key={i} x={-(W / 2 + 1.2)} z={hz} scale={0.9} />
        ))}
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={4} d={1.0} />
        <Lawn x={0} z={D / 2 + 5} w={W + 4} d={4} />
        <GardenPath W={W} D={D} />
        <DraggableGroup posKey="fountain" label="⛲ 喷泉" defaultX={0} defaultZ={-(D / 2 + 6.5)} hitW={5} hitD={5} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Fountain x={0} z={0} />
        </DraggableGroup>
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "pool") {
    return (
      <>
        <DraggableGroup posKey="pool" label="🏊 泳池" defaultX={xOff} defaultZ={0} hitW={16} hitD={13} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pool x={0} z={0} w={9} d={5} />
          <Tree x={-1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.1} />
          <Tree x={ 1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.1} />
          <Tree x={-1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
          <Tree x={ 1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
        </DraggableGroup>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="palm" scale={1.0} />
        <Tree x={xOff + 9.5}   z={-3.5} type="palm" scale={0.9} />
        <Tree x={xOff + 9.5}   z={ 3.5} type="palm" scale={0.9} />
        <DraggableGroup posKey="outdoor_kitchen" label="🍳 户外厨房" defaultX={xOff - 3.0} defaultZ={-(5 / 2 + 6.5)} hitW={8} hitD={6} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <OutdoorKitchen x={0} z={0} />
        </DraggableGroup>
        <Bush x={xOff - 0.8} z={-3.5} scale={0.8} />
        <Bush x={xOff - 0.8} z={ 3.5} scale={0.8} />
        <Lawn x={xOff + 1.0} z={0} w={10} d={12} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={-(W / 2 + 1.5)} z={D / 2 + 1.5} w={3} d={0.8} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "full") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.2} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="pine"  scale={1.0} />
        <Tree x={-(W / 2 + 4.5)} z={  0}             scale={1.1} />
        <Tree x={  W / 2 + 4.5}  z={  0}             type="pine"  scale={1.0} />
        <Tree x={-(W / 2 + 3.5)} z={  D / 2 + 2.5}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 2.5}  scale={1.0} />
        <Tree x={0}               z={  D / 2 + 7.0}  scale={1.3} />
        <Tree x={xOff + 9.5}      z={-4.0} type="palm"  scale={0.9} />
        <Tree x={xOff + 9.5}      z={ 4.0} type="palm"  scale={0.9} />
        {parking && ([8.0, 12.0, 16.0] as number[]).map((cz, i) => (
          <Fragment key={i}>
            <Tree x={-2.8} z={D / 2 + cz} type="cypress" scale={1.0} />
            <Tree x={ 2.8} z={D / 2 + cz} type="cypress" scale={1.0} />
          </Fragment>
        ))}
        <Tree x={-(W / 2 + 6.0)} z={-(D / 2 + 2.5)} type="cypress" scale={1.1} />
        <Tree x={  W / 2 + 6.0}  z={-(D / 2 + 2.5)} type="cypress" scale={1.1} />
        <DraggableGroup posKey="pool" label="🏊 泳池" defaultX={xOff} defaultZ={0} hitW={16} hitD={13} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pool x={0} z={0} w={9} d={5} />
          <Tree x={-1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.05} />
          <Tree x={ 1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.05} />
          <Tree x={-1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
          <Tree x={ 1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
        </DraggableGroup>
        <DraggableGroup posKey="pergola" label="🏛 凉亭" defaultX={-(xOff - 2)} defaultZ={D / 2 + 5} hitW={10} hitD={9} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pergola x={0} z={0} />
        </DraggableGroup>
        <DraggableGroup posKey="fountain" label="⛲ 喷泉" defaultX={0} defaultZ={-(D / 2 + 7.0)} hitW={5} hitD={5} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Fountain x={0} z={0} />
        </DraggableGroup>
        <DraggableGroup posKey="outdoor_kitchen" label="🍳 户外厨房" defaultX={xOff - 3.0} defaultZ={-(5 / 2 + 7.0)} hitW={8} hitD={6} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <OutdoorKitchen x={0} z={0} />
        </DraggableGroup>
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={5} d={1.0} />
        {[-D/3, 0, D/3].map((hz, i) => (
          <Bush key={i} x={-(W / 2 + 1.6)} z={hz} scale={1.0} />
        ))}
        <Lawn x={xOff + 1.0} z={0} w={10} d={14} />
        <Lawn x={0} z={D / 2 + 5.5} w={W + 6} d={5} />
        <GardenPath W={W} D={D} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
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

// ─── Deselect plane (click empty ground to clear selection) ──
function DeselectPlane({ onDeselect }: { onDeselect: () => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.502, 0]}
      onPointerDown={(e) => { e.stopPropagation(); onDeselect(); }}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ─── Main export ────────────────────────────────────────────
export default function HouseCanvas() {
  const exterior = useDesignerStore(s => s.exterior);
  const { W, D } = useFootprint();
  const { floors, yardPreset = "garden", showParking = false } = exterior;
  const orbitRef = useRef<any>(null);
  const [selectedOutdoorKey, setSelectedOutdoorKey] = useState<string | null>(null);

  return (
    <div className="w-full h-full">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
          // Required for canvas.toDataURL() (AI render screenshot)
          preserveDrawingBuffer: true,
        }}
        camera={{ fov: 45, near: 0.1, far: 600 }}
      >
        <CameraRig W={W} D={D} floors={floors} />
        <OrbitControls
          ref={orbitRef}
          enableDamping
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={3}
          maxDistance={120}
          target={[0, floors * FLOOR_H * 0.35, 0]}
        />
        {/* HDR environment from Poly Haven CDN — wrapped to keep the scene
            usable if the CDN fetch fails (falls back to plain ambient). */}
        <HouseEnvironmentFallback>
          <Suspense fallback={null}>
            <Environment preset="sunset" background backgroundBlurriness={0.04} />
          </Suspense>
        </HouseEnvironmentFallback>
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[20, 30, 15]} intensity={1.1} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={180}
          shadow-camera-left={-50} shadow-camera-right={50}
          shadow-camera-top={50} shadow-camera-bottom={-50}
        />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />

        {/* Click empty ground to deselect */}
        <DeselectPlane onDeselect={() => {
          setSelectedOutdoorKey(null);
          useDesignerStore.getState().setSelectedExteriorDecor(null);
        }} />
        <Ground W={W} D={D} />
        <HouseBody W={W} D={D} settings={exterior} />
        <WallDecorLayer W={W} D={D} orbitRef={orbitRef} />
        <YardElements
          W={W} D={D} yardPreset={yardPreset} parking={showParking}
          orbitRef={orbitRef}
          selectedKey={selectedOutdoorKey}
          onSelect={setSelectedOutdoorKey}
        />
      </Canvas>
    </div>
  );
}
