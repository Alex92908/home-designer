"use client";

import { useRef, useEffect, useMemo, useState, useCallback, Component, ReactNode } from "react";
import { SceneRegistrar } from "@/lib/sceneRegistry";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, Html, useGLTF, Text } from "@react-three/drei";
import { EffectComposer, N8AO, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense } from "react";
import * as THREE from "three";
import { useDesignerStore, RoomState } from "@/lib/store";
import { useLocale, useLocaleStore } from "@/lib/i18n";
const EMPTY_ROOM_STATE_RC: RoomState = { materials: {}, placedItems: [] };
import { getLayerOffset, overlayMaterialProps } from "@/lib/zLayer";
import { ROOM_DEFS, PlacedItem, RoomDef, WindowConfig, MaterialItem, RoomType, ExteriorWallDecorItem, WallSide, resolveFacadeLayer } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { FurnitureItem } from "@/lib/types";
import { DetailedDecor } from "./DetailedDecor";
import { FirstPersonControls, TouchJoystick } from "./FirstPersonControls";
import { getFloorTexture, getWallTexture, getRugTexture, floorTileSize, wallTileSize } from "@/lib/textures";
import { fabricMap, fabricNormal, woodMap, brushedMetalMap, marbleMap, paintAlbedo, paintNormal, defaultFloorPlanks } from "@/lib/furnitureTextures";
import { StyledWindow } from "@/components/shared/StyledWindow";
import { ROOFTOP_FIXTURE_IDS, RooftopFixtureMesh } from "./RooftopFixtures";
import { STAIR_FURNITURE_IDS, StaircaseMesh } from "./Staircase";

// ─── Error boundary ───────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      const locale = useLocaleStore.getState().locale;
      return (
        <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm flex-col gap-2 bg-gray-900">
          <span>{locale === "en" ? "⚠️ 3D render error" : "⚠️ 3D渲染错误"}</span>
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
  southWallOpacity,
  ceilingOpacity,
  wallsHidden,
  curtainGlassWalls,
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
  doorWall: WallSide;
  doorPosCm: number;
  doorLenCm: number;
  doorHCm: number;
  doorStyle: import("@/lib/types").DoorStyle;
  activeRoom: RoomType;
  southWallOpacity: number;
  ceilingOpacity: number;
  /** Per-side hide flags. true = skip rendering that wall entirely. */
  wallsHidden?: Partial<Record<WallSide, boolean>>;
  /** Walls that are glass curtain faces — rendered as transparent glass
   *  panes to match the exterior glass curtain wall appearance. */
  curtainGlassWalls?: Set<WallSide>;
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
  function holesForWall(
    side: WallSide,
    wallLenM: number,
    opts?: { skipWindows?: boolean },
  ): Rect[] {
    const holes: Rect[] = [];
    if (!opts?.skipWindows) {
      for (const w of windows) {
        if (w.wall !== side) continue;
        const sillM  = (w.sill ?? 90) / 100;
        const winHM  = (w.h   ?? Math.min(H * 52, 150)) / 100;
        const winLenM = w.len / 100;
        // W wall: wall-local x=0 is at the south (+Z) end and increases
        // northward, but win.pos is north-referenced (plan convention).
        // Flip so the hole aligns with RoomWindow's north-referenced zc formula.
        const holeX = side === "W"
          ? wallLenM - w.pos / 100 - winLenM
          : w.pos / 100;
        holes.push({
          x: holeX,
          y: sillM,
          w: winLenM,
          h: Math.min(winHM, H - sillM - 0.05),
        });
      }
    }
    // Door wall + window wall now share the NSWE alphabet — no remap.
    if (hasDoor && doorWall === side) {
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
    curtainGlass = false,
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
    lowerSide: WallSide;
    /** 0 = don't render, 0.5 = frosted glass, 1 = solid. Applied uniformly
     *  to every segment (upper, lower, all pieces around holes). */
    opacity?: number;
    /** True when this wall is a glass curtain face — renders as a single
     *  semi-transparent glass pane (no window holes) so the interior view
     *  matches the exterior glass curtain wall appearance. */
    curtainGlass?: boolean;
  }) {
    const holes = curtainGlass ? [] : holesForWall(lowerSide, wallLenM);
    const resolvedOpacity = curtainGlass ? 0.35 : opacity;
    const glassMat = curtainGlass
      ? wallMatFor("#C4D8E8", "", wallLenM, H)
      : null;
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
            const mat = glassMat ?? (s.band === "lower" && lowerMat ? lowerMat : upperMat);
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
                    transparent={resolvedOpacity < 1}
                    opacity={resolvedOpacity}
                    roughness={curtainGlass ? 0.05 : (mat as { roughness?: number }).roughness}
                    metalness={curtainGlass ? 0.1 : (mat as { metalness?: number }).metalness}
                  />
                </mesh>
                {/* Exterior face — only drawn when user picked a distinct
                    exterior material. Offset along outward normal so it
                    sits just beyond the interior plane. */}
                {!curtainGlass && extMat && (
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
      {!wallsHidden?.N && (
        <WallWithHoles
          side={sB} wallLenM={W}
          groupPos={[0, H / 2, -D / 2]}
          upperMat={wallMatFor(sB.color, sB.id, W, H)}
          extMat={(() => {
            const e = wallBackExterior ?? wallExterior;
            return e ? wallMatFor(e.color, e.id, W, H) : undefined;
          })()}
          extOffsetSign={-1}
          lowerSide="N"
          curtainGlass={curtainGlassWalls?.has("N")}
        />
      )}

      {/* Left wall */}
      {!wallsHidden?.W && (
        <WallWithHoles
          side={sL} wallLenM={D}
          groupPos={[-W / 2, H / 2, 0]} groupRot={[0, Math.PI / 2, 0]}
          upperMat={wallMatFor(sL.color, sL.id, D, H)}
          extMat={(() => {
            const e = wallLeftExterior ?? wallExterior;
            return e ? wallMatFor(e.color, e.id, D, H) : undefined;
          })()}
          extOffsetSign={-1}
          lowerSide="W"
          curtainGlass={curtainGlassWalls?.has("W")}
        />
      )}

      {/* Right wall */}
      {!wallsHidden?.E && (
        <WallWithHoles
          side={sR} wallLenM={D}
          groupPos={[W / 2, H / 2, 0]} groupRot={[0, -Math.PI / 2, 0]}
          upperMat={wallMatFor(sR.color, sR.id, D, H)}
          extMat={(() => {
            const e = wallRightExterior ?? wallExterior;
            return e ? wallMatFor(e.color, e.id, D, H) : undefined;
          })()}
          extOffsetSign={-1}
          lowerSide="E"
          curtainGlass={curtainGlassWalls?.has("E")}
        />
      )}

      {/* Front wall — user-controllable opacity (0 = cut away, 0.5 =
          frosted glass, 1 = solid). Uses WallWithHoles so doors/windows
          on the front wall are cut out at any opacity. Without the cut,
          a solid front wall would block the view of an open door's
          interior. The plane's default normal is +Z (outward), which is
          correct for the front wall at z=+D/2 — no rotation needed. */}
      {southWallOpacity > 0 && !wallsHidden?.S && (() => {
        const sF = resolveSide(wallFront);
        const e = wallFrontExterior ?? wallExterior;
        return (
          <WallWithHoles
            side={sF} wallLenM={W}
            groupPos={[0, H / 2, D / 2]}
            upperMat={wallMatFor(sF.color, sF.id, W, H)}
            extMat={e ? wallMatFor(e.color, e.id, W, H) : undefined}
            extOffsetSign={1}
            lowerSide="S"
            opacity={southWallOpacity}
            curtainGlass={curtainGlassWalls?.has("S")}
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

// ─── glTF window helpers MOVED to shared/StyledWindow.tsx ─────
// gltfSpecForStyle / GltfArchWindow / ArchWindowFallback and the arch-window
// asset URLs now live in src/components/shared/StyledWindow.tsx, which both
// this 效果图 view and the 外观漫游 (FloorPlanExterior) render from — a single
// source of truth for window geometry, materials and the per-style glTF map.

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
  // All window geometry + open/close animation now lives in the shared
  // <StyledWindow> (src/components/shared/StyledWindow.tsx) so the 效果图
  // (this view) and the 外观漫游 render byte-identical windows from the same
  // `win.style`. Per-window open state stays in the store via win.id.
  // Defaults inside StyledWindow reproduce this view's previous materials
  // (WINDOW_FRAME_COLOR / WINDOW_GLASS_COLOR, transmission 0.7, opacity 0.5,
  // wallOffset 0.015), so the effect view is visually unchanged.
  const style = win.style ?? "sliding";
  const windowFrameJSX = (
    <StyledWindow
      winLen={winLen}
      winH={winH}
      style={style}
      isOpen={isOpen}
      onToggle={() => toggleWinOpen(win.id)}
    />
  );

  if (win.wall === "N") {
    // back wall: X axis runs from -W/2 to W/2, window pos is from left (0) to right (W)
    const xc = winCenter - W / 2;
    return (
      <group position={[xc, winY, -D / 2]}>
        {windowFrameJSX}
        {/* Directional fill from window — studio Environment already handles
            most of the interior IBL; this adds a subtle warm sun-ray effect
            at low intensity so it reads as daylight without blowing out walls. */}
        <directionalLight
          position={[0, 0.3, -0.5]}
          target-position={[0, -1.5, 2]}
          intensity={0.35}
          color="#FFF2D0"
        />
      </group>
    );
  }

  if (win.wall === "E") {
    const zc = winCenter - D / 2;
    return (
      <group position={[W / 2, winY, zc]}>
        <group rotation={[0, -Math.PI / 2, 0]}>
          {windowFrameJSX}
        </group>
        <directionalLight
          position={[0.5, 0.3, 0]}
          target-position={[-2, -1.5, 0]}
          intensity={0.35}
          color="#FFF2D0"
        />
      </group>
    );
  }

  if (win.wall === "W") {
    const zc = winCenter - D / 2;
    return (
      <group position={[-W / 2, winY, zc]}>
        <group rotation={[0, Math.PI / 2, 0]}>
          {windowFrameJSX}
        </group>
        <directionalLight
          position={[-0.5, 0.3, 0]}
          target-position={[2, -1.5, 0]}
          intensity={0.35}
          color="#FFF2D0"
        />
      </group>
    );
  }

  if (win.wall === "S") {
    // Front wall is at z = +D/2; rotate the frame 180° around Y so its
    // outward face (+Z local) points toward +Z world = outside the room.
    // Previously this branch fell through to `return null` and the front
    // wall ended up with the cutout but no frame / glass / mullions →
    // visually a giant empty hole onto the rest of the scene.
    const xc = winCenter - W / 2;
    return (
      <group position={[xc, winY, D / 2]}>
        <group rotation={[0, Math.PI, 0]}>
          {windowFrameJSX}
        </group>
        <directionalLight
          position={[0, 0.3, 0.5]}
          target-position={[0, -1.5, -2]}
          intensity={0.35}
          color="#FFF2D0"
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
const WOODEN_DOOR_URL = "/models/_arch_door/door_with_frame/door_with_frame.glb";

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
  doorWall: WallSide;
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
    case "N": // back wall (z = -D/2)
      groupPos = [doorPos - W / 2, 0, -D / 2 + 0.02];
      groupRot = [0, 0, 0];
      hingeOffset = 1;
      break;
    case "S": // front wall (z = +D/2) — normally hidden wall but
      // door itself should still render so it's visible in dollhouse.
      // Rotate 180° around Y so door faces room interior (-Z).
      groupPos = [-W / 2 + doorPos + doorW, 0, D / 2 - 0.02];
      groupRot = [0, Math.PI, 0];
      hingeOffset = 1;
      break;
    case "W":
      // 西墙：墙洞在 WallWithHoles 里以「wall-local x=0 在南端(+Z)、向北(-Z)递增」
      // 落位，门洞世界 z 区间 = [D/2 - doorPos - doorW, D/2 - doorPos]。门板组旋转
      // +π/2 后局部 +X 映射到世界 -Z，因此铰链(组原点)须落在门洞的「+Z 南缘」=
      // D/2 - doorPos，门板再沿 -Z 填满门洞。原来的 doorPos - D/2 是符号写反，导致
      // 门板整体偏出门洞一个门宽 → 出现「关着的门 + 旁边一个空洞」。E 墙是对的镜像。
      groupPos = [-W / 2 + 0.02, 0, D / 2 - doorPos];
      groupRot = [0, Math.PI / 2, 0];
      hingeOffset = 1;
      break;
    case "E":
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
export function LightFixture({ H, lightColor, lightId, lightX = 0, lightZ = 0, room }: {
  H: number; lightColor: string; lightId: string;
  lightX?: number; lightZ?: number;
  /** When provided (e.g. by GlobalCanvas), light state is read from THIS
   *  room id rather than the store's activeRoom. */
  room?: RoomType;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const activeRoom = useDesignerStore(s => s.activeRoom);
  const roomId = room ?? activeRoom;
  const isOn = useDesignerStore(s => s.lightsOnByRoom[roomId] !== false);
  const toggle = useDesignerStore(s => s.toggleRoomLights);
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[roomId] ?? 1);
  const colorOverride = useDesignerStore(s => s.lightColorByRoom[roomId]);
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
        onClick={(e) => { e.stopPropagation(); toggle(roomId); }}
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

export function LightFixtureInner({ H, lightColor, lightId, chandelierRef, isOn, brightness = 1, visualOnly = false }: {
  H: number; lightColor: string; lightId: string;
  chandelierRef: React.RefObject<THREE.Mesh | null>;
  /** When false, every emissive material and spot/point light in the
   *  fixture gets multiplied by 0. */
  isOn: boolean;
  /** Global multiplier applied to BOTH emissiveIntensity and pointLight
   *  intensity. User-controlled in RightPanel (0.3–2.0). */
  brightness?: number;
  /** When true, render ONLY the fixture's meshes (emissive shapes) and OMIT
   *  every shadow-casting spot/point light. 全局3D + 漫游 reuse the same
   *  fixture shapes but provide their own single light, so they must skip
   *  these extra lights — each shadow-caster eats a texture unit and the
   *  scene caps at MAX_TEXTURE_IMAGE_UNITS=16. */
  visualOnly?: boolean;
}) {
  const ref = chandelierRef;
  const em = isOn ? brightness : 0;
  const bm = isOn ? brightness : 0;
  const lit = !visualOnly;

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
            {lit && <spotLight visible={isOn} position={[x, H - 0.22, 0]} target-position={[x, 0, 0]} intensity={6 * bm} angle={0.35} penumbra={0.4} color="#FFF2D8" castShadow shadow-mapSize={[512, 512]} />}
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
        {lit && <pointLight visible={isOn} position={[0, H - 0.22, 0]} intensity={10 * bm} color={lightColor} distance={5} decay={2} castShadow />}
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
        {lit && <pointLight visible={isOn} position={[0, H - 0.25, 0]} intensity={9 * bm} color={lightColor} distance={5} decay={2} castShadow />}
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
        {lit && <pointLight visible={isOn} position={[0, H - 0.22, 0]} intensity={7 * bm} color="#FFF0C0" distance={5} decay={2} castShadow />}
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
            {lit && <pointLight visible={isOn} position={[bx, H - 0.5 + Math.abs(by), 0]} intensity={2.5 * bm} color="#FF9800" distance={3} decay={2} />}
          </group>
        ))}
        {/* Main area light */}
        {lit && <pointLight visible={isOn} position={[0, H - 0.55, 0]} intensity={6 * bm} color="#FFB347" distance={5} decay={2} castShadow />}
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
        {lit && <pointLight visible={isOn} position={[0, -0.06, 0]} intensity={6 * bm} color={lightColor} distance={4.5} decay={2} castShadow />}
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
        {lit && <pointLight visible={isOn} position={[0, -0.12, 0]} intensity={9 * bm} color={lightColor} distance={5} decay={2} castShadow />}
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
        {lit && <pointLight visible={isOn} position={[0, -0.1, 0]} intensity={12 * bm} color={lightColor} distance={6} decay={2} castShadow />}
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
            {lit && <spotLight visible={isOn} position={[x, -0.08, 0]} target-position={[x, 0, 0]} intensity={4 * bm} angle={0.4} penumbra={0.5} color={lightColor} castShadow shadow-mapSize={[512, 512]} />}
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
        {lit && <pointLight visible={isOn} position={[0, -0.06, 0]} intensity={11 * bm} color={lightColor} distance={6} decay={2} castShadow />}
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
            {lit && <spotLight visible={isOn} position={[x, -0.03, z]} target-position={[x, 0, z]} intensity={3 * bm} angle={0.5} penumbra={0.6} color={lightColor} castShadow shadow-mapSize={[512, 512]} />}
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
      {lit && <pointLight visible={isOn} position={[0, 0, 0]} intensity={8 * bm} color={lightColor} distance={4.8} decay={2} castShadow />}
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
  // A fridge ≥ 0.78 m wide reads as a french-door (two top doors) model;
  // narrower bodies are single-door. The freezer drawer occupies the bottom
  // ~36 % in both cases. Everything is modeled with base at y=0 and fully
  // fills w×d×h, so placement/scale always match the declared footprint.
  const isFrench = w >= 0.78;
  const fz = h * 0.36;            // freezer height
  const doorH = h - fz;          // upper door section height
  const front = d / 2 + 0.006;   // front face z (slightly proud for seams)
  const seam = shade(color, -22);
  const handleMat = { color: "#9aa0a6", metalness: 0.7, roughness: 0.28 } as const;
  return (
    <group>
      {/* Body */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} map={metal} roughness={0.4} metalness={0.55} />
      </mesh>
      {/* Horizontal seam between fridge section and freezer drawer */}
      <mesh position={[0, fz, front]}>
        <boxGeometry args={[w - 0.03, 0.01, 0.012]} />
        <meshStandardMaterial color={seam} roughness={0.3} />
      </mesh>
      {/* Freezer drawer handle (horizontal bar) */}
      <mesh position={[0, fz - h * 0.06, front + 0.025]}>
        <boxGeometry args={[w * 0.5, 0.028, 0.05]} />
        <meshStandardMaterial {...handleMat} />
      </mesh>
      {isFrench ? (
        <>
          {/* Vertical center seam splitting the two top doors */}
          <mesh position={[0, fz + doorH / 2, front]}>
            <boxGeometry args={[0.012, doorH - 0.03, 0.012]} />
            <meshStandardMaterial color={seam} roughness={0.3} />
          </mesh>
          {/* Two vertical door handles, flanking the center seam */}
          <mesh position={[-w * 0.06, fz + doorH * 0.5, front + 0.025]}>
            <boxGeometry args={[0.03, doorH * 0.6, 0.05]} />
            <meshStandardMaterial {...handleMat} />
          </mesh>
          <mesh position={[w * 0.06, fz + doorH * 0.5, front + 0.025]}>
            <boxGeometry args={[0.03, doorH * 0.6, 0.05]} />
            <meshStandardMaterial {...handleMat} />
          </mesh>
        </>
      ) : (
        /* Single tall door handle on the right edge */
        <mesh position={[w * 0.36, fz + doorH * 0.5, front + 0.025]}>
          <boxGeometry args={[0.03, doorH * 0.6, 0.05]} />
          <meshStandardMaterial {...handleMat} />
        </mesh>
      )}
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

function Rug({ color, sc, w, d, id }: MeshProps & { id?: string }) {
  // 程序化花纹贴图（北欧几何/波斯/素织），把纯色盒子升级成有图案有织感的地毯。
  const tex = useMemo(() => getRugTexture(id ?? "rug", color, sc), [id, color, sc]);
  return (
    <mesh position={[0, 0.012, 0]} receiveShadow>
      <boxGeometry args={[w, 0.015, d]} />
      {/* polygonOffset：地毯贴地，外观视图楼板带负 polygonOffset(约 -4/-17)
          会把地毯盖住。给地毯更强的负偏移，让它稳定画在楼板之上。配合
          FloorPlanExterior 对地毯的 0.03 抬升，外观图里地毯即可显示。室内
          视图本就正常，加偏移无副作用。 */}
      <meshStandardMaterial
        map={tex}
        color="#ffffff"
        roughness={0.97}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-40}
      />
    </mesh>
  );
}

function FloorLamp({ color, w, d, h, instanceId, room }: MeshProps & { instanceId?: string; room?: RoomType }) {
  // Per-instance on/off — clicking the shade toggles this specific lamp.
  // Without instanceId (e.g. in template previews), lamp stays always-on.
  const off = useDesignerStore(s => instanceId ? s.fixtureOffById[instanceId] : false);
  const toggle = useDesignerStore(s => s.toggleFixture);
  const activeRoom = useDesignerStore(s => s.activeRoom);
  const roomId = room ?? activeRoom;
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[roomId] ?? 1);
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
          standard-shaded otherwise so the color still fits room lighting.
          polygonOffset 防 z-fight：远视角下 canvas vs frame depth precision
          会精度抖动，光靠 0.015m 位移不够，开 GPU 级别 offset。 */}
      <mesh position={[0, 0, 0.015 + getLayerOffset("artwork")]} castShadow>
        <planeGeometry args={[w, h]} />
        {tex ? (
          <meshBasicMaterial map={tex} toneMapped={true} {...overlayMaterialProps()} />
        ) : (
          <meshStandardMaterial color={color} roughness={0.78} {...overlayMaterialProps()} />
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

function FurnitureMesh({ item, w, d, h, instanceId, room }: { item: FurnitureItem; w: number; d: number; h: number; instanceId?: string; room?: RoomType }) {
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
    case "floor_lamp":      return <FloorLamp {...props} instanceId={instanceId} room={room} />;
    case "plant":           return <Plant {...props} />;
    case "rug":             return <Rug {...props} id={item.id} />;
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
  url, scale, rotation, yOffset, recolor, w, d, h, fit,
}: { url: string; scale?: number; rotation?: number; yOffset?: number; recolor?: string; w: number; d: number; h: number; fit?: "contain" | "fill" | "tile" }) {
  const { scene } = useGLTF(url) as unknown as { scene: THREE.Object3D };

  // Clone so multiple instances don't share transforms or materials.
  // Returns one or more positioned instances (tiling produces several).
  const instances = useMemo(() => {
    // Per-mesh material fixups shared by every clone we build.
    const prep = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Repaint when the source GLB has a wrong/placeholder base color.
        // Skip clearly-glass materials (transmissive / very transparent) so
        // we don't paint over windows/doors on the model.
        if (recolor) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            const sm = mat as THREE.MeshStandardMaterial;
            if (!sm || !sm.color) continue;
            const phys = sm as unknown as { transmission?: number };
            if ((phys.transmission ?? 0) > 0.1 || (sm.transparent && sm.opacity < 0.6)) continue;
            sm.color.set(recolor);
            sm.map = null;
            sm.needsUpdate = true;
          }
        }
        // Sketchfab GLTF furniture ships with `transparent + depthWrite=
        // false + opacity 0.3..0.9` on glass / screen / sheer layers.
        // Without depthWrite, multiple stacked semi-transparent layers
        // (TV body + screen + glass, cabinet glass doors, etc.) re-sort
        // every frame and create the "torn streak" / "echelon stack"
        // artifacts users see at close range. Force depthWrite=true on
        // every transparent material in the imported asset — visual
        // transparency is preserved, layers properly occlude each other.
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm?.transparent && sm.depthWrite === false) {
            sm.depthWrite = true;
            sm.needsUpdate = true;
          }
        }
      });
    };
    // Scale a fresh clone uniformly by `s`, then recenter footprint on the
    // X/Z origin and drop its base to Y=0 (matches procedural-box convention).
    const buildUniform = (s: number) => {
      const c = scene.clone(true);
      prep(c);
      c.scale.setScalar(s);
      c.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(c);
      c.position.x -= (b.min.x + b.max.x) / 2;
      c.position.z -= (b.min.z + b.max.z) / 2;
      c.position.y -= b.min.y;
      return { obj: c, box: b };
    };

    // Measure the asset's native bounding box from a prepped clone so we can
    // scale to our declared furniture size (width/depth/height in meters).
    const base = scene.clone(true);
    prep(base);
    const box = new THREE.Box3().setFromObject(base);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    // eslint-disable-next-line no-console
    console.log(`[GltfFurniture] ${url} fit=${fit ?? "contain"} native=${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}m target=${w.toFixed(2)}×${h.toFixed(2)}×${d.toFixed(2)}m center=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)})`);

    // Safety: if any dim is zero (broken model), skip auto-scale.
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) {
      if (scale) base.scale.setScalar(scale);
      return [{ obj: base, x: 0 }];
    }

    const mode = fit ?? "contain";
    const trim = scale ?? 1;

    if (mode === "fill") {
      // Non-uniform: exactly fill W×D×H. Best for boxy appliances whose
      // declared size IS the real product size (fridge/sink/range hood).
      base.scale.set((w / size.x) * trim, (h / size.y) * trim, (d / size.z) * trim);
      base.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(base);
      base.position.x -= (b2.min.x + b2.max.x) / 2;
      base.position.z -= (b2.min.z + b2.max.z) / 2;
      base.position.y -= b2.min.y;
      return [{ obj: base, x: 0 }];
    }

    if (mode === "tile") {
      // Fit a single module by depth+height (its real cabinet cross-section),
      // keep the module's own width, then repeat it along the run to fill `w`.
      const s = Math.min(h / size.y, d / size.z) * trim;
      const first = buildUniform(s);
      const moduleW = first.box.max.x - first.box.min.x;
      const count = Math.max(1, Math.round(w / Math.max(moduleW, 1e-3)));
      const out: { obj: THREE.Object3D; x: number }[] = [];
      for (let i = 0; i < count; i++) {
        const obj = i === 0 ? first.obj : buildUniform(s).obj;
        const x = (i - (count - 1) / 2) * moduleW;
        out.push({ obj, x });
      }
      return out;
    }

    // "contain" (default): uniform scale by the SMALLEST axis ratio so the
    // model keeps its real proportions and never bursts past the box. Best
    // for organic/proportioned items (plants, sofas, chairs, lamps).
    const s = Math.min(w / size.x, h / size.y, d / size.z) * trim;
    const only = buildUniform(s);
    return [{ obj: only.obj, x: 0 }];
  }, [scene, w, d, h, scale, recolor, fit]);

  return (
    <group rotation={[0, rotation ?? 0, 0]} position={[0, yOffset ?? 0, 0]}>
      {instances.map((inst, i) => (
        <group key={i} position={[inst.x, 0, 0]}>
          <primitive object={inst.obj} />
        </group>
      ))}
    </group>
  );
}

export function PlacedItemMesh({ placed, def, roomW, roomD, room }: { placed: PlacedItem; def: RoomDef; roomW: number; roomD: number; room?: RoomType }) {
  // 内置家具走静态 FURNITURE（getFurnitureById）；用户导入的家具改为
  // 响应式订阅 store.customFurniture —— 它是持久化状态，刷新后随 store
  // rehydrate 立即可用，且变化会触发重渲染。之前只查模块级 _customItems
  // （非响应式 + 靠 onRehydrate 异步填充），SSR→客户端 hydration 时序下
  // 首帧拿不到 → 导入家具刷新后凭空消失（内置家具因在静态数组里不受影响）。
  const customFurniture = useDesignerStore(s => s.customFurniture);
  const item = getFurnitureById(placed.furnitureId)
    ?? customFurniture.find(f => f.id === placed.furnitureId);

  // For curtain wall-snap logic: get the windows & door wall for THIS room.
  // We need these even before the early-return so that hooks aren't called conditionally.
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const activeRoom  = useDesignerStore(s => s.activeRoom);
  const roomKey = room ?? activeRoom;
  const roomWindows = useDesignerStore(s => s.floorPlans[activeFloor]?.roomWindows?.[roomKey] ?? EMPTY_WINDOWS);
  const doorWall    = useDesignerStore(s => s.floorPlans[activeFloor]?.roomDoorWall?.[roomKey] ?? "S");

  if (!item) return null;

  // Convert floor plan cm coords to 3D world units using actual room dimensions
  const x3d = placed.x / 100 - roomW / 2;
  const z3d = placed.z / 100 - roomD / 2;

  // Apply per-instance scale from the floor plan (scaleW/scaleD/scaleH default to 1)
  const fw = (item.width  * (placed.scaleW ?? 1)) / 100;
  const fd = (item.depth  * (placed.scaleD ?? 1)) / 100;
  const fh = (item.height * (placed.scaleH ?? 1)) / 100;

  const rotY = (placed.rotation * Math.PI) / 180;

  // ── 屋顶机电/设施（原建筑级硬编码，现为普通家具）──
  // 居中渲染于本地原点，底座坐落于 y=0（板面）。位置/朝向/尺寸全走通用手柄。
  if (ROOFTOP_FIXTURE_IDS.has(item.id)) {
    const fixBaseY = (placed.elevationY ?? 0) / 100;
    return (
      <group position={[x3d, fixBaseY, z3d]} rotation={[0, rotY, 0]}>
        <RooftopFixtureMesh item={item} fw={fw} fd={fd} fh={fh} />
      </group>
    );
  }

  // ── 楼梯（原 stairConfig + StaircaseGeom 特例，现为普通家具）──
  // 几何体填满 fw×fd×fh、底座 y=0、居中。方位走家具 rotation，大小走宽深高
  // 缩放手柄 —— 在「平面图 / 效果图」用通用手柄拖动 / 缩放 / 旋转，各视图一致。
  if (STAIR_FURNITURE_IDS.has(item.id)) {
    const stairBaseY = (placed.elevationY ?? 0) / 100;
    // 楼梯跨满一个完整楼层（floor-to-floor），顶踏要接到「上一层地面 / 天台
    // 板」，而不是停在自己房间的净天花高度。楼层间距 = FLOOR_H + SLAB_T，
    // 目录里 4 款楼梯的 height 都按这个间距设成 320cm，所以这里直接用 fh
    // （目录高度），不再用房间净高 roomH 去压低楼梯——那会让楼梯顶比天台
    // 矮一截，上天台前要多跨一大步，体感像匍匐。
    //
    // 占地夹回楼梯井（房间）轮廓：楼梯是被楼梯间包裹的结构件，不该戳穿墙体 /
    // 屋面板。按「旋转后的 AABB」等比缩小到房间内部（单侧留一点墙厚余量），
    // 再把中心夹回房间内。高度方向不动（仍跨满层高）。只夹占地、不改高度，
    // 既消除戳出墙外的部分，又保持顶踏接上层地面。
    const ST_INSET = 0.06; // 单侧 6cm 墙厚余量
    const stCos = Math.abs(Math.cos(rotY)), stSin = Math.abs(Math.sin(rotY));
    const stAabbX = fw * stCos + fd * stSin;
    const stAabbZ = fw * stSin + fd * stCos;
    const stMaxX = Math.max(0.2, roomW - ST_INSET * 2);
    const stMaxZ = Math.max(0.2, roomD - ST_INSET * 2);
    const stK = Math.min(1, stMaxX / stAabbX, stMaxZ / stAabbZ);
    const stW = fw * stK, stD = fd * stK;
    const stClampedAabbX = stW * stCos + stD * stSin;
    const stClampedAabbZ = stW * stSin + stD * stCos;
    const stLimX = Math.max(0, roomW / 2 - ST_INSET - stClampedAabbX / 2);
    const stLimZ = Math.max(0, roomD / 2 - ST_INSET - stClampedAabbZ / 2);
    const stX = Math.max(-stLimX, Math.min(stLimX, x3d));
    const stZ = Math.max(-stLimZ, Math.min(stLimZ, z3d));
    return (
      <group position={[stX, stairBaseY, stZ]} rotation={[0, rotY, 0]}>
        <StaircaseMesh item={item} fw={stW} fd={stD} fh={fh} />
      </group>
    );
  }

  // ── 光伏阵列（solar-panel-array）──
  // 完全当成一件普通家具：位置/朝向走 placedItem 的 x/z/rotation，尺寸走家具
  // 自身的宽×深（含缩放手柄 scaleW/scaleD）。面板按家具占地自动平铺出列×行，
  // 不再读外观面板的列/行/倾角配置（那是“特立独行”）。倾角固定 18°，硅片色取
  // 家具自身 color，可在「平面图 / 效果图」用通用手柄拖动 / 缩放 / 旋转。
  if (item.id === "solar-panel-array") {
    const pvW = 1.08, pvH = 1.70, pvGap = 0.06;   // 单块面板（含间距）
    const pvTilt = 18 * Math.PI / 180;
    const frameColor = "#2C3040";
    const cellColor  = item.color || "#1A1E2E";
    // 按家具占地（fw×fd）平铺，至少 1×1：
    const pvCols = Math.max(1, Math.floor((fw + pvGap) / (pvW + pvGap)));
    const pvRows = Math.max(1, Math.floor((fd + pvGap) / (pvH + pvGap)));
    const arrW = pvCols * (pvW + pvGap) - pvGap;
    const arrDepth = pvRows * (pvH + pvGap) - pvGap;
    const pvBaseY = (placed.elevationY ?? 0) / 100 + 0.10;
    return (
      <group position={[x3d, pvBaseY, z3d]} rotation={[0, rotY, 0]}>
        <group rotation={[pvTilt, 0, 0]}>
          {[pvH * 0.25 - arrDepth / 2, pvH * 0.75 - arrDepth / 2 + (pvRows - 1) * (pvH + pvGap) * 0.5].map((rz, ri) => (
            <mesh key={ri} position={[0, 0, rz]} castShadow>
              <boxGeometry args={[arrW + 0.12, 0.04, 0.055]} />
              <meshStandardMaterial color="#4A5060" roughness={0.42} metalness={0.62} />
            </mesh>
          ))}
          {Array.from({ length: pvRows }, (_, ri) =>
            Array.from({ length: pvCols }, (_, ci) => {
              const px = -arrW / 2 + ci * (pvW + pvGap) + pvW / 2;
              const pz = -arrDepth / 2 + ri * (pvH + pvGap) + pvH / 2;
              return (
                <group key={`pv-${ri}-${ci}`} position={[px, 0, pz]}>
                  <mesh castShadow>
                    <boxGeometry args={[pvW, pvH, 0.032]} />
                    <meshStandardMaterial color={frameColor} roughness={0.35} metalness={0.55} />
                  </mesh>
                  <mesh position={[0, 0, 0.018]}>
                    <boxGeometry args={[pvW - 0.04, pvH - 0.04, 0.008]} />
                    <meshStandardMaterial
                      color={cellColor}
                      roughness={0.08} metalness={0.18}
                      envMapIntensity={3.0}
                      emissive="#0E1422" emissiveIntensity={0.06}
                    />
                  </mesh>
                  {Array.from({ length: 5 }, (_, li) => {
                    const ly = -pvH / 2 + (li + 1) * (pvH / 6);
                    return (
                      <mesh key={li} position={[0, ly, 0.023]}>
                        <boxGeometry args={[pvW - 0.05, 0.008, 0.004]} />
                        <meshStandardMaterial color="#3A4260" roughness={0.28} metalness={0.42} />
                      </mesh>
                    );
                  })}
                </group>
              );
            })
          )}
        </group>
      </group>
    );
  }

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
    // GAP must clear the inner face of the wall AND the frame back
    // (2.5 cm). FPE walkthrough walls are 12 cm thick → inner face at
    // 6 cm from boundary. Frame back is GAP − 1.25 cm from boundary,
    // so GAP ≥ 7.25 cm is the absolute minimum. Past versions used
    // 4 cm (buried) and 10 cm (still failed for shared walls in the
    // walkthrough — likely because of OR-merged door/window holes
    // overlapping the artwork at sub-mm precision). 15 cm gives the
    // frame a clean 7.5 cm of air in front of the wall face — well
    // outside any z-fight band and any wall-mounted obstacle.
    //
    // Trade-off: the painting reads as protruding a bit off the wall
    // rather than flush. That's the price for shared-wall robustness.
    const GAP = 0.15;
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
      // renderOrder=10 makes the painting composite AFTER walls (default 0)
      // so the depth sort can't accidentally put a shared-wall mesh on
      // top of the artwork at near-coplanar distances.
      <group position={position} rotation={rotation} renderOrder={10}>
        <FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} room={room} />
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
  let baseY = placed.mountCeiling
    ? roomH - fh
    : (placed.elevationY ?? 0) / 100;

  // Kitchen fixtures aren't floor-standing: a sink drops into the counter and
  // a range hood hangs on the wall above the cooktop. When the user hasn't
  // overridden placement (no 吸顶, no manual elevationY), auto-anchor them at
  // the right height so they don't sit flat on the floor.
  if (!placed.mountCeiling && (placed.elevationY ?? 0) === 0) {
    const COUNTER_H = 0.85; // standard base-cabinet counter height (m)
    if (item.category === "kitchen_sink") {
      // Rest the sink on the counter (its base ~ counter top).
      baseY = COUNTER_H - fh * 0.35;
    } else if (item.category === "range_hood") {
      // Hood bottom ~0.65m above the counter.
      baseY = COUNTER_H + 0.62;
    }
  }

  // If the furniture item has a real 3D asset, render it; else fall
  // back to procedural box mesh. Suspense handles async glb load; if
  // loading throws (404, CORS, malformed) the ErrorBoundary higher up
  // catches it — for safety we also wrap in our own fallback.
  if (item.model3d?.url) {
    // Curtains: always hang from floor to ceiling regardless of item.height.
    // Curtains always hang floor-to-ceiling and must be snapped to the
    // nearest wall (they live at windows, never float in mid-room).
    // We find the closest of the 4 walls, move the curtain flush against
    // it (2 cm inward so it doesn't z-fight), and orient it to face the
    // room interior.
    if (item.category === "curtain") {
      const curtainH = roomH;
      const halfW = roomW / 2;
      const halfD = roomD / 2;

      // Map plan-coordinate wall names to 3D snap positions + inward rotation.
      // N (back, plan-top)  = z = -halfD, curtain faces +Z.
      // S (front, plan-bot) = z = +halfD, curtain faces -Z.
      // W (left)            = x = -halfW, curtain faces +X.
      // E (right)           = x = +halfW, curtain faces -X.
      type WallEntry = { name: WallSide; dist: number; cx: number; cz: number; ry: number };
      const wallEntries: WallEntry[] = [
        { name: "N", dist: Math.abs(z3d - (-halfD)), cx: x3d,        cz: -halfD + 0.02, ry: 0 },
        { name: "S", dist: Math.abs(z3d - ( halfD)), cx: x3d,        cz:  halfD - 0.02, ry: Math.PI },
        { name: "W", dist: Math.abs(x3d - (-halfW)), cx: -halfW + 0.02, cz: z3d,        ry: -Math.PI / 2 },
        { name: "E", dist: Math.abs(x3d - ( halfW)), cx:  halfW - 0.02, cz: z3d,        ry:  Math.PI / 2 },
      ];

      // Prefer walls that have windows; avoid the door wall.
      const windowWalls = new Set<string>(roomWindows.map(w => w.wall));
      const doorWallCanon = doorWall;

      const ranked = [...wallEntries].sort((a, b) => {
        // 1. Never put curtain on door wall (obstructs movement / looks wrong)
        const aDoor = a.name === doorWallCanon ? 1 : 0;
        const bDoor = b.name === doorWallCanon ? 1 : 0;
        if (aDoor !== bDoor) return aDoor - bDoor;
        // 2. Prefer walls that have windows
        const aWin = windowWalls.has(a.name) ? 0 : 1;
        const bWin = windowWalls.has(b.name) ? 0 : 1;
        if (aWin !== bWin) return aWin - bWin;
        // 3. Nearest wall as tiebreak
        return a.dist - b.dist;
      });

      const { cx, cz, ry: autoRotY } = ranked[0];

      return (
        <CurtainInstance
          instanceId={placed.instanceId}
          position={[cx, 0, cz]}
          rotation={[0, autoRotY, 0]}
          item={item}
          w={fw} d={fd} h={curtainH}
        />
      );
    }
    return (
      <group position={[x3d, baseY, z3d]} rotation={[0, rotY, 0]}>
        <Suspense fallback={<FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} room={room} />}>
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
      <FurnitureMesh item={item} w={fw} d={fd} h={fh} instanceId={placed.instanceId} room={room} />
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
        recolor={item.model3d.recolor}
        fit={item.model3d.fit}
        w={w} d={d} h={h}
      />
    );
  }
}

// ─── Polygon shell (for L型/凸字型 rooms) ──────────────────
// Renders floor + walls along a CCW polygon. Supports door hole cuts
// (with animated door panel) + window hole cuts (with glass plane).
// Multiple holes per edge are allowed; they get sorted by offset and
// the wall between them is filled with box segments.
function PolygonShell({
  points, H, wallColor, floorColor, ceilingColor, ceilingOpacity,
  doors, windows, activeRoom, wallsHidden,
}: {
  points: Array<[number, number]>; // cm, back-left origin
  H: number;                       // meters
  wallColor: string;
  floorColor: string;
  ceilingColor: string;
  ceilingOpacity: number;
  doors: Array<{
    wall: WallSide;
    posCm: number; lenCm: number; hCm: number;
    style: import("@/lib/types").DoorStyle;
    edgeIndex?: number;
  }>;
  windows: WindowConfig[];
  activeRoom: RoomType;
  /** Per-edge hide flags keyed by "edge-${i}" matching the hide toggles
   *  in the FloorPlan single-room toolbar. Hidden edges skip wall +
   *  door + window rendering on that edge. */
  wallsHidden?: Partial<Record<string, boolean>>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getEdges, findEdgeForWall, polygonBounds } = require("@/lib/roomGeometry") as typeof import("@/lib/roomGeometry");
  // Bounds so we can center the polygon on the same (0,0) used by PlacedItemMesh
  const { minX, maxX, minZ, maxZ } = useMemo(() => {
    let mnX = Infinity, mnZ = Infinity, mxX = -Infinity, mxZ = -Infinity;
    for (const [x, z] of points) {
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
    }
    return { minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ };
  }, [points]);
  const W = (maxX - minX) / 100;
  const D = (maxZ - minZ) / 100;

  // Shape uses local 2D coords (X, Y) that we'll extrude / fill.
  // PlacedItemMesh places items at `p.x/100 - W/2, z/100 - D/2`, so
  // we shift polygon vertices the same way to world coords.
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    points.forEach(([x, z], i) => {
      const wx = x / 100 - W / 2;
      const wz = z / 100 - D / 2;
      // ShapeGeometry lives in XY; we lay it flat later, so pass (wx, wz).
      if (i === 0) s.moveTo(wx, wz);
      else s.lineTo(wx, wz);
    });
    s.closePath();
    return s;
  }, [points, W, D]);

  // Compute polygon edges in cm, then build wall segments. If the active
  // door lives on a given edge, that edge gets split into [left | lintel | right]
  // with a door-sized gap; otherwise a single wall box.
  const WALL_THICK = 0.08; // 8 cm thick visual walls

  const { wallSegments, doorPlacements, windowPlacements } = useMemo(() => {
    const edges = getEdges(points);
    const bbox = polygonBounds(points);

    // ── Collect hole specs by edge ──
    type Hole = {
      startM: number; lenM: number;       // along edge
      sillM:  number; topM:  number;      // vertical span (sill..top)
      kind:   "door" | "window";
      winId?: string;
      doorStyle?: import("@/lib/types").DoorStyle;
    };
    const holesByEdge = new Map<number, Hole[]>();

    // Multi-door: each door punches its own hole + records its placement.
    type DoorPlacement = {
      edgeIndex: number; startM: number; lenM: number; hM: number;
      wx: number; wz: number; angle: number;
      style: import("@/lib/types").DoorStyle;
    };
    const doorPlacements: DoorPlacement[] = [];
    const isEdgeHidden = (i: number) => wallsHidden?.[`edge-${i}`] === true;
    for (const d of (doors ?? [])) {
      const hit = findEdgeForWall(points, d.wall, d.posCm, d.lenCm, bbox, d.edgeIndex);
      if (!hit) continue;
      if (isEdgeHidden(hit.edgeIndex)) continue; // wall gone → no door
      const startM = hit.startCm / 100;
      const lenM = d.lenCm / 100;
      const hM = d.hCm / 100;
      const arr = holesByEdge.get(hit.edgeIndex) ?? [];
      arr.push({ startM, lenM, sillM: 0, topM: hM, kind: "door", doorStyle: d.style });
      holesByEdge.set(hit.edgeIndex, arr);
      const e = edges[hit.edgeIndex];
      const wx1 = e.x1 / 100 - W / 2, wz1 = e.z1 / 100 - D / 2;
      const wx2 = e.x2 / 100 - W / 2, wz2 = e.z2 / 100 - D / 2;
      const eLenM = Math.hypot(wx2 - wx1, wz2 - wz1);
      const t0 = startM / eLenM;
      doorPlacements.push({
        edgeIndex: hit.edgeIndex, startM, lenM, hM,
        wx: wx1 + (wx2 - wx1) * t0, wz: wz1 + (wz2 - wz1) * t0,
        angle: Math.atan2(-(wz2 - wz1), wx2 - wx1),
        style: d.style,
      });
    }

    const winPlacements: Array<{
      winId: string; edgeIndex: number;
      wx: number; wz: number; angle: number;   // hole-start position
      lenM: number; sillM: number; hM: number;
    }> = [];
    for (const w of windows) {
      const hit = findEdgeForWall(points, w.wall, w.pos, w.len, bbox, w.edgeIndex);
      if (!hit) continue;
      if (isEdgeHidden(hit.edgeIndex)) continue; // wall gone → no window
      const startM = hit.startCm / 100;
      const lenM = w.len / 100;
      const sillM = (w.sill ?? 90) / 100;
      const hM = (w.h ?? 150) / 100;
      const topM = sillM + hM;
      const arr = holesByEdge.get(hit.edgeIndex) ?? [];
      arr.push({ startM, lenM, sillM, topM, kind: "window", winId: w.id });
      holesByEdge.set(hit.edgeIndex, arr);
      const e = edges[hit.edgeIndex];
      const wx1 = e.x1 / 100 - W / 2, wz1 = e.z1 / 100 - D / 2;
      const wx2 = e.x2 / 100 - W / 2, wz2 = e.z2 / 100 - D / 2;
      const eLenM = Math.hypot(wx2 - wx1, wz2 - wz1);
      const t0 = startM / eLenM;
      winPlacements.push({
        winId: w.id, edgeIndex: hit.edgeIndex,
        wx: wx1 + (wx2 - wx1) * t0,
        wz: wz1 + (wz2 - wz1) * t0,
        angle: Math.atan2(-(wz2 - wz1), wx2 - wx1),
        lenM, sillM, hM,
      });
    }

    // ── Build wall segments: between/around holes ──
    type Seg = { cx: number; cy: number; cz: number; len: number; angle: number; h: number; yBottom: number };
    const segs: Seg[] = [];
    for (const e of edges) {
      if (isEdgeHidden(e.i)) continue; // skip entire edge → no wall, no door, no window
      const wx1 = e.x1 / 100 - W / 2, wz1 = e.z1 / 100 - D / 2;
      const wx2 = e.x2 / 100 - W / 2, wz2 = e.z2 / 100 - D / 2;
      const dxm = wx2 - wx1, dzm = wz2 - wz1;
      const lenM = Math.hypot(dxm, dzm);
      const angle = Math.atan2(-dzm, dxm);

      const mkSeg = (startM: number, subLenM: number, h: number, yBottom: number) => {
        if (subLenM <= 1e-4 || h <= 1e-4) return;
        const tMid = (startM + subLenM / 2) / lenM;
        segs.push({
          cx: wx1 + dxm * tMid,
          cy: yBottom + h / 2,
          cz: wz1 + dzm * tMid,
          len: subLenM, angle, h, yBottom,
        });
      };

      const holes = (holesByEdge.get(e.i) ?? []).slice().sort((a, b) => a.startM - b.startM);
      let cursor = 0;
      for (const h of holes) {
        mkSeg(cursor, h.startM - cursor, H, 0);                     // full wall before hole
        if (h.sillM > 0) mkSeg(h.startM, h.lenM, h.sillM, 0);       // sill under window
        if (h.topM < H) mkSeg(h.startM, h.lenM, H - h.topM, h.topM);// lintel above
        cursor = h.startM + h.lenM;
      }
      mkSeg(cursor, lenM - cursor, H, 0);                           // remainder
    }
    return { wallSegments: segs, doorPlacements, windowPlacements: winPlacements };
  }, [points, W, D, H, doors, windows, getEdges, findEdgeForWall, polygonBounds, wallsHidden]);

  return (
    <>
      {/* Floor — use +π/2 X rotation (same as ceiling) so shape.y maps to
          world.z, matching wall edge positions. Without this the floor
          ends up Z-flipped relative to walls and pokes out on L 型 rooms. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={floorColor} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, 0]}>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial
          color={ceilingColor}
          roughness={0.95}
          transparent={ceilingOpacity < 1}
          opacity={ceilingOpacity}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Walls — one box per polygon-edge segment. Holes split edges into
          segments of varying height (sill / lintel / above door). */}
      {wallSegments.map((w, i) => (
        <mesh key={i} position={[w.cx, w.cy, w.cz]} rotation={[0, w.angle, 0]} castShadow receiveShadow>
          <boxGeometry args={[w.len, w.h, WALL_THICK]} />
          <meshStandardMaterial color={wallColor} roughness={0.85} />
        </mesh>
      ))}

      {/* Window glass — a thin plane in each window opening */}
      {windowPlacements.map(w => {
        // Position: hole-start + lenM/2 along edge, at mid-height of opening
        const cx = w.wx + Math.cos(w.angle) * (w.lenM / 2);
        const cz = w.wz - Math.sin(w.angle) * (w.lenM / 2);
        const cy = w.sillM + w.hM / 2;
        return (
          <mesh key={w.winId} position={[cx, cy, cz]} rotation={[0, w.angle, 0]}>
            <boxGeometry args={[w.lenM - 0.04, w.hM - 0.04, 0.02]} />
            <meshPhysicalMaterial
              color="#B8D4E8"
              transparent opacity={0.35}
              roughness={0.05}
              metalness={0}
              transmission={0.85}
              ior={1.45}
            />
          </mesh>
        );
      })}

      {/* Door panels — one per door. Clicking toggles the room's
          door-open state (shared across all doors of this room). */}
      {doorPlacements.map((dp, i) => (
        <PolygonDoorPanel key={i}
          wx={dp.wx}
          wz={dp.wz}
          angle={dp.angle}
          startM={dp.startM}
          lenM={dp.lenM}
          hM={dp.hM}
          room={activeRoom}
        />
      ))}
    </>
  );
}

/** Minimal hinged door panel rendered inside a polygon-shell door hole.
 *  Hinge is at the "start" end of the opening; swings inward by ~90°. */
function PolygonDoorPanel({
  wx, wz, angle, lenM, hM, room,
}: {
  wx: number; wz: number; angle: number;   // edge-start world position + edge angle
  startM: number; lenM: number; hM: number;
  room: RoomType;
}) {
  const isOpen = useDesignerStore(s => !!s.doorOpenByRoom[room]);
  const toggleDoorOpen = useDesignerStore(s => s.toggleDoorOpen);
  const panelRef = useRef<THREE.Group>(null);
  const animRef = useRef(0);
  useFrame((_, delta) => {
    const target = isOpen ? -Math.PI / 2 : 0;
    const diff = target - animRef.current;
    if (Math.abs(diff) > 0.002) {
      animRef.current += Math.sign(diff) * Math.min(Math.abs(diff), 5.5 * delta);
      if (panelRef.current) panelRef.current.rotation.y = animRef.current;
    }
  });
  // Place a group at the hinge (edge-start, on the wall inner face).
  // Inside the group the panel extends in local +X (along edge direction)
  // and rotation-Y swings it into the room.
  return (
    <group position={[wx, 0, wz]} rotation={[0, angle, 0]}>
      <group ref={panelRef}>
        {/* Frame (stays still) */}
        <mesh position={[lenM / 2, hM / 2, 0]} onClick={(e) => { e.stopPropagation(); toggleDoorOpen(room); }}>
          <boxGeometry args={[lenM - 0.02, hM - 0.02, 0.04]} />
          <meshStandardMaterial color="#8B6F47" roughness={0.75} />
        </mesh>
        {/* Handle */}
        <mesh position={[lenM - 0.12, hM * 0.5, 0.03]}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshStandardMaterial color="#C0A060" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Main Scene ────────────────────────────────────────────

function Scene({ isIOS, firstPerson }: { isIOS: boolean; firstPerson?: boolean }) {
  const activeRoom    = useDesignerStore((s) => s.activeRoom);
  const showCompass   = useDesignerStore((s) => s.showCompass);
  const roomState     = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom] ?? EMPTY_ROOM_STATE_RC);
  const roomWindows   = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomWindows?.[activeRoom] ?? EMPTY_WINDOWS);
  const roomDimensions = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomDimensions?.[activeRoom]);
  const hasDoor    = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomHasDoor?.[activeRoom] ?? true);
  const doorWall   = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomDoorWall?.[activeRoom] ?? "S");
  const doorPosCm  = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomDoorPos?.[activeRoom] ?? 0);
  const doorLenCm  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorLen?.[activeRoom] ?? 80);
  // Global default interior-door opening height (cm). Mirrors the walkthrough
  // (FloorPlanExterior) fallback so the door reads the same height in 效果图
  // and 漫游. Per-door `h` and per-room `roomDoorH` still win when set.
  const doorHDefault = useDesignerStore((s) => s.exterior?.interiorDoorHeightCm ?? 240);
  const doorHCm    = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorH?.[activeRoom]) ?? doorHDefault;
  const doorStyle  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorStyle?.[activeRoom] ?? "wood_panel");
  const doorEdgeIdx = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorEdgeIdx?.[activeRoom]);
  // Select the raw doors array — stable reference if unchanged.
  const roomDoorsArr = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoors?.[activeRoom]);
  // Compute the effective door list with legacy fallback. useMemo keeps
  // the array reference stable across re-renders to avoid infinite loops.
  const allDoors = useMemo(() => {
    if (roomDoorsArr && roomDoorsArr.length > 0) return roomDoorsArr;
    if (!hasDoor) return [];
    return [{
      id: `${activeRoom}-legacy-door`,
      wall: doorWall as WallSide,
      pos: doorPosCm,
      len: doorLenCm,
      h: doorHCm,
      style: doorStyle,
      edgeIndex: doorEdgeIdx,
    }];
  }, [roomDoorsArr, hasDoor, doorWall, doorPosCm, doorLenCm, doorHCm, doorStyle, doorEdgeIdx, activeRoom]);
  const southWallOpacity = useDesignerStore((s) => s.southWallOpacity);
  const ceilingOpacity = useDesignerStore((s) => s.ceilingOpacity);
  const lightPos = useDesignerStore((s) => s.lightPosByRoom[s.activeRoom]);
  const wallsHiddenForActive = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomWallsHidden?.[activeRoom]);
  const roomShape = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomShapes?.[activeRoom]);
  const exteriorFacadeSystem = useDesignerStore((s) => s.exterior?.facadeSystem);
  const exteriorFacadeGlass  = useDesignerStore((s) => s.exterior?.facadeGlass);
  const roomFacadeFaces = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomFacadeFaces);
  const fpRoomWallsHidden = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomWallsHidden);
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

  // Walls that should render as glass curtain in 室内装修图 — a wall is a
  // glass face when the project is in curtain-wall mode AND it has a window
  // on it (windows mark exterior-facing walls; interior walls have no windows).
  const curtainGlassWalls = useMemo(() => {
    const isCurtainWall = exteriorFacadeSystem === "curtain-wall" || !!exteriorFacadeGlass;
    if (!isCurtainWall) return undefined;
    const fp = { roomFacadeFaces, roomWallsHidden: fpRoomWallsHidden };
    const sides: WallSide[] = ["N", "S", "E", "W"];
    const glassSet = new Set<WallSide>();
    for (const side of sides) {
      // Only treat a wall as glass curtain if it has a window — windows
      // are only placed on exterior faces, so this filters out interior walls.
      const hasWindow = roomWindows.some((w) => w.wall === side);
      if (hasWindow && resolveFacadeLayer(fp, activeRoom, side, "glass", true)) {
        glassSet.add(side);
      }
    }
    return glassSet.size > 0 ? glassSet : undefined;
  }, [exteriorFacadeSystem, exteriorFacadeGlass, roomFacadeFaces, fpRoomWallsHidden, roomWindows, activeRoom]);

  return (
    <>
      <CameraController W={W} D={D} H={H} />
      <CameraAndCaptureSetup />
      <ExposureController />

      {/* ── NSWE wall labels — small flat 3D decals on the inner
           face of each wall, matching the walkthrough view's style and the
           2D floor-plan SVG visual weight. One label per wall, anchored
           25 % from the wall's start corner so centred doors/windows
           don't eat the label. 由 showCompass 开关控制显隐。 ── */}
      {showCompass && (() => {
        const lblY    = 1.5;
        const eps     = 0.08;          // clear interior wall surface
        const fontSize   = 0.20;       // 20 cm tall letter
        const plaqueSize = fontSize * 1.5;
        const xQ = -W * 0.25;          // 25 % from W (-X) end, along X
        const zQ = -D * 0.25;          // 25 % from N (-Z) end, along Z
        const common = {
          fontSize, color: '#FF1493',
          outlineWidth: fontSize * 0.06, outlineColor: '#ffffff',
          anchorX: 'center' as const, anchorY: 'middle' as const,
        };
        const Decal = ({
          letter, pos, rot,
        }: { letter: string; pos: [number, number, number]; rot: [number, number, number] }) => (
          <group position={pos} rotation={rot}>
            {/* Opaque white plate behind text — kills mirrored leak through
                the back face since troika-text ignores material-side. */}
            <mesh position={[0, 0, -0.005]} raycast={() => null}>
              <planeGeometry args={[plaqueSize, plaqueSize]} />
              <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
            <Text {...common}>{letter}</Text>
          </group>
        );
        return (
          <group>
            <Decal letter="N" pos={[xQ, lblY, -D / 2 + eps]} rot={[0, 0, 0]} />
            <Decal letter="S" pos={[xQ, lblY,  D / 2 - eps]} rot={[0, Math.PI, 0]} />
            <Decal letter="W" pos={[-W / 2 + eps, lblY, zQ]} rot={[0, Math.PI / 2, 0]} />
            <Decal letter="E" pos={[ W / 2 - eps, lblY, zQ]} rot={[0, -Math.PI / 2, 0]} />
          </group>
        );
      })()}

      {/* Interior lighting — NO Environment IBL (any HDR/preset blows out
          white walls since they reflect everything). Keep it simple:
            • One directional "sun" angled into the room from top-front-right
              → provides directionality + a single shadow pass (1024 map)
            • Soft fill from opposite side (no shadow, essentially free)
            • Ambient at 0.38 stops pitch-black corners without washing out
          Per-fixture pointLights (ceiling / pendant / floor lamps) add the
          warm layers on top when the user has lights enabled. */}
      <directionalLight
        position={[W * 0.5, H * 2.0, D * 0.7]}
        intensity={0.85}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-W}
        shadow-camera-right={W}
        shadow-camera-top={D}
        shadow-camera-bottom={-D}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-W * 0.7, H * 1.2, -D * 0.4]} intensity={0.28} color="#D8E4F4" />
      <ambientLight intensity={isIOS ? 0.9 : 0.38} />
      {isIOS && <directionalLight position={[-3, 4, 3]} intensity={0.5} />}

      {/* Room geometry — polygon shell when roomShape is set (L型/凸字型),
          otherwise full-featured rectangle shell with doors/windows. */}
      {roomShape && roomShape.preset !== "rect" ? (
        <PolygonShell
          points={roomShape.points}
          H={H}
          wallColor={wallColor}
          floorColor={floorColor}
          ceilingColor={roomState.materials.ceiling?.color ?? "#F5F5F5"}
          ceilingOpacity={ceilingOpacity}
          doors={allDoors.map(d => ({
            wall: d.wall,
            posCm: d.pos,
            lenCm: d.len,
            hCm: d.h ?? doorHDefault,
            style: d.style ?? "wood_panel",
            edgeIndex: d.edgeIndex,
          }))}
          windows={roomWindows}
          activeRoom={activeRoom}
          wallsHidden={wallsHiddenForActive}
        />
      ) : (
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
          hasDoor={allDoors.length > 0}
          doorWall={allDoors.length > 0 ? allDoors[0].wall : doorWall}
          doorPosCm={allDoors.length > 0 ? allDoors[0].pos : doorPosCm}
          doorLenCm={allDoors.length > 0 ? allDoors[0].len : doorLenCm}
          doorHCm={allDoors.length > 0 ? (allDoors[0].h ?? doorHDefault) : doorHCm}
          doorStyle={allDoors.length > 0 ? (allDoors[0].style ?? "wood_panel") : doorStyle}
          activeRoom={activeRoom}
          ceiling={roomState.materials.ceiling}
          southWallOpacity={southWallOpacity}
          ceilingOpacity={ceilingOpacity}
          wallsHidden={wallsHiddenForActive}
          curtainGlassWalls={curtainGlassWalls}
        />
      )}

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

      {/* Exterior decor on the OUTSIDE faces of this room's walls.
          Skip in first-person — these are wall-mounted exterior items
          (sconces, plant boxes, MEP routing) that live outside the room,
          and in walkthrough mode they show through the wall as the user
          walks close, producing the streak / ghost-painting artifacts. */}
      {!firstPerson && (
        <>
          <RoomExteriorDecorLayer room={activeRoom} W={W} D={D} H={H} />
          <RoutingLinesLayer room={activeRoom} W={W} D={D} H={H} />
        </>
      )}

      {/* Post-processing — skip on iOS (Metal compiler issues with complex fragment shaders).
          Wrapped in <PostFX/> which defers mounting until the WebGL context
          is fully ready. Without this, @react-three/postprocessing 3.0.4
          throws "Cannot read properties of null (reading 'alpha')" on the
          first render because its effect constructors try to read
          gl.getContextAttributes() before Canvas has finished init. */}
      {!isIOS && !firstPerson && <PostFX />}
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
const EMPTY_WINDOWS: WindowConfig[] = [];
const EMPTY_PLACED: PlacedItem[] = [];

/** 3D pipe/wire visualization. Wires hug the ceiling (one band below
 *  the slab), water lines hug the floor. Each connection becomes a
 *  4-segment polyline: down/up from fixture A → across at ceiling/floor
 *  → down/up to fixture B (i.e. the L-shape from the 2D plan, projected
 *  vertically off the wall). */
function RoutingLinesLayer({ room, W, D, H }: {
  room: import("@/lib/types").RoomType; W: number; D: number; H: number;
}) {
  const conns  = useDesignerStore(s => s.floorPlans[s.activeFloor]?.rooms[room]?.connections) ?? EMPTY_CONNS;
  const placed = useDesignerStore(s => s.floorPlans[s.activeFloor]?.rooms[room]?.placedItems ?? EMPTY_PLACED);
  if (conns.length === 0) return null;
  // MEP（机电）行业惯例：不同管线走墙的不同位置 + 不同走法。
  // 5 种管线本应分层走，全画在同高度同位置 → 视觉上一团乱。
  //
  //                     ↑ Y (上)
  //   热水管 (顶天 0.15m 下)       ←  墙顶包保温
  //   弱电（网线、TV）       ←  墙腰，与强电平行≥30cm
  //   强电（插座、开关）     ←  墙腰下沿
  //   冷水管                       ←  靠地脚 0.10m 上
  //   排水（DN50/DN75）            ←  最低，地下 0.15m 走，1.5% 坡度
  //                     ↓ Y (下，地面 0)
  //
  // 在 XZ 平面上各管线沿墙走，但留出 30mm 横向间距避免视觉碰撞。
  const Y: Record<string, number> = {
    "wire":       H - 0.20,   // 强电走墙腰：天花下方 20cm
    "cold-water": 0.10,       // 冷水管贴地脚 10cm
    "hot-water":  H - 0.10,   // 热水管走墙顶 10cm（避免与冷凝水互扰）
    "drain":      -0.10,      // 排水管走"地下"（视觉上沉到地板下）
  };
  const colors: Record<string, string> = {
    "wire":       "#FACC15",
    "cold-water": "#3B82F6",
    "hot-water":  "#EF4444",
    "drain":      "#6B7280",
  };
  // Per-kind tube radius (m). 行业管径：电线 PVC 套管 ~16mm、给水 PPR
  // DN20、排水 DN50。
  const radius: Record<string, number> = {
    "wire":       0.010,
    "cold-water": 0.012,
    "hot-water":  0.013,   // 包保温层略粗
    "drain":      0.022,
  };
  // 横向 offset：同一墙面多种管线时错开避免完全重合
  const xOffset: Record<string, number> = {
    "wire":       0.00,
    "cold-water": -0.04,
    "hot-water":  +0.04,
    "drain":      0.00,
  };
  return (
    <group>
      {conns.map(c => {
        const a = placed.find(p => p.instanceId === c.from);
        const b = placed.find(p => p.instanceId === c.to);
        if (!a || !b) return null;
        const ax = (a.x / 100) - W / 2, az = (a.z / 100) - D / 2;
        const bx = (b.x / 100) - W / 2, bz = (b.z / 100) - D / 2;
        const y = Y[c.kind] ?? H * 0.5;
        const xo = xOffset[c.kind] ?? 0;
        const dx = Math.abs(bx - ax), dz = Math.abs(bz - az);
        const cornerX = dx > dz ? bx : ax;
        const cornerZ = dx > dz ? az : bz;
        // 5-point L-shape polyline → CatmullRom → TubeGeometry。
        // 加 xo 偏移让冷/热水管在 X 方向错开。
        const points = [
          new THREE.Vector3(ax + xo, 0.05, az),
          new THREE.Vector3(ax + xo, y,    az),
          new THREE.Vector3(cornerX + xo, y, cornerZ),
          new THREE.Vector3(bx + xo, y,    bz),
          new THREE.Vector3(bx + xo, 0.05, bz),
        ];
        const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.05);
        const r = radius[c.kind] ?? 0.01;
        const segments = Math.max(20, Math.floor(curve.getLength() / 0.05));
        const color = colors[c.kind] ?? "#999";
        const isWire = c.kind === "wire";
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
  const decorRaw = useDesignerStore(s => s.floorPlans[s.activeFloor]?.rooms[room]?.exteriorDecor);
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
    { wall: "N", position: [0, H / 2, -(D / 2) - DECOR_OFFSET], rotation: [0, Math.PI, 0],     wallW: W, wallH: H },
    { wall: "S", position: [0, H / 2,  (D / 2) + DECOR_OFFSET], rotation: [0, 0, 0],           wallW: W, wallH: H },
    { wall: "W", position: [-(W / 2) - DECOR_OFFSET, H / 2, 0], rotation: [0, -Math.PI / 2, 0], wallW: D, wallH: H },
    { wall: "E", position: [ (W / 2) + DECOR_OFFSET, H / 2, 0], rotation: [0,  Math.PI / 2, 0], wallW: D, wallH: H },
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
        <mesh position={[0, 0, 0.005 + getLayerOffset("exteriorDecor")]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={canvasTex}
            transparent={isVine}
            alphaTest={isVine ? 0.1 : 0}
            side={THREE.DoubleSide}
            {...overlayMaterialProps()}
          />
        </mesh>
      ) : hasImage ? (
        // URL-based texture — drei/r3f useLoader w/ Suspense, so the
        // plane only mounts once the image is ready. Fallback shows the
        // item's color so there's still something visible while loading.
        <Suspense fallback={
          <mesh position={[0, 0, 0.005 + getLayerOffset("exteriorDecor")]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={item.color} side={THREE.DoubleSide} {...overlayMaterialProps()} />
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
    <mesh position={[0, 0, 0.005 + getLayerOffset("exteriorDecor")]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} {...overlayMaterialProps()} />
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
  const locale = useLocale();
  const [firstPerson, setFirstPerson] = useState(false);
  // Touch joystick — only active during walkthrough. Mirrors HouseCanvas's
  // joystick state shape so the TouchJoystick widget can drive movement
  // alongside (or instead of) WASD on devices without a keyboard.
  const [joystick, setJoystick] = useState({ axisX: 0, axisZ: 0 });
  const activeRoom     = useDesignerStore(s => s.activeRoom);
  const roomDimensions = useDesignerStore(s => s.floorPlans[s.activeFloor]?.roomDimensions?.[activeRoom]);
  // Fallbacks so the walkthrough still works if the room dims haven't
  // loaded yet (otherwise undefined.width crashes the whole render).
  const roomWMeters = (roomDimensions?.width  ?? 400) * 0.01;
  const roomDMeters = (roomDimensions?.depth  ?? 300) * 0.01;

  const exitFirstPerson = useCallback(() => setFirstPerson(false), []);

  return (
    <div className="w-full h-full relative">
      {firstPerson && (
        <>
          {/* Top center: active mode banner — unmissable */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg text-sm font-bold text-white shadow-lg pointer-events-none"
            style={{
              background: "linear-gradient(135deg, rgba(16,185,129,0.92), rgba(5,150,105,0.92))",
              border: "1px solid rgba(110,231,183,0.6)",
              backdropFilter: "blur(8px)",
            }}
          >
            {locale === "en" ? "🚶 Walking" : "🚶 漫游中"}
          </div>
          {/* Touch joystick — bottom-left, primary input on tablet / mobile,
              also works alongside WASD on desktop. Output is folded into
              the WASD movement vector inside FirstPersonControls. */}
          <TouchJoystick onChange={(x, z) => setJoystick({ axisX: x, axisZ: z })} />
          {/* Bottom: control hints */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 rounded-full text-xs text-white/85"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
          >
            <span>{locale === "en" ? "Drag to look" : "左键拖动转视角"}</span>
            <span>·</span>
            <span>{locale === "en" ? "WASD / joystick to move" : "WASD / 摇杆 移动"}</span>
            <span>·</span>
            <span>{locale === "en" ? "Scroll to zoom" : "滚轮 缩放"}</span>
            <span>·</span>
            <span>{locale === "en" ? "Shift to sprint" : "Shift 加速"}</span>
            <span>·</span>
            <span>{locale === "en" ? "ESC to exit" : "ESC 退出"}</span>
          </div>
        </>
      )}

      <ErrorBoundary>
        <Canvas
          gl={{
            // iOS: antialias causes pipeline issues (Safari ignores it anyway)
            antialias: !isIOS,
            // iOS Metal GLSL compiler fails on ACESFilmicToneMapping → use Linear
            toneMapping: isIOS ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.2,
            // FIX: preserveDrawingBuffer=true causes frame-accumulation
            // ghosting in walkthrough — the painting smears into 5–6
            // copies cascading across the wall because the previous
            // frame's pixels linger when Three's autoClear runs at the
            // wrong moment. HouseCanvas already runs with false and
            // captures via gl.render() + toDataURL() synchronously in
            // the same call stack, which works without the flag (the
            // buffer is valid for one tick after each render call).
            preserveDrawingBuffer: false,
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
          style={{
            // 柔和中灰蓝：既不让白墙融进去（原来的 #E9EEF3），也不让
            // 白墙显得刺眼（上一版 #525B6A 太暗，墙看起来像纸片）。
            background: "linear-gradient(180deg, #B8C0CC 0%, #929BA8 55%, #6E7684 100%)",
          }}
        >
          <SceneRegistrar view="interior" />
          {!firstPerson && (
            <OrbitControls
              makeDefault
              enablePan={true}
              panSpeed={0.6}
              minDistance={1.5}
              maxDistance={18}
              maxPolarAngle={Math.PI * 0.52}
              target={[0, 0.6, 0]}
            />
          )}
          {/* First-person walkthrough (W/A/S/D + mouse look) */}
          <FirstPersonControls
            enabled={firstPerson}
            onExit={exitFirstPerson}
            floorY={0}
            roomW={roomWMeters}
            roomD={roomDMeters}
            joystick={joystick}
          />
          <Scene isIOS={isIOS} firstPerson={firstPerson} />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
