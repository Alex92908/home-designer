"use client";

import { useRef, useEffect, useMemo, useState, Component, ReactNode } from "react";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, useGLTF } from "@react-three/drei";
import { EffectComposer, N8AO, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense } from "react";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, PlacedItem, RoomDef, WindowConfig, MaterialItem, RoomType, ExteriorWallDecorItem } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { FurnitureItem } from "@/lib/types";
import { DetailedDecor } from "./DetailedDecor";
import { getFloorTexture, getWallTexture, floorTileSize, wallTileSize } from "@/lib/textures";
import { fabricMap, fabricNormal, woodMap, brushedMetalMap, marbleMap, paintAlbedo, paintNormal, defaultFloorPlanks } from "@/lib/furnitureTextures";

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
/** Applies a per-room tone-mapping exposure override to the renderer.
 *  Lives inside the Canvas so it can reach the WebGL renderer; reacts
 *  to store changes. Default 1.2 if the user hasn't touched the slider. */
function ExposureController() {
  const { gl } = useThree();
  const activeRoom = useDesignerStore(s => s.activeRoom);
  const exposure = useDesignerStore(s => s.roomExposureByRoom[activeRoom] ?? 1.2);
  useEffect(() => {
    if (gl) gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

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
// ─── Wall hole-cutting algorithm ─────────────────────────────
/** Subtract a list of non-overlapping rectangular holes from a wall and
 *  return the rectangles that tile the remaining area. Used so a wall
 *  with a window or door actually has a hole in it instead of rendering
 *  the window on top of a solid plane. */
interface Rect { x: number; y: number; w: number; h: number }
function splitWallAroundHoles(wallW: number, wallH: number, holes: Rect[]): Rect[] {
  const sorted = [...holes].sort((a, b) => a.x - b.x);
  const out: Rect[] = [];
  let cursorX = 0;
  for (const hole of sorted) {
    const hx = Math.max(0, hole.x);
    const hx2 = Math.min(wallW, hole.x + hole.w);
    if (hx2 <= cursorX) continue; // past-ended, fully before cursor
    if (hx > cursorX) {
      // Full-height strip between cursor and hole's left edge
      out.push({ x: cursorX, y: 0, w: hx - cursorX, h: wallH });
    }
    const hy = Math.max(0, hole.y);
    const hy2 = Math.min(wallH, hole.y + hole.h);
    // Strip below hole
    if (hy > 0) out.push({ x: Math.max(cursorX, hx), y: 0, w: hx2 - Math.max(cursorX, hx), h: hy });
    // Strip above hole
    if (hy2 < wallH) out.push({ x: Math.max(cursorX, hx), y: hy2, w: hx2 - Math.max(cursorX, hx), h: wallH - hy2 });
    cursorX = Math.max(cursorX, hx2);
  }
  if (cursorX < wallW) {
    out.push({ x: cursorX, y: 0, w: wallW - cursorX, h: wallH });
  }
  return out;
}

/** If wainscot is set, split a segment at the split height into 2. */
function splitAtWainscot(seg: Rect, splitH: number, enabled: boolean): Array<Rect & { band: "upper" | "lower" }> {
  if (!enabled || seg.y >= splitH || seg.y + seg.h <= splitH) {
    return [{ ...seg, band: seg.y >= splitH ? "upper" : "lower" }];
  }
  return [
    { x: seg.x, y: seg.y, w: seg.w, h: splitH - seg.y, band: "lower" },
    { x: seg.x, y: splitH, w: seg.w, h: (seg.y + seg.h) - splitH, band: "upper" },
  ];
}

function RoomShell({
  W, D, H,
  wallColor, floorColor,
  wallId, floorId,
  windows,
  wallBack, wallFront, wallLeft, wallRight,
  wallLower, wallSplitCm,
  wallExterior, wallBackExterior, wallFrontExterior, wallLeftExterior, wallRightExterior,
  ceiling,
  hasDoor, doorWall, doorPosCm, doorLenCm, doorHCm, doorStyle,
  activeRoom,
  frontWallOpacity,
  ceilingOpacity,
}: {
  W: number; D: number; H: number;
  wallColor: string; floorColor: string;
  wallId: string; floorId: string;
  windows: WindowConfig[];
  wallBack?: MaterialItem; wallFront?: MaterialItem;
  wallLeft?: MaterialItem; wallRight?: MaterialItem;
  wallLower?: MaterialItem;
  wallSplitCm?: number;
  wallExterior?: MaterialItem;
  wallBackExterior?: MaterialItem;
  wallFrontExterior?: MaterialItem;
  wallLeftExterior?: MaterialItem;
  wallRightExterior?: MaterialItem;
  ceiling?: MaterialItem;
  hasDoor: boolean;
  doorWall: "bottom" | "top" | "left" | "right";
  doorPosCm: number;
  doorLenCm: number;
  doorHCm: number;
  doorStyle: import("@/lib/types").DoorStyle;
  activeRoom: RoomType;
  frontWallOpacity: number;
  ceilingOpacity: number;
}) {
  const skirtColor = shade(wallColor, -18);
  const splitH = wallLower ? Math.max(0.2, Math.min(H - 0.2, (wallSplitCm ?? 110) / 100)) : 0;

  // ── Floor textures ─────────────────────────────────────────────────
  const floorTex = useMemo(() => {
    const base = getFloorTexture(floorId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = floorTileSize(floorId);
    t.repeat.set(W / us, D / vs);
    t.needsUpdate = true;
    return t;
  }, [floorId, W, D]);

  const defaultFloorTex = useMemo(() => {
    if (floorTex) return null;
    const t = defaultFloorPlanks(floorColor).clone();
    t.repeat.set(W / 1.5, D / 1.5);
    t.needsUpdate = true;
    return t;
  }, [floorColor, W, D, floorTex]);

  const floorMat = {
    color: floorColor,
    roughness: 0.6,
    metalness: 0.04,
    ...(floorTex ? { map: floorTex } : defaultFloorTex ? { map: defaultFloorTex } : {}),
  };

  // ── Wall material builder (per-side, per-band) ─────────────────────
  // Each wall side can have its own MaterialItem override. If none, fall
  // back to `wall` default (color/wallId). Bands (upper/lower) share the
  // same per-side material for albedo + paint/normal fallback texture.
  const paintNormalTex = useMemo(() => {
    const t = paintNormal().clone();
    t.repeat.set(10, 10);
    t.needsUpdate = true;
    return t;
  }, []);

  // Resolve the (possibly overridden) color + id for a given wall side.
  const resolveSide = (override?: MaterialItem) => ({
    color: override?.color ?? wallColor,
    id:    override?.id    ?? wallId,
  });

  // Return the material props for one wall (or a band of it), given the
  // resolved color/id + the side's length (along the floor) + the band's
  // height. Falls through to procedural paint texture if the material id
  // has no registered PBR texture.
  function wallMatFor(color: string, id: string, lenM: number, bandH: number) {
    const tiled = (() => {
      const base = getWallTexture(id);
      if (!base) return null;
      const t = base.clone();
      const [us, vs] = wallTileSize(id);
      t.repeat.set(lenM / us, bandH / vs);
      t.needsUpdate = true;
      return t;
    })();
    const paintTex = tiled ? null : (() => {
      const t = paintAlbedo(color).clone();
      t.repeat.set(lenM * 2, bandH * 2);
      t.needsUpdate = true;
      return t;
    })();
    return {
      color,
      roughness: 0.88,
      metalness: 0.0,
      ...(tiled ? { map: tiled } : paintTex ? { map: paintTex } : {}),
      ...(!tiled ? { normalMap: paintNormalTex, normalScale: new THREE.Vector2(0.12, 0.12) } : {}),
    };
  }

  // Ceiling material — supports user-picked texture, otherwise off-white.
  const ceilingColor = ceiling?.color ?? "#F8F7F5";
  const ceilingId    = ceiling?.id    ?? "";
  const ceilingTex = useMemo(() => {
    const base = getWallTexture(ceilingId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = wallTileSize(ceilingId);
    t.repeat.set(W / us, D / vs);
    t.needsUpdate = true;
    return t;
  }, [ceilingId, W, D]);

  // ── Per-side resolutions ──
  // Front wall isn't rendered (dollhouse cutaway) but wallFront is tracked
  // in state for the 2D plan layer and potential future first-person view.
  const sB = resolveSide(wallBack);
  const sL = resolveSide(wallLeft);
  const sR = resolveSide(wallRight);
  const lower = wallLower ? { color: wallLower.color, id: wallLower.id } : null;

  // Build the list of rectangular holes (in wall-local cm coordinates:
  // x from left end of wall, y from floor) for a given wall side.
  // Pulls windows and — if applicable — the door.
  function holesForWall(side: "back" | "front" | "left" | "right", wallLenM: number): Rect[] {
    const holes: Rect[] = [];
    for (const w of windows) {
      if (w.wall !== side) continue;
      const sillM  = (w.sill ?? 90) / 100;
      const winHM  = (w.h   ?? Math.min(H * 52, 150)) / 100;
      holes.push({
        x: w.pos / 100,
        y: sillM,
        w: w.len / 100,
        h: Math.min(winHM, H - sillM - 0.05),
      });
    }
    // Door wall naming differs: "top"=back, "bottom"=front, left/right match
    const doorSideMap: Record<string, "back" | "front" | "left" | "right"> = {
      top: "back", bottom: "front", left: "left", right: "right",
    };
    if (hasDoor && doorSideMap[doorWall] === side) {
      holes.push({
        x: doorPosCm / 100,
        y: 0,
        w: doorLenCm / 100,
        h: doorHCm / 100,
      });
    }
    // Clamp all holes to wall bounds
    return holes.map(h => ({
      x: Math.max(0, Math.min(wallLenM, h.x)),
      y: Math.max(0, Math.min(H, h.y)),
      w: Math.min(wallLenM - h.x, h.w),
      h: Math.min(H - h.y, h.h),
    })).filter(h => h.w > 0.01 && h.h > 0.01);
  }

  // Render one wall's segments. Wall-local x ∈ [0, wallLenM], y ∈ [0, H].
  // Segments are inside a group with the correct rotation + translation,
  // so each segment just positions at its local center within that group.
  //
  // Two-sided material: if `extMat` is given and differs from the interior
  // material, we render a SECOND plane per segment offset slightly toward
  // the outdoor side. From inside the room the nearer (interior) plane
  // occludes the exterior one; from outside the order reverses and the
  // exterior material becomes visible.
  function WallWithHoles({
    side, wallLenM, groupPos, groupRot, upperMat, extMat, extOffsetSign = -1, lowerSide, opacity = 1,
  }: {
    side: { color: string; id: string };
    wallLenM: number;
    groupPos: [number, number, number];
    groupRot?: [number, number, number];
    upperMat: ReturnType<typeof wallMatFor>;
    /** Material for the OUTSIDE face. When unset (or same as upperMat),
     *  only a single DoubleSide plane is drawn (matches old behavior). */
    extMat?: ReturnType<typeof wallMatFor>;
    /** Sign of the frame-local Z offset that points outdoor. -1 for
     *  back/left/right walls (outward = -Z local), +1 for the front
     *  wall (outward = +Z local, because its frame has no flip). */
    extOffsetSign?: 1 | -1;
    lowerSide: "back" | "front" | "left" | "right";
    /** 0 = don't render, 0.5 = frosted glass, 1 = solid. Applied uniformly
     *  to every segment (upper, lower, all pieces around holes). */
    opacity?: number;
  }) {
    const holes = holesForWall(lowerSide, wallLenM);
    const segments = splitWallAroundHoles(wallLenM, H, holes);
    const lowerMat = lower ? wallMatFor(lower.color, lower.id, wallLenM, splitH) : null;
    // Gap between interior and exterior wall planes — keep tiny so the
    // sandwich isn't visible at window/door cut edges (was 12mm which
    // showed as a white strip when viewing the wall obliquely).
    const extOff = extOffsetSign * 0.003;

    return (
      <group position={groupPos} rotation={groupRot}>
        {segments.flatMap((seg, si) =>
          splitAtWainscot(seg, splitH, !!lower).map((s, bi) => {
            const mat = s.band === "lower" && lowerMat ? lowerMat : upperMat;
            return (
              <group key={`${si}-${bi}`}>
                {/* Interior face (DoubleSide so it's still visible from
                    outside when there's no exterior override). */}
                <mesh
                  position={[s.x + s.w / 2 - wallLenM / 2, s.y + s.h / 2 - H / 2, 0]}
                  receiveShadow
                >
                  <planeGeometry args={[s.w, s.h]} />
                  <meshStandardMaterial
                    {...mat}
                    side={THREE.DoubleSide}
                    transparent={opacity < 1}
                    opacity={opacity}
                  />
                </mesh>
                {/* Exterior face — only drawn when user picked a distinct
                    exterior material. Offset along outward normal so it
                    sits just beyond the interior plane. */}
                {extMat && (
                  <mesh
                    position={[s.x + s.w / 2 - wallLenM / 2, s.y + s.h / 2 - H / 2, extOff]}
                    receiveShadow
                  >
                    <planeGeometry args={[s.w, s.h]} />
                    <meshStandardMaterial
                      {...extMat}
                      side={THREE.DoubleSide}
                      transparent={opacity < 1}
                      opacity={opacity}
                    />
                  </mesh>
                )}
              </group>
            );
          })
        )}
      </group>
    );
  }

  return (
    <>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial {...floorMat} />
      </mesh>

      {/* Exterior material per side: use the per-face override if set,
          else fall back to the room-wide wallExterior default. */}
      {(() => null)()}

      {/* Back wall — with hole-cutouts for windows/door */}
      <WallWithHoles
        side={sB} wallLenM={W}
        groupPos={[0, H / 2, -D / 2]}
        upperMat={wallMatFor(sB.color, sB.id, W, H)}
        extMat={(() => {
          const e = wallBackExterior ?? wallExterior;
          return e ? wallMatFor(e.color, e.id, W, H) : undefined;
        })()}
        extOffsetSign={-1}
        lowerSide="back"
      />

      {/* Left wall */}
      <WallWithHoles
        side={sL} wallLenM={D}
        groupPos={[-W / 2, H / 2, 0]} groupRot={[0, Math.PI / 2, 0]}
        upperMat={wallMatFor(sL.color, sL.id, D, H)}
        extMat={(() => {
          const e = wallLeftExterior ?? wallExterior;
          return e ? wallMatFor(e.color, e.id, D, H) : undefined;
        })()}
        extOffsetSign={-1}
        lowerSide="left"
      />

      {/* Right wall */}
      <WallWithHoles
        side={sR} wallLenM={D}
        groupPos={[W / 2, H / 2, 0]} groupRot={[0, -Math.PI / 2, 0]}
        upperMat={wallMatFor(sR.color, sR.id, D, H)}
        extMat={(() => {
          const e = wallRightExterior ?? wallExterior;
          return e ? wallMatFor(e.color, e.id, D, H) : undefined;
        })()}
        extOffsetSign={-1}
        lowerSide="right"
      />

      {/* Front wall — user-controllable opacity (0 = cut away, 0.5 =
          frosted glass, 1 = solid). Uses WallWithHoles so doors/windows
          on the front wall are cut out at any opacity. Without the cut,
          a solid front wall would block the view of an open door's
          interior. The plane's default normal is +Z (outward), which is
          correct for the front wall at z=+D/2 — no rotation needed. */}
      {frontWallOpacity > 0 && (() => {
        const sF = resolveSide(wallFront);
        const e = wallFrontExterior ?? wallExterior;
        return (
          <WallWithHoles
            side={sF} wallLenM={W}
            groupPos={[0, H / 2, D / 2]}
            upperMat={wallMatFor(sF.color, sF.id, W, H)}
            extMat={e ? wallMatFor(e.color, e.id, W, H) : undefined}
            extOffsetSign={1}
            lowerSide="front"
            opacity={frontWallOpacity}
          />
        );
      })()}

      {/* Door panel (3D, inside the wall's door hole) */}
      {hasDoor && (
        <RoomDoor3D
          W={W} D={D} H={H}
          doorWall={doorWall}
          doorPosCm={doorPosCm}
          doorLenCm={doorLenCm}
          doorHCm={doorHCm}
          activeRoom={activeRoom}
          doorStyle={doorStyle}
        />
      )}

      {/* Chair rail — thin horizontal trim at the split line (if any) */}
      {lower && (
        <>
          <mesh position={[0, splitH, -D / 2 + 0.015]}>
            <boxGeometry args={[W, 0.03, 0.03]} />
            <meshStandardMaterial color="#FAFAF8" roughness={0.7} />
          </mesh>
          <mesh position={[-W / 2 + 0.015, splitH, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[D, 0.03, 0.03]} />
            <meshStandardMaterial color="#FAFAF8" roughness={0.7} />
          </mesh>
          <mesh position={[W / 2 - 0.015, splitH, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[D, 0.03, 0.03]} />
            <meshStandardMaterial color="#FAFAF8" roughness={0.7} />
          </mesh>
        </>
      )}

      {/* Ceiling — respects user-picked material. Opacity is user-toggleable
          (0 = cut away so user can look up into the room from above,
          0.5 = translucent "xray", 1 = solid). */}
      {ceilingOpacity > 0 && (
        <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial
            color={ceilingColor}
            roughness={0.95}
            side={THREE.DoubleSide}
            transparent={ceilingOpacity < 1}
            opacity={ceilingOpacity}
            {...(ceilingTex ? { map: ceilingTex } : {})}
          />
        </mesh>
      )}
      {/* Ceiling crown molding — hides when ceiling is hidden so the top
          of the room looks cleanly cut away. */}
      {ceilingOpacity > 0 && (
        <>
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
        </>
      )}

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

// ─── glTF window (real 3D asset, replaces procedural frame/glass/mullion) ─
// Enabled when a closed-state window asset is available. Previous attempt
// (`window_modern` by JeanLescano) was a SketchUp-exported "opened 47cm"
// casement pose that didn't close via auto-transform. Switched to
// AleixoAlonso's `residential_window` (closed-state, 2.8k faces, CC-BY).
const ENABLE_GLTF_WINDOW = true;
// Default arch window — sanjaysinghfazilka's PBR archviz window
// (CC-BY-4.0). The glTF ships with nested matrices (base.fbx + model)
// that cancel out to identity, so the composed world bbox is already
// Y-up (1.91 × 1.81 × 0.24m) and no axis fix is needed.
const ARCH_WINDOW_URL = "/models/_arch_window/modern_window_archviz/scene.gltf";
// 防盗窗（铁艺栏栅）— CC-BY by 4000z, 203 meshes. Used only for "security".
// NOTE: `animated_window_systems` (CC-BY-NC) is deliberately NOT used here;
// the project may go commercial and NC licenses forbid that.
const IRON_BAR_WINDOW_URL = "/models/_arch_window/iron_bar_window/iron_bar_window.gltf";
// 百叶窗 — CC-BY by AHMED KCHIKICH, low-poly. Replaces the procedural
// slat grid for the "louvered" style.
const BLINDS_WINDOW_URL = "/models/_arch_window/window_blinds/scene.gltf";
// 木窗 — CC-BY by ahmagh2e. Used for the "wooden" style (复古/中式/乡村).
const WOODEN_WINDOW_URL = "/models/_arch_window/wooden_window/scene.gltf";

/** Per-asset loader hints. Orientation is now auto-detected inside
 *  `GltfArchWindow` (Z→X axis swap when the raw bbox suggests the
 *  window-width is along Z), so the spec currently carries only the URL. */
type GltfWindowSpec = { url: string };

/** Map a WindowStyle to the glTF to render, or null to fall back to
 *  procedural. Casement remains procedural because its single-pane look
 *  is easier to drive with the swing-open animation. */
function gltfSpecForStyle(style: import("@/lib/types").WindowStyle): GltfWindowSpec | null {
  switch (style) {
    // Sliding + louvered must stay procedural: the real glTFs are one
    // combined mesh, so we can't slide only the inner sash (sliding) or
    // tilt individual slats (louvered). Procedural meshes give us the
    // split geometry we need for convincing animation.
    case "sliding":
    case "louvered":
      return null;
    case "fixed":
      return { url: ARCH_WINDOW_URL };
    case "security":
      return { url: IRON_BAR_WINDOW_URL };
    case "wooden":
      return { url: WOODEN_WINDOW_URL };
    case "casement":
      return null;
  }
}

function GltfArchWindow({
  winLen, winH, url,
}: { winLen: number; winH: number; url: string }) {
  const { scene } = useGLTF(url) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const inner = scene.clone(true);
    // Strip SketchUp helper nodes that aren't meshes (cameras, scenes)
    // — these get exported as empties at huge offsets (88m, 135m away)
    // and pollute the bounding-box measurement below.
    const toRemove: THREE.Object3D[] = [];
    inner.traverse(obj => {
      if (/^skp_camera/i.test(obj.name || "") || /^(ID\d+|Scene_)/i.test(obj.name || "")) {
        toRemove.push(obj);
      }
    });
    for (const o of toRemove) o.parent?.remove(o);

    inner.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });

    // Wrap in an outer group so we can apply corrective transforms
    // (axis swaps) without disturbing the inner scene's own transforms.
    const c = new THREE.Group();
    c.add(inner);

    // === Measure native bbox ===
    c.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(c);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);

    // Auto-orient: the "window width" axis should be X (horizontal in
    // the wall). Most assets export this correctly, but some (like
    // `window_blinds` 10.7 × 198 × 209 and `iron_bar_window` 12 × 23 × 49)
    // put the window-width along Z instead — causing the visible content
    // to get compressed onto the thin depth axis. Detect this by
    // comparing X-extent vs Z-extent among the two "horizontal" axes:
    // whichever is larger is the intended width axis. If Z is larger,
    // rotate the inner -90° around Y so world-Z → world-X.
    if (rawSize.z > rawSize.x) {
      inner.rotation.y = -Math.PI / 2;
      c.updateMatrixWorld(true);
    }

    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    // eslint-disable-next-line no-console
    console.log(`[GltfArchWindow] ${url} native ${rawSize.x.toFixed(2)}×${rawSize.y.toFixed(2)}×${rawSize.z.toFixed(2)} → oriented ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m, target ${winLen.toFixed(2)}×${winH.toFixed(2)}m`);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      // Scale X→winLen, Y→winH. For depth (Z) preserve the x/z ratio
      // by default but clamp so the final frame is never thicker than
      // MAX_DEPTH. Without this clamp, assets with exaggerated native
      // depth get turned into multi-metre slabs that punch through the
      // wall horizontally.
      const MAX_DEPTH = 0.2;
      const sx = winLen / size.x;
      const sy = winH / size.y;
      let sz = sx;
      if (size.z * sz > MAX_DEPTH) sz = MAX_DEPTH / size.z;
      c.scale.set(sx, sy, sz);
      c.updateMatrixWorld(true);
      // Re-center XY on origin, keep Z so the frame straddles the wall plane
      const box2 = new THREE.Box3().setFromObject(c);
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.y -= (box2.min.y + box2.max.y) / 2;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
    }
    return c;
  }, [scene, winLen, winH, url]);

  return <primitive object={cloned} />;
}

/** ErrorBoundary wrapper: if the glTF 404s or fails to parse, render
 *  the provided `fallback` instead. Combined with <Suspense fallback>
 *  in the tree, this gives us: glTF → procedural on both load failure
 *  and still-loading states. */
class ArchWindowFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[GltfArchWindow] load failed — falling back to procedural: ${err.message}`);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/** Catches failures from drei's <Environment> — most commonly a network
 *  error fetching the Poly Haven HDR (e.g. `lebombo_1k.hdr` for the
 *  "apartment" preset) from the CDN. Without this wrapper such a fetch
 *  failure bubbles up and crashes the entire Canvas. On failure we just
 *  render nothing and let the ambient + directional lights carry the
 *  scene — not as pretty as IBL but everything stays visible. */
class EnvironmentFallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[Environment] HDR fetch failed, rendering without IBL: ${err.message}`);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
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
  const isOpen = useDesignerStore(s => !!s.windowOpenByWinId[win.id]);
  const toggleWinOpen = useDesignerStore(s => s.toggleWindowOpen);
  // Animation refs:
  //  - sashRef: sliding (translate), casement + wooden (rotate around hinge)
  //  - slatRefs: louvered (per-slat X rotation for blinds tilt)
  const sashRef = useRef<THREE.Group>(null);
  const sashAngleRef = useRef(0);
  const slatRefs = useRef<Array<THREE.Mesh | null>>([]);
  const slatAngleRef = useRef(-0.25); // starting tilt for horizontal slats
  useFrame((_, delta) => {
    const style = win.style ?? "sliding";
    if (style === "sliding" || style === "casement" || style === "wooden") {
      // Sliding (now real 2-panel): sashRef wraps the LEFT half-panel
      // sitting at base position [-winLen/4, 0, 0]. Open = translate by
      // +winLen/2 so left panel ends at +winLen/4, overlapping the
      // fixed right panel. Both half-panels are winLen/2 wide so the
      // sliding one always stays inside the wall hole.
      // Casement + wooden: swing 45° outward around the hinge.
      const target = isOpen
        ? (style === "sliding" ? winLen / 2 : -Math.PI / 4)
        : 0;
      const speed = style === "sliding" ? 2.2 : 3.8;
      const current = sashAngleRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.002) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * delta);
        sashAngleRef.current = current + step;
        if (sashRef.current) {
          if (style === "sliding") {
            // sashRef is the LEFT panel group at base x=-winLen/4. Add
            // sashAngleRef to its base — no scale change needed since
            // each panel is only winLen/2 wide and stays in the hole.
            sashRef.current.position.x = -winLen / 4 + sashAngleRef.current;
          } else {
            sashRef.current.rotation.y = sashAngleRef.current;
          }
        }
      }
    } else if (style === "louvered") {
      // Blinds tilt: closed (= privacy) tilts slats nearly vertical,
      // open tilts them back to the slightly-down horizontal default.
      const target = isOpen ? -Math.PI / 2 + 0.08 : -0.25;
      const current = slatAngleRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.002) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), 3.5 * delta);
        slatAngleRef.current = current + step;
        for (const r of slatRefs.current) {
          if (r) r.rotation.x = slatAngleRef.current;
        }
      }
    }
  });

  // Flat window — thin frame + glass, flush with wall. Interior mullion
  // depends on window style. Style defaults to "sliding" (国内推拉窗).
  const FRAME_THIN = 0.025;
  const WALL_OFFSET = 0.015;
  const style = win.style ?? "sliding";

  // Window frame jambs — INSET into the wall hole (covering the cut
  // edge from inside) instead of protruding outward. Previous design
  // extended each jamb FRAME_THIN/2 (12.5mm) past the hole boundary,
  // which from oblique angles read as "the window pokes out of the
  // wall". Now the frame fully fits inside the wall cutout.
  const frameBars = (
    <>
      {/* Top */}
      <mesh position={[0, winH / 2 - FRAME_THIN / 2, WALL_OFFSET]} castShadow>
        <boxGeometry args={[winLen, FRAME_THIN, 0.02]} />
        <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -winH / 2 + FRAME_THIN / 2, WALL_OFFSET]} castShadow>
        <boxGeometry args={[winLen, FRAME_THIN, 0.02]} />
        <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
      </mesh>
      {/* Left jamb */}
      <mesh position={[-winLen / 2 + FRAME_THIN / 2, 0, WALL_OFFSET]} castShadow>
        <boxGeometry args={[FRAME_THIN, winH - FRAME_THIN * 2, 0.02]} />
        <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
      </mesh>
      {/* Right jamb */}
      <mesh position={[winLen / 2 - FRAME_THIN / 2, 0, WALL_OFFSET]} castShadow>
        <boxGeometry args={[FRAME_THIN, winH - FRAME_THIN * 2, 0.02]} />
        <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
      </mesh>
    </>
  );

  const glass = (
    <mesh position={[0, 0, WALL_OFFSET + 0.002]}>
      <planeGeometry args={[winLen, winH]} />
      <meshPhysicalMaterial color="#BED3E8" transmission={0.7} roughness={0.08} metalness={0} thickness={0.01} ior={1.45} transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );

  // Style-specific mullion geometry
  const mullions = (() => {
    switch (style) {
      case "fixed":
        return null;
      case "sliding": {
        // One or two vertical rails (3-panel if >1.8m wide)
        const panels = winLen > 1.8 ? 3 : 2;
        return Array.from({ length: panels - 1 }).map((_, i) => {
          const x = -winLen / 2 + (winLen / panels) * (i + 1);
          return (
            <mesh key={`rail-${i}`} position={[x, 0, WALL_OFFSET + 0.006]}>
              <boxGeometry args={[0.03, winH, 0.018]} />
              <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
            </mesh>
          );
        });
      }
      case "casement":
        return null; // single integral pane, no mullion
      case "louvered": {
        // Horizontal slats. Each slat gets its own ref so useFrame can
        // tilt them in unison (simulating blinds open/close). Slats are
        // centered on their horizontal axis, so rotating each mesh's
        // rotation.x pivots around its own center — exactly how a real
        // blind slat moves.
        const slatCount = Math.max(4, Math.floor(winH / 0.12));
        const slatH = winH / slatCount;
        return Array.from({ length: slatCount }).map((_, i) => {
          const y = -winH / 2 + slatH / 2 + i * slatH;
          return (
            <mesh
              key={`slat-${i}`}
              ref={r => { slatRefs.current[i] = r; }}
              position={[0, y, WALL_OFFSET + 0.008]}
              rotation={[slatAngleRef.current, 0, 0]}
            >
              <boxGeometry args={[winLen - 0.04, slatH * 0.55, 0.015]} />
              <meshStandardMaterial color="#E8E8E4" roughness={0.6} />
            </mesh>
          );
        });
      }
    }
  })();

  // Procedural sliding window — TWO half-width panels overlap when open.
  // - rightSash is fixed at +winLen/4
  // - leftSash starts at -winLen/4 (closed, both halves visible together)
  //   and animates to +winLen/4 (open, overlapping the right) via sashRef
  // This is a real "两扇推拉" simulation — the moving sash never extends
  // past the wall hole because each panel is only winLen/2 wide.
  const halfGlassMat = (
    <meshPhysicalMaterial
      color="#BED3E8" transmission={0.7} roughness={0.08} metalness={0}
      thickness={0.01} ior={1.45} transparent opacity={0.5}
      side={THREE.DoubleSide}
    />
  );
  const halfPanel = (
    <>
      <mesh position={[0, 0, WALL_OFFSET + 0.002]}>
        <planeGeometry args={[winLen / 2, winH]} />
        {halfGlassMat}
      </mesh>
      {/* Mid mullion of the panel (cosmetic — gives sliding window its
          characteristic look) */}
      <mesh position={[0, 0, WALL_OFFSET + 0.006]}>
        <boxGeometry args={[0.022, winH - FRAME_THIN * 2, 0.018]} />
        <meshStandardMaterial color="#F4F4F2" roughness={0.55} />
      </mesh>
    </>
  );

  const proceduralBackFrame = (
    <>
      {frameBars}
      {style === "sliding" ? (
        <>
          {/* Fixed right panel */}
          <group
            position={[winLen / 4, 0, 0]}
            onClick={(e) => { e.stopPropagation(); toggleWinOpen(win.id); }}
          >
            {halfPanel}
          </group>
          {/* Sliding left panel — sashRef applies the open animation */}
          <group
            ref={sashRef}
            position={[-winLen / 4, 0, 0]}
            onClick={(e) => { e.stopPropagation(); toggleWinOpen(win.id); }}
          >
            {halfPanel}
          </group>
        </>
      ) : (
        // Other styles: single full-width sash with style-specific mullions.
        <group
          ref={sashRef}
          onClick={(e) => { e.stopPropagation(); toggleWinOpen(win.id); }}
        >
          {style !== "louvered" && glass}
          {mullions}
        </group>
      )}
    </>
  );

  // Pick a glTF for this style (or null → use procedural-only). For
  // openable styles (sliding/casement) we wrap the glTF inside `sashRef`
  // so clicking it actually animates. Fixed + security render glTF
  // statically without a sash.
  const gltfSpec = ENABLE_GLTF_WINDOW ? gltfSpecForStyle(style) : null;
  const gltfContent = gltfSpec ? (
    <ArchWindowFallback fallback={proceduralBackFrame}>
      <Suspense fallback={proceduralBackFrame}>
        <GltfArchWindow winLen={winLen} winH={winH} url={gltfSpec.url} />
      </Suspense>
    </ArchWindowFallback>
  ) : null;

  const animatesOpen = style === "sliding" || style === "casement" || style === "wooden";
  const windowFrameJSX = gltfContent ? (
    animatesOpen ? (
      // The glTF already includes its own outer frame — wrap only in sash
      // group so click toggles the open/close animation.
      <group
        ref={sashRef}
        onClick={(e) => { e.stopPropagation(); toggleWinOpen(win.id); }}
      >
        {gltfContent}
      </group>
    ) : (
      // Fixed / security: static glTF + click toggles (noop animation).
      <group onClick={(e) => { e.stopPropagation(); toggleWinOpen(win.id); }}>
        {gltfContent}
      </group>
    )
  ) : proceduralBackFrame;

  if (win.wall === "back") {
    // back wall: X axis runs from -W/2 to W/2, window pos is from left (0) to right (W)
    const xc = winCenter - W / 2;
    return (
      <group position={[xc, winY, -D / 2]}>
        {windowFrameJSX}
        {/* Directional "sunlight" aimed INTO the room from outside */}
        <directionalLight
          position={[0, 0.3, -0.5]}
          target-position={[0, -1.5, 2]}
          intensity={0.8}
          color="#FFF2D0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-winLen}
          shadow-camera-right={winLen}
          shadow-camera-top={winH}
          shadow-camera-bottom={-winH}
          shadow-bias={-0.001}
        />
      </group>
    );
  }

  if (win.wall === "right") {
    const zc = winCenter - D / 2;
    // Right-wall orientation: rotate the shared glTF/procedural frame by
    // 90° around Y so its local X axis aligns with room Z. Emissive plane
    // stays in its original orientation (aligned to the wall's inside face).
    return (
      <group position={[W / 2, winY, zc]}>
        <group rotation={[0, -Math.PI / 2, 0]}>
          {windowFrameJSX}
        </group>
        <directionalLight
          position={[0.5, 0.3, 0]}
          target-position={[-2, -1.5, 0]}
          intensity={0.8}
          color="#FFF2D0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-winLen}
          shadow-camera-right={winLen}
          shadow-camera-top={winH}
          shadow-camera-bottom={-winH}
          shadow-bias={-0.001}
        />
      </group>
    );
  }

  if (win.wall === "left") {
    const zc = winCenter - D / 2;
    return (
      <group position={[-W / 2, winY, zc]}>
        <group rotation={[0, Math.PI / 2, 0]}>
          {windowFrameJSX}
        </group>
        <directionalLight
          position={[-0.5, 0.3, 0]}
          target-position={[2, -1.5, 0]}
          intensity={0.8}
          color="#FFF2D0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-winLen}
          shadow-camera-right={winLen}
          shadow-camera-top={winH}
          shadow-camera-bottom={-winH}
          shadow-bias={-0.001}
        />
      </group>
    );
  }

  return null;
}

// ─── glTF door panel (for wood_panel style) ─────────────────
// Uses witnessk's `door_with_frame` (CC-BY, 6 meshes — includes panel +
// frame + handle, a complete door unit). Uniform scale by height (not
// non-uniform XYZ fit — that distorted the earlier keam.wf asset into a
// "plank stack").
const ENABLE_GLTF_DOOR = true;
const WOODEN_DOOR_URL = "/models/_arch_door/door_with_frame/door_with_frame.gltf";

function GltfDoorPanel({ doorW, doorH, onClick }: { doorW: number; doorH: number; onClick: () => void }) {
  const { scene } = useGLTF(WOODEN_DOOR_URL) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    // eslint-disable-next-line no-console
    console.log(`[GltfDoorPanel] native ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m target ${doorW.toFixed(2)}×${doorH.toFixed(2)}m`);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      // Uniform scale by height. This preserves the door's natural
      // width:height:depth ratio instead of stretching it to match our
      // doorW × doorH (which distorts). Slight width mismatch is
      // acceptable — a 75cm real door rendered as ~72cm is fine.
      const s = doorH / size.y;
      c.scale.setScalar(s);
      c.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(c);
      // Base at Y=0, X-centered, then shift right so left edge = hinge
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.y -= box2.min.y;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
      c.position.x += doorW / 2;
    }
    return c;
  }, [scene, doorW, doorH]);

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <primitive object={cloned} />
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

/** 3-blade ceiling fan that spins continuously. */
function CeilingFanBlades() {
  const bladesRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (bladesRef.current) bladesRef.current.rotation.y += delta * 3.5; // ~35 RPM-ish
  });
  return (
    <group ref={bladesRef} position={[0, 0, 0]}>
      {[0, 1, 2].map(i => {
        const angle = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(angle) * 0.38, 0, Math.sin(angle) * 0.38]} rotation={[0, -angle, -0.08]}>
            <boxGeometry args={[0.6, 0.01, 0.1]} />
            <meshStandardMaterial color="#C8A882" roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Interior door (3D) with click-to-open animation ────────
// Renders a door panel inside the wall's door hole. The panel is hinged
// on its left edge (opens inward 90°). Click toggles open/closed; a
// useFrame interpolation gives a ~350ms ease. Open state is per-room
// ephemeral state in the store (doorOpenByRoom).
function RoomDoor3D({
  W, D, H,
  doorWall, doorPosCm, doorLenCm, doorHCm,
  activeRoom, doorStyle,
}: {
  W: number; D: number; H: number;
  doorWall: "bottom" | "top" | "left" | "right";
  doorPosCm: number; doorLenCm: number; doorHCm: number;
  activeRoom: RoomType;
  doorStyle: import("@/lib/types").DoorStyle;
}) {
  const isOpen = useDesignerStore(s => !!s.doorOpenByRoom[activeRoom]);
  const toggleDoorOpen = useDesignerStore(s => s.toggleDoorOpen);
  const panelRef = useRef<THREE.Group>(null);
  // Animated value, smoothed each frame toward the target.
  // For hinged doors: used as rotation angle (0 → -π/2).
  // For sliding doors: used as translation distance (0 → -doorW).
  const animRef = useRef(0);
  useFrame((_, delta) => {
    const isSliding = doorStyle === "sliding_barn";
    const target = isOpen ? (isSliding ? -(doorLenCm / 100) : -Math.PI / 2) : 0;
    const speed = isSliding ? 2.4 : 5.5;
    const current = animRef.current;
    const diff = target - current;
    if (Math.abs(diff) > 0.002) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * delta);
      animRef.current = current + step;
      if (panelRef.current) {
        if (isSliding) panelRef.current.position.x = animRef.current;
        else panelRef.current.rotation.y = animRef.current;
      }
    }
  });

  const doorW = doorLenCm / 100;
  const doorH = doorHCm / 100;
  const doorPos = doorPosCm / 100;
  const frameT = 0.04; // frame thickness

  // Group positioning: put a parent group at the hinge line (inner-room
  // side of the wall, at the door's left edge). All internal pieces are
  // positioned relative to the hinge so rotating the group swings the door.
  let groupPos: [number, number, number];
  let groupRot: [number, number, number];
  let hingeOffset: number; // direction the panel extends in local +X when closed
  switch (doorWall) {
    case "top": // back wall (z = -D/2)
      groupPos = [doorPos - W / 2, 0, -D / 2 + 0.02];
      groupRot = [0, 0, 0];
      hingeOffset = 1;
      break;
    case "bottom": // front wall (z = +D/2) — normally hidden wall but
      // door itself should still render so it's visible in dollhouse.
      // Rotate 180° around Y so door faces room interior (-Z).
      // Position: door's LEFT edge (from outside) at world X = -W/2 + doorPos.
      // With rotation π, local +X → world -X, so group origin sits at the
      // door's right edge in world: -W/2 + doorPos + doorW.
      groupPos = [-W / 2 + doorPos + doorW, 0, D / 2 - 0.02];
      groupRot = [0, Math.PI, 0];
      hingeOffset = 1;
      break;
    case "left":
      groupPos = [-W / 2 + 0.02, 0, doorPos - D / 2];
      groupRot = [0, Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    case "right":
      groupPos = [W / 2 - 0.02, 0, -(doorPos - D / 2) - doorW];
      groupRot = [0, -Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    default:
      return null;
  }

  return (
    <group position={groupPos} rotation={groupRot}>
      {/* Door frame (stays fixed, inside the wall hole) */}
      <mesh position={[doorW / 2, doorH + frameT / 2, 0]}>
        <boxGeometry args={[doorW + frameT * 2, frameT, 0.05]} />
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>
      <mesh position={[-frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>
      <mesh position={[doorW + frameT / 2, doorH / 2, 0]}>
        <boxGeometry args={[frameT, doorH, 0.05]} />
        <meshStandardMaterial color="#F0EEEA" roughness={0.6} />
      </mesh>

      {/* Door panel (rotates around hinge at local X=0) */}
      {doorStyle === "sliding_barn" ? (
        // Sliding barn door: slides left (no swing). panelRef unused for rotation;
        // instead translate via useFrame (we already drive angleRef — reuse as
        // slide ratio 0→1 mapped to translation).
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {/* Top slide rail (doesn't move) */}
          <mesh position={[doorW, doorH + 0.08, 0]}>
            <boxGeometry args={[doorW * 2.1, 0.06, 0.04]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Sliding panel */}
          <mesh
            position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
            onClick={(e) => { e.stopPropagation(); toggleDoorOpen(activeRoom); }}
            castShadow receiveShadow
          >
            <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.04]} />
            <meshStandardMaterial color="#7A5438" roughness={0.85} />
          </mesh>
          {/* Barn door: 3 horizontal planks + iron strap */}
          {[0.25, 0.5, 0.75].map((r, i) => (
            <mesh key={i} position={[doorW / 2, doorH * r, 0.005]}>
              <boxGeometry args={[doorW - 0.04, 0.015, 0.008]} />
              <meshStandardMaterial color="#5C3E28" roughness={0.9} />
            </mesh>
          ))}
          {/* Handle: long iron bar */}
          <mesh position={[doorW - 0.12, doorH * 0.45, 0.03]}>
            <boxGeometry args={[0.14, 0.03, 0.015]} />
            <meshStandardMaterial color="#2A2A2A" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ) : doorStyle === "french_double" ? (
        // French double: two glass panels hinged from each outer edge.
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {/* Left panel (hinged at x=0) */}
          <group
            onClick={(e) => { e.stopPropagation(); toggleDoorOpen(activeRoom); }}
          >
            <mesh position={[doorW / 4, doorH / 2, -0.02]} castShadow>
              <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.02, 0.025]} />
              <meshStandardMaterial color="#F0F0F0" roughness={0.5} />
            </mesh>
            <mesh position={[doorW / 4, doorH / 2, -0.005]}>
              <planeGeometry args={[doorW / 2 - 0.1, doorH - 0.15]} />
              <meshPhysicalMaterial color="#C8D8E5" transmission={0.75} roughness={0.05} thickness={0.02} transparent opacity={0.6} />
            </mesh>
          </group>
          {/* Right panel */}
          <mesh position={[doorW * 0.75, doorH / 2, -0.02]} castShadow>
            <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.02, 0.025]} />
            <meshStandardMaterial color="#F0F0F0" roughness={0.5} />
          </mesh>
          <mesh position={[doorW * 0.75, doorH / 2, -0.005]}>
            <planeGeometry args={[doorW / 2 - 0.1, doorH - 0.15]} />
            <meshPhysicalMaterial color="#C8D8E5" transmission={0.75} roughness={0.05} thickness={0.02} transparent opacity={0.6} />
          </mesh>
          {/* Two knobs at center */}
          <mesh position={[doorW / 2 - 0.04, doorH * 0.45, 0.02]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh position={[doorW / 2 + 0.04, doorH * 0.45, 0.02]}>
            <sphereGeometry args={[0.02, 10, 10]} />
            <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      ) : (
        // Default: wood_panel uses real glTF; frosted_glass uses procedural
        // (it's a glass-look tinted box — glTF wouldn't match semantics).
        <group ref={panelRef} position={[0, 0, 0.01]}>
          {doorStyle === "wood_panel" ? (
            ENABLE_GLTF_DOOR ? (
              <>
                <GltfDoorFallback
                  fallback={
                    <ProceduralWoodDoor
                      doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                      onClick={() => toggleDoorOpen(activeRoom)}
                    />
                  }
                >
                  <Suspense fallback={
                    <ProceduralWoodDoor
                      doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                      onClick={() => toggleDoorOpen(activeRoom)}
                    />
                  }>
                    <GltfDoorPanel doorW={doorW} doorH={doorH} onClick={() => toggleDoorOpen(activeRoom)} />
                  </Suspense>
                </GltfDoorFallback>
                {/* Extra handle on both faces of the door so it's always
                    visible regardless of which way the glTF asset was
                    exported. Two small spheres + short stem. */}
                <mesh position={[doorW - 0.1, doorH * 0.45, 0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.25} />
                </mesh>
                <mesh position={[doorW - 0.1, doorH * 0.45, -0.035]}>
                  <sphereGeometry args={[0.032, 14, 14]} />
                  <meshStandardMaterial color="#B8A060" metalness={0.85} roughness={0.25} />
                </mesh>
              </>
            ) : (
              <ProceduralWoodDoor
                doorW={doorW} doorH={doorH} hingeOffset={hingeOffset}
                onClick={() => toggleDoorOpen(activeRoom)}
              />
            )
          ) : (
            // frosted_glass — aluminum frame + semi-transparent glass panel
            <>
              {/* Aluminum frame around the edge — makes the door outline
                  clearly visible even when glass is semi-transparent */}
              <mesh position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]} castShadow receiveShadow>
                <boxGeometry args={[doorW - 0.02, doorH - 0.02, 0.035]} />
                <meshStandardMaterial color="#A8AEB4" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Glass inset — slightly smaller than frame, semi-transparent */}
              <mesh
                position={[doorW / 2 * hingeOffset, doorH / 2, -0.02]}
                onClick={(e) => { e.stopPropagation(); toggleDoorOpen(activeRoom); }}
              >
                <boxGeometry args={[doorW - 0.12, doorH - 0.15, 0.04]} />
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
              <mesh position={[doorW - 0.08, doorH * 0.45, -0.045]}>
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

// ─── Light fixture ─────────────────────────────────────────
function LightFixture({ H, lightColor, lightId, lightX = 0, lightZ = 0 }: {
  H: number; lightColor: string; lightId: string;
  lightX?: number; lightZ?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const activeRoom = useDesignerStore(s => s.activeRoom);
  const isOn = useDesignerStore(s => s.lightsOnByRoom[activeRoom] !== false);
  const toggle = useDesignerStore(s => s.toggleRoomLights);
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[activeRoom] ?? 1);
  const colorOverride = useDesignerStore(s => s.lightColorByRoom[activeRoom]);
  const finalColor = colorOverride ?? lightColor;
  useFrame((_, delta) => {
    if (ref.current && lightId === "light-chandelier") {
      ref.current.rotation.y += delta * 0.15;
    }
  });
  return (
    <group position={[lightX, 0, lightZ]}>
      {/* Invisible hit proxy — a big sphere just below the ceiling that
          captures clicks for turning the light on/off. The fixture
          geometry itself is small (cones, bars) and hard to hit
          accurately; this wraps the whole area so clicking "near the
          light" works. Not visible (opacity 0), doesn't receive shadows. */}
      <mesh
        position={[0, H - 0.35, 0]}
        onClick={(e) => { e.stopPropagation(); toggle(activeRoom); }}
        onPointerOver={(e) => { (e.object as THREE.Mesh).userData.hover = true; }}
      >
        <sphereGeometry args={[0.6, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <LightFixtureInner
        H={H} lightColor={finalColor} lightId={lightId}
        chandelierRef={ref} isOn={isOn} brightness={brightness}
      />
    </group>
  );
}

function LightFixtureInner({ H, lightColor, lightId, chandelierRef, isOn, brightness = 1 }: {
  H: number; lightColor: string; lightId: string;
  chandelierRef: React.RefObject<THREE.Mesh | null>;
  /** When false, every emissive material and spot/point light in the
   *  fixture gets multiplied by 0. */
  isOn: boolean;
  /** Global multiplier applied to BOTH emissiveIntensity and pointLight
   *  intensity. User-controlled in RightPanel (0.3–2.0). */
  brightness?: number;
}) {
  const ref = chandelierRef;
  const em = isOn ? brightness : 0;
  const bm = isOn ? brightness : 0;

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
            <spotLight visible={isOn} position={[x, H - 0.22, 0]} target-position={[x, 0, 0]} intensity={6 * bm} angle={0.35} penumbra={0.4} color="#FFF2D8" castShadow shadow-mapSize={[512, 512]} />
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
          <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.6 * em} roughness={0.1} metalness={0.2} transparent opacity={0.88} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
          <meshStandardMaterial color="#AAA" metalness={0.9} roughness={0.2} />
        </mesh>
        <pointLight visible={isOn} position={[0, H - 0.22, 0]} intensity={10 * bm} color={lightColor} distance={5} decay={2} castShadow />
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
        <pointLight visible={isOn} position={[0, H - 0.25, 0]} intensity={9 * bm} color={lightColor} distance={5} decay={2} castShadow />
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
          <meshStandardMaterial color="#F5EDD0" emissive="#F5EDD0" emissiveIntensity={0.18 * em} roughness={0.92} transparent opacity={0.88} />
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
        <pointLight visible={isOn} position={[0, H - 0.22, 0]} intensity={7 * bm} color="#FFF0C0" distance={5} decay={2} castShadow />
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
              <meshStandardMaterial color="#F5C060" emissive="#F5A020" emissiveIntensity={0.9 * em} roughness={0.05} transparent opacity={0.82} />
            </mesh>
            {/* Filament glow */}
            <pointLight visible={isOn} position={[bx, H - 0.5 + Math.abs(by), 0]} intensity={2.5 * bm} color="#FF9800" distance={3} decay={2} />
          </group>
        ))}
        {/* Main area light */}
        <pointLight visible={isOn} position={[0, H - 0.55, 0]} intensity={6 * bm} color="#FFB347" distance={5} decay={2} castShadow />
      </group>
    );
  }

  // Ceiling fan with rotating blades (+ embedded light)
  if (lightId === "light-ceiling-fan") {
    return (
      <group position={[0, H - 0.35, 0]}>
        {/* Mount rod from ceiling */}
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.28, 6]} />
          <meshStandardMaterial color="#E0E0E0" metalness={0.3} roughness={0.5} />
        </mesh>
        {/* Motor housing */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.09, 0.12, 0.12, 16]} />
          <meshStandardMaterial color="#D8D8D8" roughness={0.45} metalness={0.12} />
        </mesh>
        {/* Rotating blade assembly */}
        <CeilingFanBlades />
        {/* Light below motor */}
        <mesh position={[0, -0.06, 0]}>
          <sphereGeometry args={[0.08, 14, 12]} />
          <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.55 * em} roughness={0.25} transparent opacity={0.85} />
        </mesh>
        <pointLight visible={isOn} position={[0, -0.06, 0]} intensity={6 * bm} color={lightColor} distance={4.5} decay={2} castShadow />
      </group>
    );
  }

  // Modern ring pendant — LED ring + thin suspension cords
  if (lightId === "light-ring-modern") {
    return (
      <group position={[0, H - 0.18, 0]}>
        {/* Canopy */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.03, 12]} />
          <meshStandardMaterial color="#2A2A2A" metalness={0.75} roughness={0.3} />
        </mesh>
        {/* Three suspension cords */}
        {[0, 120, 240].map(deg => {
          const rad = (deg * Math.PI) / 180;
          return (
            <mesh key={deg} position={[Math.cos(rad) * 0.25, 0.02, Math.sin(rad) * 0.25]}>
              <cylinderGeometry args={[0.002, 0.002, 0.26, 4]} />
              <meshStandardMaterial color="#333" />
            </mesh>
          );
        })}
        {/* LED ring (emissive torus) */}
        <mesh position={[0, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.32, 0.025, 16, 40]} />
          <meshStandardMaterial
            color={lightColor} emissive={lightColor}
            emissiveIntensity={0.9 * em} roughness={0.2} metalness={0.1}
          />
        </mesh>
        <pointLight visible={isOn} position={[0, -0.12, 0]} intensity={9 * bm} color={lightColor} distance={5} decay={2} castShadow />
      </group>
    );
  }

  // Crystal chandelier — multi-tier with dangling "crystals" (small spheres)
  if (lightId === "light-crystal-chandelier") {
    const crystalPositions: Array<[number, number, number]> = [];
    for (let ring = 0; ring < 2; ring++) {
      const r = 0.18 + ring * 0.12;
      const y = -0.1 - ring * 0.08;
      const count = 10 + ring * 4;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        crystalPositions.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      }
    }
    return (
      <group position={[0, H - 0.25, 0]}>
        {/* Canopy cord */}
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.4, 6]} />
          <meshStandardMaterial color="#C8A060" metalness={0.75} roughness={0.3} />
        </mesh>
        {/* Central hub */}
        <mesh position={[0, -0.02, 0]} ref={ref}>
          <cylinderGeometry args={[0.08, 0.05, 0.12, 12]} />
          <meshStandardMaterial color="#D4A862" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Crystal drops */}
        {crystalPositions.map((p, i) => (
          <mesh key={i} position={p}>
            <octahedronGeometry args={[0.025, 0]} />
            <meshPhysicalMaterial
              color="#F8F4E0" transmission={0.7} roughness={0.05}
              thickness={0.02} ior={1.52} transparent opacity={0.85}
              emissive={lightColor} emissiveIntensity={0.3 * em}
            />
          </mesh>
        ))}
        <pointLight visible={isOn} position={[0, -0.1, 0]} intensity={12 * bm} color={lightColor} distance={6} decay={2} castShadow />
      </group>
    );
  }

  // Magnetic track light — recessed channel + 4 spot heads along it
  if (lightId === "light-magnetic-track") {
    return (
      <group position={[0, H - 0.04, 0]}>
        {/* Recessed channel (dark inset) */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1.6, 0.04, 0.08]} />
          <meshStandardMaterial color="#1A1A1A" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* 4 spot heads */}
        {[-0.6, -0.2, 0.2, 0.6].map((x, i) => (
          <group key={i} position={[x, -0.04, 0]}>
            <mesh>
              <cylinderGeometry args={[0.035, 0.05, 0.09, 10]} />
              <meshStandardMaterial color="#2A2A2A" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh position={[0, -0.045, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.01, 10]} />
              <meshStandardMaterial
                color={lightColor} emissive={lightColor}
                emissiveIntensity={1.2 * em} roughness={0.15}
              />
            </mesh>
            <spotLight visible={isOn} position={[x, -0.08, 0]} target-position={[x, 0, 0]} intensity={4 * bm} angle={0.4} penumbra={0.5} color={lightColor} castShadow shadow-mapSize={[512, 512]} />
          </group>
        ))}
      </group>
    );
  }

  // Smart main panel — large square LED panel flush with ceiling
  if (lightId === "light-smart-panel") {
    return (
      <group position={[0, H - 0.03, 0]}>
        {/* Aluminum frame */}
        <mesh>
          <boxGeometry args={[0.9, 0.04, 0.9]} />
          <meshStandardMaterial color="#D8D8D8" metalness={0.5} roughness={0.4} />
        </mesh>
        {/* Diffuser panel (emissive) */}
        <mesh position={[0, -0.021, 0]}>
          <boxGeometry args={[0.82, 0.005, 0.82]} />
          <meshStandardMaterial
            color={lightColor} emissive={lightColor}
            emissiveIntensity={0.8 * em} roughness={0.4} opacity={0.92} transparent
          />
        </mesh>
        <pointLight visible={isOn} position={[0, -0.06, 0]} intensity={11 * bm} color={lightColor} distance={6} decay={2} castShadow />
      </group>
    );
  }

  // Recessed downlights — 4 cans arranged in a 2×2 grid, emitting cones
  if (lightId === "light-recessed") {
    const positions: Array<[number, number]> = [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
    return (
      <group position={[0, H - 0.01, 0]}>
        {positions.map(([x, z], i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh>
              <cylinderGeometry args={[0.045, 0.055, 0.02, 14]} />
              <meshStandardMaterial color="#E8E8E8" metalness={0.2} roughness={0.55} />
            </mesh>
            <mesh position={[0, -0.013, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.005, 14]} />
              <meshStandardMaterial
                color={lightColor} emissive={lightColor}
                emissiveIntensity={1.0 * em} roughness={0.2}
              />
            </mesh>
            <spotLight visible={isOn} position={[x, -0.03, z]} target-position={[x, 0, z]} intensity={3 * bm} angle={0.5} penumbra={0.6} color={lightColor} castShadow shadow-mapSize={[512, 512]} />
          </group>
        ))}
      </group>
    );
  }

  // Default pendant — bulb hangs ~35cm below ceiling, cord connects
  // bulb top to a canopy plate mounted on the ceiling.
  const DROP = 0.45;  // distance from ceiling to bulb center
  const R    = 0.14;  // bulb radius
  const cordTop   = DROP;           // attaches to ceiling in group coords
  const cordBot   = R;              // attaches to top of bulb
  const cordLen   = cordTop - cordBot;
  const cordY     = (cordTop + cordBot) / 2;
  return (
    <group position={[0, H - DROP, 0]}>
      {/* Ceiling canopy (mounting plate) */}
      <mesh position={[0, DROP, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.015, 12]} />
        <meshStandardMaterial color="#E0E0E0" metalness={0.3} roughness={0.6} />
      </mesh>
      {/* Cord */}
      <mesh position={[0, cordY, 0]}>
        <cylinderGeometry args={[0.006, 0.006, cordLen, 6]} />
        <meshStandardMaterial color="#8A8A8A" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Bulb (frosted glass, emissive) */}
      <mesh>
        <sphereGeometry args={[R, 20, 20]} />
        <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.9 * em} roughness={0.15} transparent opacity={0.85} />
      </mesh>
      <pointLight visible={isOn} position={[0, 0, 0]} intensity={8 * bm} color={lightColor} distance={4.8} decay={2} castShadow />
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

function TvUnit({ color, sc, w, d, h, imageUrl }: MeshProps & { imageUrl?: string }) {
  const leg = shade(color, -20);
  const handle = "#B0B0B0";
  const bodyH = h * 0.45;
  const wood = useMemo(() => { const t = woodMap(color, "horizontal").clone(); t.repeat.set(Math.max(1, w * 0.9), 1); t.needsUpdate = true; return t; }, [color, w]);
  // Screen content texture — if imageUrl set, display it as if powered on
  const screenTex = useArtworkTexture(imageUrl);
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
      {/* TV screen — black bezel + screen. Screen either displays
          imageUrl as if powered on, or a neutral off-state color. */}
      <mesh position={[0, bodyH + h * 0.5, -d * 0.05]} castShadow>
        <boxGeometry args={[w * 0.85, h * 0.9, 0.055]} />
        <meshStandardMaterial color="#0A0C12" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, bodyH + h * 0.5, -d * 0.05 + 0.031]}>
        <planeGeometry args={[w * 0.81, h * 0.85]} />
        {screenTex ? (
          <meshStandardMaterial map={screenTex} emissive="#FFFFFF" emissiveMap={screenTex} emissiveIntensity={0.55} roughness={0.25} />
        ) : (
          <meshStandardMaterial color="#0A1520" metalness={0.1} roughness={0.05} transparent opacity={0.9} />
        )}
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

function FloorLamp({ color, w, d, h, instanceId }: MeshProps & { instanceId?: string }) {
  // Per-instance on/off — clicking the shade toggles this specific lamp.
  // Without instanceId (e.g. in template previews), lamp stays always-on.
  const off = useDesignerStore(s => instanceId ? s.fixtureOffById[instanceId] : false);
  const toggle = useDesignerStore(s => s.toggleFixture);
  const activeRoom = useDesignerStore(s => s.activeRoom);
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[activeRoom] ?? 1);
  const mul = off ? 0 : brightness;
  const clickable = (e: any) => {
    if (!instanceId) return;
    e.stopPropagation();
    toggle(instanceId);
  };
  return (
    <group onClick={clickable}>
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
      {/* Shade — emissive when on */}
      <mesh position={[0, h - 0.12, 0]} castShadow>
        <cylinderGeometry args={[w * 0.42, w * 0.28, h * 0.25, 10]} />
        <meshStandardMaterial
          color="#F5EED8"
          emissive="#FFE8B0"
          emissiveIntensity={0.3 * mul}
          roughness={0.82}
          transparent opacity={0.88}
        />
      </mesh>
      <pointLight visible={mul > 0} position={[0, h - 0.18, 0]} intensity={4 * mul} color="#FFF0D0" distance={3} decay={2} />
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

function Artwork({ color, w, h, imageUrl }: MeshProps & { imageUrl?: string }) {
  // Paintings are small on a wall and often end up in dim ambient light,
  // making them read as "dark blobs". Use self-lit emissive for the
  // canvas so the painting is always visible at full colour regardless
  // of room lighting — sacrifices realistic shading for legibility,
  // which is the right trade-off in an interior-design decision tool.
  const tex = useArtworkTexture(imageUrl);
  return (
    <group>
      {/* Dark wood frame */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[w + 0.04, h + 0.04, 0.025]} />
        <meshStandardMaterial color="#3A2A1E" roughness={0.65} />
      </mesh>
      {/* Canvas — unlit when we have an image (colors guaranteed correct),
          standard-shaded otherwise so the color still fits room lighting. */}
      <mesh position={[0, 0, 0.015]} castShadow>
        <planeGeometry args={[w, h]} />
        {tex ? (
          <meshBasicMaterial map={tex} toneMapped={true} />
        ) : (
          <meshStandardMaterial color={color} roughness={0.78} />
        )}
      </mesh>
    </group>
  );
}

// Lazy-loaded texture with error fallback (returns null if load fails).
function useArtworkTexture(url: string | undefined): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    loader.load(
      url,
      t => {
        if (cancelled) return;
        // sRGB color space for artwork photos so colors render true
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      err => console.warn(`[Artwork] failed to load ${url}:`, err)
    );
    return () => { cancelled = true; };
  }, [url]);
  return tex;
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

function FurnitureMesh({ item, w, d, h, instanceId }: { item: FurnitureItem; w: number; d: number; h: number; instanceId?: string }) {
  const props: MeshProps = { color: item.color, sc: item.secondaryColor, w, d, h };
  switch (item.category) {
    case "sofa":             return <Sofa {...props} />;
    case "coffee_table":    return <CoffeeTable {...props} />;
    case "tv_unit":         return <TvUnit {...props} imageUrl={item.imageUrl} />;
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
    case "floor_lamp":      return <FloorLamp {...props} instanceId={instanceId} />;
    case "plant":           return <Plant {...props} />;
    case "rug":             return <Rug {...props} />;
    case "artwork":         return <Artwork {...props} imageUrl={item.imageUrl} />;
    case "sideboard":       return <CoffeeTable {...props} />;
    case "bath_accessory":  return <BathAccessory item={item} w={w} d={d} h={h} />;
    case "electrical":      return <ElectricalFixture item={item} w={w} d={d} h={h} />;
    case "plumbing":        return <PlumbingFixture item={item} w={w} d={d} h={h} />;
    default:                return <GenericBox {...props} category={item.category} />;
  }
}

// ─── Bath accessories (shower head / basin faucet) ─────────
function BathAccessory({ item, w, d, h }: { item: FurnitureItem; w: number; d: number; h: number }) {
  if (item.id === "shower-head") {
    // Wall-mounted rail + handheld + overhead shower
    return (
      <group>
        {/* Vertical rail */}
        <mesh position={[0, h / 2, d * 0.3]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, h * 0.9, 10]} />
          <meshStandardMaterial color="#C8C8C8" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Handheld head */}
        <mesh position={[w * 0.2, h * 0.3, d * 0.3]} rotation={[0, 0, 0.4]}>
          <cylinderGeometry args={[0.025, 0.035, h * 0.18, 10]} />
          <meshStandardMaterial color="#C8C8C8" metalness={0.8} roughness={0.25} />
        </mesh>
        {/* Overhead rainfall */}
        <mesh position={[0, h * 0.95, d * 0.3]} rotation={[Math.PI, 0, 0]}>
          <cylinderGeometry args={[w * 0.4, w * 0.38, 0.025, 14]} />
          <meshStandardMaterial color="#C8C8C8" metalness={0.85} roughness={0.2} />
        </mesh>
      </group>
    );
  }
  // Basin faucet: arched spout + lever
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[w * 0.4, w * 0.4, 0.04, 12]} />
        <meshStandardMaterial color={item.color} metalness={0.85} roughness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.45, 0]}>
        <cylinderGeometry args={[0.012, 0.015, h * 0.9, 10]} />
        <meshStandardMaterial color={item.color} metalness={0.85} roughness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.92, d * 0.15]}>
        <boxGeometry args={[0.03, 0.02, d * 0.3]} />
        <meshStandardMaterial color={item.color} metalness={0.85} roughness={0.2} />
      </mesh>
      {/* Lever */}
      <mesh position={[w * 0.22, h * 0.48, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[w * 0.35, 0.02, 0.02]} />
        <meshStandardMaterial color={item.color} metalness={0.85} roughness={0.25} />
      </mesh>
    </group>
  );
}

// ─── Electrical point fixtures (outlets / switches / panels / jacks) ──
function ElectricalFixture({ item, w, d, h }: { item: FurnitureItem; w: number; d: number; h: number }) {
  const isPanel = item.id === "breaker-panel" || item.id === "weak-panel";
  const isSwitch = item.id.startsWith("switch-");
  if (isPanel) {
    return (
      <group>
        <mesh position={[0, h / 2, d / 2]} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#E0E0E0" roughness={0.5} metalness={0.2} />
        </mesh>
        {/* Door with hinge line */}
        <mesh position={[0, h / 2, d + 0.002]}>
          <boxGeometry args={[w * 0.95, h * 0.95, 0.005]} />
          <meshStandardMaterial color="#D8D8D8" roughness={0.55} />
        </mesh>
        {/* Label plate */}
        <mesh position={[0, h * 0.85, d + 0.005]}>
          <boxGeometry args={[w * 0.3, h * 0.1, 0.002]} />
          <meshStandardMaterial color={item.id === "breaker-panel" ? "#F0B020" : "#3080E0"} roughness={0.4} />
        </mesh>
      </group>
    );
  }
  // 86-型 outlet/switch/jack face plate
  return (
    <group>
      {/* Face plate */}
      <mesh position={[0, h / 2, d / 2 + 0.005]}>
        <boxGeometry args={[w, h, Math.max(0.01, d)]} />
        <meshStandardMaterial color="#F8F8F8" roughness={0.45} />
      </mesh>
      {/* Inset frame */}
      <mesh position={[0, h / 2, d + 0.003]}>
        <boxGeometry args={[w * 0.85, h * 0.85, 0.002]} />
        <meshStandardMaterial color="#E8E8E8" roughness={0.55} />
      </mesh>
      {/* Content: 5-hole outlet / rocker switch / jack */}
      {isSwitch ? (
        <mesh position={[0, h / 2, d + 0.006]}>
          <boxGeometry args={[w * 0.6, h * 0.5, 0.004]} />
          <meshStandardMaterial color="#FDFDFD" roughness={0.3} />
        </mesh>
      ) : item.id === "outlet-2pin" || item.id === "outlet-usb" ? (
        <>
          {/* 5 pinholes */}
          {[[-w * 0.22, h * 0.35], [-w * 0.05, h * 0.35], [w * 0.1, h * 0.42], [w * 0.1, h * 0.28], [w * 0.22, h * 0.35]]
            .map((p, i) => (
              <mesh key={i} position={[p[0], p[1], d + 0.006]}>
                <boxGeometry args={[w * 0.04, h * 0.05, 0.003]} />
                <meshStandardMaterial color="#333" />
              </mesh>
            ))}
          {item.id === "outlet-usb" && (
            <mesh position={[0, h * 0.7, d + 0.006]}>
              <boxGeometry args={[w * 0.45, h * 0.06, 0.003]} />
              <meshStandardMaterial color="#2A2A2A" />
            </mesh>
          )}
        </>
      ) : (
        // Jack (network/TV)
        <mesh position={[0, h / 2, d + 0.006]}>
          <boxGeometry args={[w * 0.4, h * 0.25, 0.005]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      )}
    </group>
  );
}

// ─── Plumbing point fixtures (supply / drain / vent) ──────────
function PlumbingFixture({ item, w, d, h }: { item: FurnitureItem; w: number; d: number; h: number }) {
  if (item.id === "drain-point" || item.id === "floor-drain") {
    // Floor drain — metal grate
    return (
      <group>
        <mesh position={[0, h / 2, d / 2]} castShadow>
          <cylinderGeometry args={[w * 0.5, w * 0.5, h, 16]} />
          <meshStandardMaterial color="#4A4A4A" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* Grate slots */}
        {[-0.3, -0.1, 0.1, 0.3].map(off => (
          <mesh key={off} position={[w * off, h + 0.001, d / 2]}>
            <boxGeometry args={[w * 0.08, 0.002, d * 0.7]} />
            <meshStandardMaterial color="#2A2A2A" />
          </mesh>
        ))}
      </group>
    );
  }
  if (item.id === "exhaust-vent") {
    return (
      <group>
        <mesh position={[0, h / 2, d / 2]} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={item.color} roughness={0.6} />
        </mesh>
        {/* Grille slats */}
        {[-0.35, -0.15, 0.05, 0.25, 0.45].map((yy, i) => (
          <mesh key={i} position={[0, h * (0.1 + yy + 0.45), d + 0.002]}>
            <boxGeometry args={[w * 0.8, h * 0.06, 0.003]} />
            <meshStandardMaterial color="#888" roughness={0.5} />
          </mesh>
        ))}
      </group>
    );
  }
  // Water supply (cold/hot) — small color-coded pipe stub with flange
  return (
    <group>
      <mesh position={[0, h / 2, d * 0.3]}>
        <cylinderGeometry args={[w * 0.35, w * 0.35, h * 0.8, 14]} />
        <meshStandardMaterial color={item.color} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, h / 2, d * 0.7]}>
        <cylinderGeometry args={[w * 0.5, w * 0.5, 0.015, 16]} />
        <meshStandardMaterial color="#C8C8C8" metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  );
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
    const center = new THREE.Vector3();
    box.getCenter(center);
    // eslint-disable-next-line no-console
    console.log(`[GltfFurniture] ${url} native=${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m target=${w.toFixed(2)}×${h.toFixed(2)}×${d.toFixed(2)}m center=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)})`);
    // Safety: if any dim is zero (broken model), skip auto-scale.
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      // Non-uniform fit: scale each axis independently to match the
      // declared W×D×H (respecting the per-instance scaleW/scaleD/scaleH
      // the caller rolled into w/d/h). Some aspect distortion on models
      // whose native proportions don't match the declared furniture, but
      // that's preferable to a wardrobe bursting through the ceiling.
      // The `scale` prop from furniture.ts stacks on top as a final
      // uniform trim if needed per-asset.
      const sx = (w / size.x) * (scale ?? 1);
      const sy = (h / size.y) * (scale ?? 1);
      const sz = (d / size.z) * (scale ?? 1);
      c.scale.set(sx, sy, sz);
      // Re-measure after scale, then shift so base is at Y=0 and
      // footprint is centered on X/Z origin (matches procedural-box convention).
      c.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(c);
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
      c.position.y -= box2.min.y;
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

export function PlacedItemMesh({ placed, def, roomW, roomD }: { placed: PlacedItem; def: RoomDef; roomW: number; roomD: number }) {
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

  // Artwork special case: mount on the wall nearest to the 2D placement.
  // Rotate so the image faces the room interior. Eye-level height at
  // 52% of room height (~1.45m in a 2.8m room).
  if (item.category === "artwork") {
    const xCm = placed.x;
    const zCm = placed.z;
    const wallW = roomW * 100;
    const wallD = roomD * 100;
    const distBack  = zCm;               // 0 = flush with back wall
    const distFront = wallD - zCm;
    const distLeft  = xCm;
    const distRight = wallW - xCm;
    const minDist = Math.min(distBack, distFront, distLeft, distRight);
    const y = def.height / 100 * 0.52;
    const GAP = 0.04;
    let position: [number, number, number];
    let rotation: [number, number, number];
    if (minDist === distBack) {
      position = [x3d, y, -roomD / 2 + GAP];
      rotation = [0, 0, 0];              // faces +Z
    } else if (minDist === distFront) {
      position = [x3d, y, roomD / 2 - GAP];
      rotation = [0, Math.PI, 0];        // faces -Z
    } else if (minDist === distLeft) {
      position = [-roomW / 2 + GAP, y, placed.z / 100 - roomD / 2];
      rotation = [0, Math.PI / 2, 0];    // faces +X
    } else {
      position = [roomW / 2 - GAP, y, placed.z / 100 - roomD / 2];
      rotation = [0, -Math.PI / 2, 0];   // faces -X
    }
    return (
      <group position={position} rotation={rotation}>
        <FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} />
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

  // If the user marked this item "吸顶", anchor it so its top is at the
  // ceiling (roomH). The mesh is modeled with base at y=0, so we shift
  // its Y by roomH - itemH. Floor-mounted items use elevationY as before.
  const roomH = def.height / 100;
  const baseY = placed.mountCeiling
    ? roomH - fh
    : (placed.elevationY ?? 0) / 100;

  // If the furniture item has a real 3D asset, render it; else fall
  // back to procedural box mesh. Suspense handles async glb load; if
  // loading throws (404, CORS, malformed) the ErrorBoundary higher up
  // catches it — for safety we also wrap in our own fallback.
  if (item.model3d?.url) {
    // Curtains get a click-to-toggle "open/close" wrapper: when open,
    // the curtain glTF is animated to compress horizontally (gather to
    // one side, revealing the window behind).
    if (item.category === "curtain") {
      return (
        <CurtainInstance
          instanceId={placed.instanceId}
          position={[x3d, baseY, z3d]}
          rotation={[0, rotY, 0]}
          item={item}
          w={fw} d={fd} h={fh}
        />
      );
    }
    return (
      <group position={[x3d, baseY, z3d]} rotation={[0, rotY, 0]}>
        <Suspense fallback={<FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} />}>
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
      <FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} />
    </group>
  );
}

/** Inner wrapper: catches GLTF load errors (404/malformed) and falls
 *  back to procedural geometry instead of crashing the scene. */
/** Curtain glTF loader that scrubs the asset of non-curtain geometry.
 *  Sketchfab curtain assets are often packaged with a "Wall" backing
 *  mesh (white, emissive) so the preview thumbnail looks like a real
 *  room scene. That wall ends up rendering inside our room as a glowing
 *  white slab — fine viewed from outside (hidden by the real wall) but
 *  from inside looking out it floods the view. We strip any mesh whose
 *  name contains "Wall" and force emissive off on all remaining
 *  materials so backlight doesn't blow them out either. */
function CurtainGltf({ item, w, d, h }: { item: FurnitureItem; w: number; d: number; h: number }) {
  const url = item.model3d!.url;
  const { scene } = useGLTF(url) as unknown as { scene: THREE.Object3D };
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    // 1) Drop the bundled "Wall" backdrop
    const toRemove: THREE.Object3D[] = [];
    c.traverse(obj => {
      if (obj.name && /wall/i.test(obj.name)) toRemove.push(obj);
    });
    for (const o of toRemove) o.parent?.remove(o);
    // 2) Kill emissive AND force opaque on every remaining material.
    //
    //  - emissive: Sketchfab often sets emissive white so the asset pops
    //    against dark previews — wrong for a real scene with its own lighting.
    //  - opacity / transparency: the source glTFs ship with a translucent
    //    sheer/tulle layer for cinematic preview look. In a real room
    //    that lets the camera see THROUGH the curtain from outside, which
    //    defeats the curtain's job of blocking view. Force all materials
    //    fully opaque so the curtain actually obstructs.
    c.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (sm) {
          if (sm.emissive) sm.emissive.set("#000000");
          if ("emissiveIntensity" in sm) sm.emissiveIntensity = 0;
          if (sm.emissiveMap) sm.emissiveMap = null;
          sm.transparent = false;
          sm.opacity = 1;
          sm.alphaTest = 0;
          if ("alphaMap" in sm) sm.alphaMap = null;
          sm.depthWrite = true;
          sm.side = THREE.DoubleSide;  // visible from both sides of the room
          sm.needsUpdate = true;
        }
      }
    });
    // 3) Scale + center exactly like GltfFurniture does
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      c.scale.set(w / size.x, h / size.y, d / size.z);
      c.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(c);
      c.position.x -= (box2.min.x + box2.max.x) / 2;
      c.position.z -= (box2.min.z + box2.max.z) / 2;
      c.position.y -= box2.min.y;
    }
    return c;
  }, [scene, w, d, h]);
  return <primitive object={cloned} />;
}

/** Wraps a curtain placement with open/close animation. Clicking the
 *  curtain mesh toggles the store flag `curtainOpenByInstanceId[id]`;
 *  useFrame smoothly animates the inner group's scale.x between 1 (closed,
 *  covers full width) and 0.35 (open, gathered to the hinge side) and
 *  offsets its position so the "gather" stays at the left edge — like
 *  real curtains pulled aside. */
function CurtainInstance({
  instanceId, position, rotation, item, w, d, h,
}: {
  instanceId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  item: FurnitureItem;
  w: number; d: number; h: number;
}) {
  const isOpen = useDesignerStore(s => !!s.curtainOpenByInstanceId[instanceId]);
  const toggle = useDesignerStore(s => s.toggleCurtainOpen);
  const innerRef = useRef<THREE.Group>(null);
  const openRef = useRef(0);
  useFrame((_, delta) => {
    const target = isOpen ? 1 : 0;
    const cur = openRef.current;
    const diff = target - cur;
    if (Math.abs(diff) < 0.005) return;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), 2 * delta);
    openRef.current = cur + step;
    const g = innerRef.current;
    if (!g) return;
    // Open state: gather curtain to ~55% width (was 35% — too thin,
    // looked like a paper sliver). Still clearly "opened" but visually
    // believable as a bunched fabric.
    const scaleX = 1 - openRef.current * 0.45;
    g.scale.x = scaleX;
    g.position.x = -(w / 2) * (1 - scaleX);
  });

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(e) => { e.stopPropagation(); toggle(instanceId); }}
    >
      <group ref={innerRef}>
        <Suspense fallback={<FurnitureMesh item={item} w={w} d={d} h={h} instanceId={instanceId} />}>
          <CurtainGltf item={item} w={w} d={d} h={h} />
        </Suspense>
      </group>
    </group>
  );
}

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
  const hasDoor    = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomHasDoor[activeRoom] ?? true);
  const doorWall   = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorWall[activeRoom] ?? "bottom");
  const doorPosCm  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorPos[activeRoom] ?? 0);
  const doorLenCm  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorLen?.[activeRoom] ?? 80);
  const doorHCm    = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorH?.[activeRoom] ?? 200);
  const doorStyle  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorStyle?.[activeRoom] ?? "wood_panel");
  const frontWallOpacity = useDesignerStore((s) => s.frontWallOpacity);
  const ceilingOpacity = useDesignerStore((s) => s.ceilingOpacity);
  const lightPos = useDesignerStore((s) => s.lightPosByRoom[s.activeRoom]);
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
      <ExposureController />

      {/* Environment — skip on iOS: PMREMGenerator.fromScene is broken on iPhone Metal
          (three.js bug #25888). Compensate with stronger ambient + fill lights.
          Also wrapped in ErrorBoundary+Suspense so a CDN failure on the
          Poly Haven HDR (lebombo_1k.hdr fetched by drei's "apartment"
          preset) gracefully degrades to no-IBL instead of crashing the
          whole Canvas. */}
      {!isIOS && (
        <EnvironmentFallback>
          <Suspense fallback={null}>
            <Environment preset="apartment" />
          </Suspense>
        </EnvironmentFallback>
      )}

      {/* Sky + ground bounce — hemisphere light gives a soft top-down
          gradient (cool sky above, warm beige ground below) that lifts
          shadowed wall faces without washing them out. Much gentler than
          cranking ambient, keeps color separation between lit/shaded
          surfaces. */}
      <hemisphereLight args={["#BFD4E8", "#C8B088", isIOS ? 1.1 : 0.55]} />

      {/* Main "sun" directional — slightly warm tint so sunlight reads as
          natural daylight (ACES tonemapping darkens cool whites into
          blues). Intensity dialed back from 1.6 → 1.2 to avoid
          blown-out highlights with bloom. Shadow bias bumped to
          reduce peter-panning on low-contrast materials. */}
      <directionalLight
        position={[W * 0.5, H * 2.2, D * 0.8]}
        intensity={1.2}
        color="#FFF4E0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-W}
        shadow-camera-right={W}
        shadow-camera-top={D}
        shadow-camera-bottom={-D}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
      />
      {/* Cool fill from the opposite side — bluish to balance the warm sun */}
      <directionalLight
        position={[-W * 0.8, H * 1.5, -D * 0.5]}
        intensity={0.35}
        color="#D8E4F4"
      />
      {/* Low ambient — the hemisphere light does most of the sky work now;
          ambient just stops pure-black crevices. Extra-bright on iOS
          because Environment IBL is disabled (Metal bug). */}
      <ambientLight intensity={isIOS ? 1.4 : 0.3} />
      {isIOS && <directionalLight position={[-3, 4, 3]} intensity={0.6} />}

      {/* Room geometry */}
      <RoomShell
        W={W} D={D} H={H}
        wallColor={wallColor}
        floorColor={floorColor}
        wallId={wallId}
        floorId={floorId}
        windows={roomWindows}
        wallBack={roomState.materials.wallBack}
        wallFront={roomState.materials.wallFront}
        wallLeft={roomState.materials.wallLeft}
        wallRight={roomState.materials.wallRight}
        wallLower={roomState.materials.wallLower}
        wallSplitCm={roomState.materials.wallSplitHeight}
        wallExterior={roomState.materials.wallExterior}
        wallBackExterior={roomState.materials.wallBackExterior}
        wallFrontExterior={roomState.materials.wallFrontExterior}
        wallLeftExterior={roomState.materials.wallLeftExterior}
        wallRightExterior={roomState.materials.wallRightExterior}
        hasDoor={hasDoor}
        doorWall={doorWall}
        doorPosCm={doorPosCm}
        doorLenCm={doorLenCm}
        doorHCm={doorHCm}
        doorStyle={doorStyle}
        activeRoom={activeRoom}
        ceiling={roomState.materials.ceiling}
        frontWallOpacity={frontWallOpacity}
        ceilingOpacity={ceilingOpacity}
      />

      {/* Light fixture */}
      <LightFixture
        H={H}
        lightColor={lightColor}
        lightId={lightId}
        lightX={(lightPos?.x ?? 0) / 100}
        lightZ={(lightPos?.z ?? 0) / 100}
      />

      {/* Placed furniture */}
      {roomState.placedItems.map((placed) => (
        <PlacedItemMesh key={placed.instanceId} placed={placed} def={def} roomW={W} roomD={D} />
      ))}

      {/* Exterior decor on the OUTSIDE faces of this room's walls */}
      <RoomExteriorDecorLayer room={activeRoom} W={W} D={D} H={H} />
      <RoutingLinesLayer room={activeRoom} W={W} D={D} H={H} />

      {/* Post-processing — skip on iOS (Metal compiler issues with complex fragment shaders).
          Wrapped in <PostFX/> which defers mounting until the WebGL context
          is fully ready. Without this, @react-three/postprocessing 3.0.4
          throws "Cannot read properties of null (reading 'alpha')" on the
          first render because its effect constructors try to read
          gl.getContextAttributes() before Canvas has finished init. */}
      {!isIOS && <PostFX />}
    </>
  );
}

// ─── Per-room exterior decor ───────────────────────────────
// Renders items from RoomState.exteriorDecor on the OUTSIDE face of
// this room's 4 walls. The user is normally looking at the room from
// inside (dollhouse view), but when they orbit around to the outside,
// the decor on the outer wall face becomes visible — e.g. wall lamps,
// mailboxes, house numbers.
// Convention matches HouseCanvas: each wall is wrapped in a group whose
//   local +X = right when viewed from OUTSIDE the wall
//   local +Y = up
//   local +Z = outward (away from room interior)
const EMPTY_ROOM_DECOR: ExteriorWallDecorItem[] = [];
const EMPTY_CONNS: import("@/lib/types").RoutingConnection[] = [];

/** 3D pipe/wire visualization. Wires hug the ceiling (one band below
 *  the slab), water lines hug the floor. Each connection becomes a
 *  4-segment polyline: down/up from fixture A → across at ceiling/floor
 *  → down/up to fixture B (i.e. the L-shape from the 2D plan, projected
 *  vertically off the wall). */
function RoutingLinesLayer({ room, W, D, H }: {
  room: import("@/lib/types").RoomType; W: number; D: number; H: number;
}) {
  const conns  = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms[room]?.connections) ?? EMPTY_CONNS;
  const placed = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms[room]?.placedItems) ?? [];
  if (conns.length === 0) return null;
  const Y_WIRE = H - 0.08;
  const Y_PIPE = 0.04;
  const colors: Record<string, string> = {
    "wire": "#FACC15",
    "cold-water": "#3B82F6",
    "hot-water": "#EF4444",
    "drain": "#6B7280",
  };
  // Per-kind tube radius (m). Wires thinner (8mm), pipes thicker (12-18mm).
  const radius: Record<string, number> = {
    "wire": 0.008,
    "cold-water": 0.012,
    "hot-water": 0.012,
    "drain": 0.018,
  };
  return (
    <group>
      {conns.map(c => {
        const a = placed.find(p => p.instanceId === c.from);
        const b = placed.find(p => p.instanceId === c.to);
        if (!a || !b) return null;
        const ax = (a.x / 100) - W / 2, az = (a.z / 100) - D / 2;
        const bx = (b.x / 100) - W / 2, bz = (b.z / 100) - D / 2;
        const isWire = c.kind === "wire";
        const Y = isWire ? Y_WIRE : Y_PIPE;
        const dx = Math.abs(bx - ax), dz = Math.abs(bz - az);
        const cornerX = dx > dz ? bx : ax;
        const cornerZ = dx > dz ? az : bz;
        // Build a 5-point polyline through the L-shape; convert to a
        // CatmullRom curve and a TubeGeometry so the pipe has visible
        // thickness (three.js native <line> is locked to 1px on WebGL).
        const points = [
          new THREE.Vector3(ax, 0.05, az),
          new THREE.Vector3(ax, Y, az),
          new THREE.Vector3(cornerX, Y, cornerZ),
          new THREE.Vector3(bx, Y, bz),
          new THREE.Vector3(bx, 0.05, bz),
        ];
        const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.05);
        const r = radius[c.kind] ?? 0.01;
        const segments = Math.max(20, Math.floor(curve.getLength() / 0.05));
        const color = colors[c.kind] ?? "#999";
        return (
          <mesh key={c.id} castShadow>
            <tubeGeometry args={[curve, segments, r, 8, false]} />
            <meshStandardMaterial
              color={color}
              metalness={isWire ? 0.6 : 0.45}
              roughness={isWire ? 0.4 : 0.55}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function RoomExteriorDecorLayer({ room, W, D, H }: {
  room: import("@/lib/types").RoomType; W: number; D: number; H: number;
}) {
  const decorRaw = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms[room]?.exteriorDecor);
  const decor = decorRaw ?? EMPTY_ROOM_DECOR;
  const selectedId = useDesignerStore(s => s.selectedExteriorDecorId);
  const setSelected = useDesignerStore(s => s.setSelectedExteriorDecor);
  const updateDecor = useDesignerStore(s => s.updateRoomExteriorDecor);
  const { controls } = useThree();
  const draggingIdRef = useRef<string | null>(null);

  const DECOR_OFFSET = 0.025;
  const wallSpecs: Array<{
    wall: ExteriorWallTSType; position: [number, number, number];
    rotation: [number, number, number]; wallW: number; wallH: number;
  }> = [
    { wall: "back",  position: [0, H / 2, -(D / 2) - DECOR_OFFSET], rotation: [0, Math.PI, 0],     wallW: W, wallH: H },
    { wall: "front", position: [0, H / 2,  (D / 2) + DECOR_OFFSET], rotation: [0, 0, 0],           wallW: W, wallH: H },
    { wall: "left",  position: [-(W / 2) - DECOR_OFFSET, H / 2, 0], rotation: [0, -Math.PI / 2, 0], wallW: D, wallH: H },
    { wall: "right", position: [ (W / 2) + DECOR_OFFSET, H / 2, 0], rotation: [0,  Math.PI / 2, 0], wallW: D, wallH: H },
  ];

  return (
    <>
      {wallSpecs.map(spec => {
        const items = decor.filter(d => d.wall === spec.wall);
        if (items.length === 0) return null;
        return (
          <RoomDecorWallFrame
            key={spec.wall}
            room={room}
            spec={spec}
            items={items}
            selectedId={selectedId}
            setSelected={setSelected}
            updateDecor={updateDecor}
            draggingIdRef={draggingIdRef}
            controls={controls as unknown as { enabled: boolean } | null}
          />
        );
      })}
    </>
  );
}

type ExteriorWallTSType = import("@/lib/types").ExteriorWall;

function RoomDecorWallFrame({
  room, spec, items, selectedId, setSelected, updateDecor, draggingIdRef, controls,
}: {
  room: import("@/lib/types").RoomType;
  spec: { wall: ExteriorWallTSType; position: [number, number, number]; rotation: [number, number, number]; wallW: number; wallH: number };
  items: ExteriorWallDecorItem[];
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  updateDecor: (room: import("@/lib/types").RoomType, id: string, patch: Partial<ExteriorWallDecorItem>) => void;
  draggingIdRef: React.MutableRefObject<string | null>;
  controls: { enabled: boolean } | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Track pointer-down screen position + whether threshold has been
  // exceeded. Without this, a "click" (pointerDown + 1-2px jitter +
  // pointerUp) nudges the decor's position slightly every time the
  // user tries to just SELECT or TOGGLE a light. 5px threshold lets
  // intentional drags through while ignoring click jitter.
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pastThresholdRef = useRef(false);
  const onDragMove = (e: any) => {
    const id = draggingIdRef.current;
    if (!id || !groupRef.current) return;
    if (!pastThresholdRef.current && pointerStartRef.current) {
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      if (Math.hypot(dx, dy) < 5) return;
      pastThresholdRef.current = true;
    }
    const worldPt = e.point as THREE.Vector3;
    const local = groupRef.current.worldToLocal(worldPt.clone());
    const u = local.x / spec.wallW + 0.5;
    const v = local.y / spec.wallH + 0.5;
    updateDecor(room, id, {
      u: Math.max(0.04, Math.min(0.96, u)),
      v: Math.max(0.04, Math.min(0.96, v)),
    });
  };
  const onDragEnd = () => {
    if (draggingIdRef.current) {
      draggingIdRef.current = null;
      pointerStartRef.current = null;
      pastThresholdRef.current = false;
      if (controls) controls.enabled = true;
    }
  };

  return (
    <group ref={groupRef} position={spec.position} rotation={spec.rotation}>
      <mesh
        position={[0, 0, 0.002]}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        <planeGeometry args={[spec.wallW, spec.wallH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {items.map(d => (
        <ExteriorDecorItem
          key={d.instanceId}
          decor={d}
          wallW={spec.wallW}
          wallH={spec.wallH}
          selected={selectedId === d.instanceId}
          onPointerDown={(e) => {
            e.stopPropagation();
            setSelected(d.instanceId);
            draggingIdRef.current = d.instanceId;
            pointerStartRef.current = { x: e.clientX, y: e.clientY };
            pastThresholdRef.current = false;
            if (controls) controls.enabled = false;
          }}
        />
      ))}
    </group>
  );
}

/** Shared renderer for a single exterior decor item. Handles three modes:
 *  - image (imageUrl set) → meshBasicMaterial with texture, unlit so
 *    colors always read correctly even at night-time ambient
 *  - light strip (id starts with "light-strip-") → emissive box,
 *    thin and bright
 *  - default → colored box with standard PBR material
 *  Called from both RoomCanvas and HouseCanvas. */
function ExteriorDecorItem({
  decor, wallW, wallH, selected, onPointerDown,
}: {
  decor: ExteriorWallDecorItem;
  wallW: number; wallH: number;
  selected: boolean;
  onPointerDown: (e: any) => void;
}) {
  const item = getFurnitureById(decor.furnitureId);
  // Canvas-generated texture (text decor: couplets / plates / borders /
  // ivy). Synchronous via useMemo — available on first render.
  const canvasTex = useMemo(
    () => (item ? makeCanvasDecorTexture(item) : null),
    [item]
  );
  useEffect(() => () => { canvasTex?.dispose(); }, [canvasTex]);
  if (!item) return null;

  const w = (item.width / 100) * (decor.scaleW ?? 1);
  const h = (item.height / 100) * (decor.scaleH ?? 1);
  const dep = item.depth / 100;
  const isLightStrip = item.id.startsWith("light-strip-");
  const isVine = item.id === "climbing-vine";
  const hasImage = !!item.imageUrl;
  // Pick rendering mode (first match wins):
  //   - DetailedDecor returns real 3D geometry for specific items
  //     (lantern/mailbox/AC/vine/borders/plates/strips/wall lamps)
  //   - else canvasTex present → draw it on a plane (couplets)
  //   - else hasImage (imageUrl) and no canvasTex → suspense-load the JPG (murals)
  //   - else isLightStrip → emissive box
  //   - else → colored box
  // Per-fixture on/off for exterior wall lights. Non-lights pass
  // isOn=true (harmless). Brightness inherits from the owning room
  // (kept room-wide so it behaves as a "dimmer for all lights").
  const activeRoomForLights = useDesignerStore(s => s.activeRoom);
  const fixtureOff = useDesignerStore(s => s.fixtureOffById[decor.instanceId]);
  const brightnessForDecor = useDesignerStore(s => s.lightBrightnessByRoom[activeRoomForLights] ?? 1);
  const toggleFixture = useDesignerStore(s => s.toggleFixture);
  const isOnForDecor = !fixtureOff;
  const detailed = DetailedDecor({ item, w, h, d: dep, isOn: isOnForDecor, brightness: brightnessForDecor });
  const isLightFixture = item.id === "wall-lamp-lantern" || item.id === "wall-lamp-modern" || item.id.startsWith("light-strip-");

  return (
    <group
      position={[(decor.u - 0.5) * wallW, (decor.v - 0.5) * wallH, 0.01]}
      rotation={[0, 0, ((decor.rotation ?? 0) * Math.PI) / 180]}
      onPointerDown={onPointerDown}
      onClick={isLightFixture ? (e) => { e.stopPropagation(); toggleFixture(decor.instanceId); } : undefined}
    >
      {detailed ? detailed : canvasTex ? (
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
        // URL-based texture — drei/r3f useLoader w/ Suspense, so the
        // plane only mounts once the image is ready. Fallback shows the
        // item's color so there's still something visible while loading.
        <Suspense fallback={
          <mesh position={[0, 0, 0.005]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={item.color} side={THREE.DoubleSide} />
          </mesh>
        }>
          <MuralPlane url={item.imageUrl!} w={w} h={h} />
        </Suspense>
      ) : isLightStrip ? (
        <mesh position={[0, 0, dep / 2]}>
          <boxGeometry args={[w, h, Math.max(0.01, dep)]} />
          <meshStandardMaterial
            color={item.color}
            emissive={item.color}
            emissiveIntensity={1.5}
            roughness={0.3}
          />
        </mesh>
      ) : (
        <mesh position={[0, 0, dep / 2]} castShadow>
          <boxGeometry args={[w, h, Math.max(0.02, dep)]} />
          <meshStandardMaterial color={item.color} roughness={0.55} metalness={0.25} />
        </mesh>
      )}
      {selected && (
        // Frame-only outline (no filled box in front of the decor). Four
        // thin bars around the edge so the decor behind stays visible
        // regardless of transparency / depth-write quirks.
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

/** Suspense-based mural texture plane. Uses r3f's useLoader which
 *  caches textures globally by URL and integrates with React Suspense,
 *  so the mesh only mounts once the JPG is loaded — no black flash, no
 *  useEffect timing gotchas. */
function MuralPlane({ url, w, h }: { url: string; w: number; h: number }) {
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

/** Generate a decor texture by drawing on a 2D canvas. Returns null if
 *  this item isn't one of the text-based decor types. Shared between
 *  RoomCanvas and HouseCanvas. */
function makeCanvasDecorTexture(item: FurnitureItem): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const drawCouplet = (chars: string[], bgColor: string) => {
    const W = 256, H = 1536;
    c.width = W; c.height = H;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    // Gold border
    ctx.strokeStyle = "#F0D070";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    // Characters stacked vertically
    ctx.fillStyle = "#F8E090";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${W * 0.68}px "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif`;
    const slotH = H / chars.length;
    chars.forEach((ch, i) => {
      ctx.fillText(ch, W / 2, slotH * (i + 0.5));
    });
  };

  const drawPlate = (text: string, bgGrad: string[], textColor: string) => {
    const W = 800, H = 320;
    c.width = W; c.height = H;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, bgGrad[0]);
    grad.addColorStop(0.5, bgGrad[1]);
    grad.addColorStop(1, bgGrad[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#484A4C";
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Size depends on length
    const fontSize = text.length <= 3 ? H * 0.75 : H * 0.55;
    ctx.font = `bold ${fontSize}px "Arial Black", "Heiti SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(text, W / 2, H / 2 + 6);
  };

  const drawMeander = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#7A3518";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#D4A030";
    ctx.lineWidth = 4;
    // Top/bottom edge lines
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    // Repeating meander "Greek key" pattern
    for (let x = 0; x < W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 10, 30);
      ctx.lineTo(x + 90, 30);
      ctx.lineTo(x + 90, 50);
      ctx.lineTo(x + 30, 50);
      ctx.lineTo(x + 30, 70);
      ctx.lineTo(x + 70, 70);
      ctx.lineTo(x + 70, 10);
      ctx.stroke();
    }
  };
  const drawFloral = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#F0EADB";
    ctx.fillRect(0, 0, W, H);
    // Edge lines
    ctx.strokeStyle = "#8A4A18";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    // Repeating flower + wave
    for (let x = 0; x < W; x += 120) {
      // Vine wave
      ctx.beginPath();
      ctx.moveTo(x + 20, 50);
      ctx.quadraticCurveTo(x + 40, 25, x + 60, 50);
      ctx.quadraticCurveTo(x + 80, 75, x + 100, 50);
      ctx.stroke();
      // Flower
      ctx.fillStyle = "#B87030";
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(x + 60, 50, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#8A4A18";
      ctx.beginPath();
      ctx.arc(x + 60, 50, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const drawIvy = () => {
    const W = 400, H = 600;
    c.width = W; c.height = H;
    // Brown wall showing through gaps
    ctx.fillStyle = "#5A4028";
    ctx.fillRect(0, 0, W, H);
    // Leaf tile
    const drawLeaf = (cx: number, cy: number, color: string, alpha: number, size = 22) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#1A3A18";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.quadraticCurveTo(cx - size, cy - size * 0.5, cx - size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx, cy + size, cx + size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx + size, cy - size * 0.5, cx, cy - size);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx, cy + size);
      ctx.stroke();
      ctx.restore();
    };
    // Two offset rows of leaves covering the plane
    for (let y = 0; y < H; y += 50) {
      for (let x = 0; x < W; x += 40) {
        const offsetX = (Math.floor(y / 50) % 2 === 0) ? 0 : 20;
        drawLeaf(x + offsetX, y, "#2D5A2A", 0.95);
      }
    }
    for (let y = 25; y < H; y += 50) {
      for (let x = 20; x < W; x += 40) {
        drawLeaf(x, y, "#3A7030", 0.85, 20);
      }
    }
    // Brown vines
    ctx.strokeStyle = "#4A3020";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.7;
    [50, 200, 350].forEach(startX => {
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      for (let y = 0; y <= H; y += 30) {
        const wobble = Math.sin(y / 40) * 20;
        ctx.lineTo(startX + wobble, y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };

  if (item.id === "couplet-spring") {
    drawCouplet(["春", "回", "大", "地", "千", "山", "秀"], "#C82020");
  } else if (item.id === "couplet-prosperity") {
    drawCouplet(["万", "事", "如", "意", "福", "满", "门"], "#A81818");
  } else if (item.id === "house-number") {
    drawPlate("888", ["#D0D2D4", "#E8EAEC", "#A8ABAE"], "#1A1C1E");
  } else if (item.id === "nameplate-family") {
    drawPlate("之家", ["#D4A85A", "#F0C878", "#8A6528"], "#3A2410");
  } else if (item.id === "border-meander") {
    drawMeander();
  } else if (item.id === "border-floral") {
    drawFloral();
  } else if (item.id === "climbing-vine") {
    drawIvy();
  } else {
    return null;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function PostFX() {
  const { gl } = useThree();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Wait one frame for Canvas to fully wire up the WebGL context.
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready || !gl) return null;
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.35} intensity={2.6} distanceFalloff={0.8} quality="medium" />
      <Bloom intensity={0.18} luminanceThreshold={1.05} luminanceSmoothing={0.85} mipmapBlur />
      <Vignette offset={0.3} darkness={0.45} blendFunction={BlendFunction.NORMAL} />
      <SMAA />
    </EffectComposer>
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
            // Explicit attrs — r3f 9.x + React 19 sometimes throws
            // "reading 'alpha'" when deriving defaults from a not-yet-ready
            // context. Setting these up-front dodges that race.
            alpha: true,
            stencil: false,
            depth: true,
            powerPreference: "default",
          }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFSoftShadowMap }}
          camera={{ position: [0, 1.4, 6], fov: 58, near: 0.1, far: 80 }}
          style={{ background: "linear-gradient(180deg, #E9EEF3 0%, #D4DEE8 55%, #C8D5E0 100%)" }}
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
