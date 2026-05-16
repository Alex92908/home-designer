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

import { useEffect, useRef, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, Vector3 } from "three";

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
}

export function FirstPersonControls({
  enabled,
  onExit,
  floorY = 0,
  roomW = 5,
  roomD = 4,
}: FirstPersonControlsProps) {
  const { camera, gl } = useThree();

  const keys   = useRef<Record<string, boolean>>({});
  const locked = useRef(false);
  const yaw    = useRef(0);
  const pitch  = useRef(0);
  // Drag-to-look fallback: when PointerLock fails (iframe / mobile / browser
  // permission denied), fall back to "hold left button + drag to look".
  // dragRef holds the last pointer X/Y while the user is dragging; null
  // when not dragging. Drag handlers are wired alongside the lock handlers
  // and only do work when the lock isn't active.
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // ── Pointer lock + drag-look fallback ─────────────────────────────────────
  const requestLock = useCallback(() => {
    if (!enabled) return;
    try { gl.domElement.requestPointerLock(); } catch { /* SecurityError in iframes — drag-look fallback handles it */ }
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
      pitch.current  = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch.current));
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
      pitch.current  = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch.current));
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPUp = () => { dragRef.current = null; };
    const onKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const onKeyUp   = (e: KeyboardEvent) => { keys.current[e.code] = false; };

    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror",  onLockError);
    document.addEventListener("mousemove",         onMouseMove);
    window.addEventListener("pointerdown", onPDown);
    window.addEventListener("pointermove", onPMove);
    window.addEventListener("pointerup", onPUp);
    window.addEventListener("pointercancel", onPUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    // Try pointer lock once on first canvas click. If it fails (iframe
    // sandbox), drag-to-look picks up the slack on subsequent clicks.
    gl.domElement.addEventListener("click", requestLock);

    // Place camera inside the room (near the front wall, centred X, eye height Y).
    // This avoids the "all blank" bug where OrbitControls left the camera
    // outside the room and yaw=0 pointed it straight into back-face geometry.
    camera.position.set(
      0,                            // centre of room on X
      floorY + EYE_HEIGHT,          // eye height
      roomD * 0.35,                 // 35% into room from front wall (front=+D/2)
    );
    yaw.current   = 0;              // yaw=0 → camera looks in -Z → faces back wall
    pitch.current = 0;

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
      gl.domElement.removeEventListener("click", requestLock);
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
      dragRef.current = null;
    };
  }, [enabled, gl.domElement, camera, floorY, roomD, requestLock]);

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

    const fwd = +(k["KeyW"] || k["ArrowUp"])   - +(k["KeyS"] || k["ArrowDown"]);
    const str = +(k["KeyD"] || k["ArrowRight"]) - +(k["KeyA"] || k["ArrowLeft"]);

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
