"use client";

/**
 * FirstPersonControls — W/A/S/D walk-through inside a room or exterior scene.
 * Borrowed from pascal editor's first-person-controls.tsx pattern.
 *
 * Usage: Mount inside a <Canvas> alongside the scene geometry.
 * A "第一人称" button in the parent enables/disables this mode.
 *
 * Controls:
 *   - Click canvas → pointer lock (grab mouse)
 *   - W/A/S/D or Arrow keys → move
 *   - Mouse → look around
 *   - Shift → run
 *   - Space → (future: jump)
 *   - Escape → exit first-person
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, Vector3, PerspectiveCamera } from "three";

const WALK_SPEED  = 3.0;  // m/s
const RUN_SPEED   = 6.0;
const LOOK_SENS   = 0.002;
const EYE_HEIGHT  = 1.65; // metres

const euler   = new Euler(0, 0, 0, "YXZ");
const moveDir = new Vector3();
const forward = new Vector3();
const right   = new Vector3();

interface FirstPersonControlsProps {
  enabled: boolean;
  onExit: () => void;
  floorY?: number; // world Y of the floor plane, default 0
  roomW?: number;  // room width in metres (to clamp start position)
  roomD?: number;  // room depth in metres
  /** Live touch joystick output, -1..1 on each axis. Forward = +axisZ
   *  (matches WASD's `dz`). Same convention as HouseCanvas. */
  joystick?: { axisX: number; axisZ: number };
}

export function FirstPersonControls({
  enabled,
  onExit,
  floorY = 0,
  roomW = 5,
  roomD = 4,
  joystick,
}: FirstPersonControlsProps) {
  const { camera, gl } = useThree();

  const keys   = useRef<Record<string, boolean>>({});
  const locked = useRef(false);
  const yaw    = useRef(0);
  const pitch  = useRef(0);
  // Mirror joystick into a ref so useFrame always reads the latest value
  // without us having to add `joystick` to the useEffect dep array (which
  // would re-register every keyboard / pointer listener on every move).
  const joystickRef = useRef({ axisX: 0, axisZ: 0 });
  joystickRef.current = joystick ?? { axisX: 0, axisZ: 0 };
  // Drag-to-look fallback: when PointerLock fails (iframe / mobile / browser
  // permission denied), fall back to "hold left button + drag to look".
  // dragRef holds the last pointer X/Y while the user is dragging; null
  // when not dragging. Drag handlers are wired alongside the lock handlers
  // and only do work when the lock isn't active.
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // ── Pointer lock + drag-look fallback ─────────────────────────────────────
  const requestLock = useCallback(() => {
    if (!enabled) return;
    try {
      const p = gl.domElement.requestPointerLock();
      // Modern browsers return a Promise — the SecurityError that fires in
      // sandboxed iframes (e.g. Next.js Turbopack preview, Claude Preview)
      // reaches us as a rejected Promise, NOT a thrown exception. A
      // synchronous try/catch can't see it. Swallow it explicitly so the
      // Next.js dev-tools red banner doesn't appear; the drag-look fallback
      // handles input from this point on.
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => { /* drag-look picks up the slack */ });
      }
    } catch {
      /* legacy synchronous-throw browsers — same outcome */
    }
  }, [enabled, gl.domElement]);

  useEffect(() => {
    if (!enabled) return;

    const onLockChange = () => {
      locked.current = document.pointerLockElement === gl.domElement;
    };
    const onLockError = () => {
      locked.current = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!locked.current) return;
      yaw.current   -= e.movementX * LOOK_SENS;
      pitch.current -= e.movementY * LOOK_SENS;
      pitch.current  = Math.max(-Math.PI / 2.6, Math.min(Math.PI / 2.6, pitch.current));
    };
    // Drag-look (used whenever pointer lock isn't active)
    const onPDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target?.tagName !== "CANVAS") return;
      // If lock is active, the lock loop owns mouse — drag does nothing
      if (locked.current) return;
      dragRef.current = { x: e.clientX, y: e.clientY };
      try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onPMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      yaw.current   -= dx * LOOK_SENS * 1.25;   // bump sensitivity slightly — drag is slower than lock-mode movement
      pitch.current -= dy * LOOK_SENS * 1.25;
      pitch.current  = Math.max(-Math.PI / 2.6, Math.min(Math.PI / 2.6, pitch.current));
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPUp = () => { dragRef.current = null; };
    const onKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const onKeyUp   = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    // Wheel zoom — change FOV (narrower = zoom in, wider = zoom out)
    // instead of moving the camera forward. Forward-translation zoom would
    // clip through walls / push the camera outside the room. FOV is
    // clamped 25°–80°. Same trick HouseCanvas WalkthroughController uses.
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName !== "CANVAS") return;
      e.preventDefault();
      const cam2 = camera as PerspectiveCamera;
      if (!cam2.isPerspectiveCamera) return;
      const cur = cam2.fov ?? 58;
      const next = Math.max(25, Math.min(80, cur + (e.deltaY > 0 ? 3 : -3)));
      if (next !== cur) {
        cam2.fov = next;
        cam2.updateProjectionMatrix();
      }
    };

    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror",  onLockError);
    document.addEventListener("mousemove",         onMouseMove);
    window.addEventListener("pointerdown", onPDown);
    window.addEventListener("pointermove", onPMove);
    window.addEventListener("pointerup", onPUp);
    window.addEventListener("pointercancel", onPUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    // Pointer lock intentionally NOT requested — user prefers a visible
    // cursor in 效果图 walkthrough. Drag-to-look is the only look input;
    // the lock-mode mousemove handler above is dormant (locked.current
    // stays false). requestLock() remains defined for opt-in callers
    // but is no longer auto-triggered on canvas click.

    // Place camera inside the room (centred, near the front wall, eye height).
    // Use max(0.6, roomD * 0.30) to ensure we step at least 60 cm in from
    // the front wall — for tiny rooms (or roomD=0 fallback) this prevents
    // spawning the camera right up against the wall.
    const safeD = roomD > 0 ? roomD : 4;
    const startZ = Math.min(safeD / 2 - 0.6, Math.max(0.6, safeD * 0.30));
    camera.position.set(
      0,
      floorY + EYE_HEIGHT,
      startZ,
    );
    yaw.current   = 0;              // yaw=0 → camera looks in -Z → faces back wall
    pitch.current = 0;

    // Push the near clip plane out from the Canvas default (0.1 m) to 0.3 m.
    // At 0.1, walking up to a wall or behind a painting causes near-plane
    // jaggies / Z-fighting (the canvas previewed by the user). Same fix the
    // exterior WalkthroughController already uses. We also save/restore so
    // exit-walkthrough returns to the original near for orbit / 第三人称.
    const cam = camera as PerspectiveCamera;
    const prevNear = cam.isPerspectiveCamera ? cam.near : 0.1;
    const prevFov  = cam.isPerspectiveCamera ? cam.fov  : 58;
    // Save the orbit-view pose BEFORE we teleport into the room. On exit
    // we restore it so the user lands back where the dollhouse view was,
    // not stuck at wherever they walked to inside the room.
    const prevPos  = camera.position.clone();
    const prevQuat = camera.quaternion.clone();
    if (cam.isPerspectiveCamera) {
      cam.near = 0.3;
      cam.updateProjectionMatrix();
    }
    // Tell the OrbitControls (still in store under makeDefault) its
    // target so on exit-walkthrough the camera doesn't snap somewhere
    // weird. We don't have a direct controls handle here; rely on parent
    // re-mounting OrbitControls with its target prop.
    // eslint-disable-next-line no-console
    console.log("[FPC] walkthrough on — cam at", camera.position.toArray().map(n => +n.toFixed(2)), "roomD=", safeD);

    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror",  onLockError);
      document.removeEventListener("mousemove",         onMouseMove);
      window.removeEventListener("pointerdown", onPDown);
      window.removeEventListener("pointermove", onPMove);
      window.removeEventListener("pointerup", onPUp);
      window.removeEventListener("pointercancel", onPUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
      window.removeEventListener("wheel", onWheel);
      // No click→requestLock listener was attached; nothing to remove.
      // Defensive: if some external caller had locked the pointer on us,
      // release it on cleanup so the cursor reappears reliably.
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
      dragRef.current = null;
      // Restore the original near + FOV so orbit / 第三人称 view comes back
      // to its previous projection (otherwise small rooms look odd from far
      // and the zoomed-in FOV persists into the orbit view).
      if (cam.isPerspectiveCamera) {
        cam.near = prevNear;
        cam.fov  = prevFov;
        cam.updateProjectionMatrix();
      }
      // Restore the pre-walkthrough orbit pose so user lands back in the
      // dollhouse view, not stranded wherever they walked to.
      camera.position.copy(prevPos);
      camera.quaternion.copy(prevQuat);
    };
  }, [enabled, gl.domElement, camera, floorY, roomW, roomD]);

  // Exit on Escape; E key = interact with door (dispatches custom event)
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked.current) {
        onExit();
      }
      if (e.key === "e" || e.key === "E") {
        // Dispatch door interaction event — RoomCanvas door meshes can listen for this
        window.dispatchEvent(new CustomEvent("firstperson:interact", {
          detail: { position: [camera.position.x, camera.position.y, camera.position.z] }
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onExit, camera]);

  // Expose for debugging
  const scene = useThree(s => s.scene);
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __fpCam?: unknown; __fpKeys?: unknown; __fpScene?: unknown }).__fpCam = camera;
      (window as unknown as { __fpCam?: unknown; __fpKeys?: unknown; __fpScene?: unknown }).__fpKeys = keys;
      (window as unknown as { __fpCam?: unknown; __fpKeys?: unknown; __fpScene?: unknown }).__fpScene = scene;
    }
  }, [camera, scene]);

  // ── Per-frame movement ────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (!enabled) return;

    const dt = Math.min(delta, 0.1);
    const k  = keys.current;

    // Apply yaw/pitch to camera
    euler.set(pitch.current, yaw.current, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // Movement direction in world space
    const isRunning = k["ShiftLeft"] || k["ShiftRight"];
    const speed = isRunning ? RUN_SPEED : WALK_SPEED;

    // NB: `+(undefined || undefined)` is NaN — NaN propagates through the
    // movement math and corrupts camera.position to (NaN, y, NaN). Convert
    // each key explicitly to 0 or 1.
    let fwd = (k["KeyW"] || k["ArrowUp"]   ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0);
    let str = (k["KeyD"] || k["ArrowRight"]? 1 : 0) - (k["KeyA"] || k["ArrowLeft"]  ? 1 : 0);
    // Add joystick — TouchJoystick widget outputs axisZ flipped so that
    // screen-up = +axisZ = forward (same as WASD's `dz`).
    const j = joystickRef.current;
    fwd += j.axisZ;
    str += j.axisX;
    // Clamp combined input to unit magnitude so diagonal keys+stick don't
    // double-speed.
    const mag = Math.hypot(fwd, str);
    if (mag > 1) { fwd /= mag; str /= mag; }

    if (fwd !== 0 || str !== 0) {
      // Project camera direction onto XZ plane
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      right.crossVectors(forward, camera.up).normalize();

      moveDir.set(0, 0, 0)
        .addScaledVector(forward, fwd)
        .addScaledVector(right,   str)
        .normalize()
        .multiplyScalar(speed * dt);

      camera.position.add(moveDir);
      // Keep eye height fixed (no gravity for now)
      camera.position.y = floorY + EYE_HEIGHT;
      // Clamp inside the room — leave 30 cm padding to the walls so the
      // camera doesn't clip through.
      const PAD = 0.3;
      camera.position.x = Math.max(-roomW / 2 + PAD, Math.min(roomW / 2 - PAD, camera.position.x));
      camera.position.z = Math.max(-roomD / 2 + PAD, Math.min(roomD / 2 - PAD, camera.position.z));
    }
  });

  return null;
}

// ─── Toggle button (rendered outside the Canvas) ─────────────────────────────
interface FirstPersonButtonProps {
  active: boolean;
  onToggle: () => void;
}

/**
 * TouchJoystick — virtual joystick overlay for touch / mouse-drag movement
 * during walkthrough. Outputs normalized {axisX, axisZ} where axisX is
 * strafe (+ right) and axisZ is forward push (+ forward). Same component
 * as HouseCanvas uses; promoted to FirstPersonControls.tsx so both
 * RoomCanvas and HouseCanvas can share one implementation.
 */
export function TouchJoystick({ onChange }: { onChange: (axisX: number, axisZ: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeRef = useRef<number | null>(null);
  const radius = 48;
  const knobR = 22;
  const update = (e: React.PointerEvent) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const r = Math.hypot(dx, dy);
    if (r > radius) { dx *= radius / r; dy *= radius / r; }
    setKnob({ x: dx, y: dy });
    onChange(dx / radius, -dy / radius);  // y flipped: screen-up = forward = +axisZ
  };
  const onDown = (e: React.PointerEvent) => {
    activeRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (activeRef.current !== e.pointerId) return;
    update(e);
  };
  const onUp = (e: React.PointerEvent) => {
    if (activeRef.current !== e.pointerId) return;
    activeRef.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };
  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute bottom-32 left-6 z-20 select-none"
      style={{
        width: radius * 2, height: radius * 2,
        borderRadius: "50%",
        background: "rgba(0,0,0,0.32)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.18)",
        touchAction: "none",
      }}
    >
      <div style={{
        position: "absolute",
        left: radius - knobR + knob.x,
        top: radius - knobR + knob.y,
        width: knobR * 2,
        height: knobR * 2,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.5)",
        pointerEvents: "none",
        transition: activeRef.current === null ? "all 0.18s" : "none",
      }} />
    </div>
  );
}

export function FirstPersonButton({ active, onToggle }: FirstPersonButtonProps) {
  return (
    <button
      onClick={onToggle}
      title={active ? "退出第一人称 (ESC)" : "进入第一人称漫游 (W/A/S/D)"}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
      style={active
        ? { background: "#4F46E5", color: "#fff", border: "1px solid #4338CA" }
        : { background: "var(--ds-surface)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }
      }
    >
      {active ? "🚶 退出漫游" : "🚶 第一人称"}
    </button>
  );
}
