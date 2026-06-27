"use client";

/**
 * RollerShutterDoor — real GLB roller-shutter garage door.
 *
 * Source model: public/models/_arch_door/roller_shutter/roller_shutter.glb
 *   · 16 shutter slats (`gartentor_part_*`) animated by NODE transforms via one
 *     clip "gartentor": t=0 = closed (slats down), t=end = rolled up (open).
 *   · an 8×8 backdrop plane + bulky frame slab we hide.
 *
 * Cloned per instance (SkeletonUtils) so two doors never fight over one scene;
 * useAnimations retargets the clip to the clone by node name. Orientation: the
 * FBX→glTF root lays it flat, so the inner `content` group stands it upright.
 * Positioning is taken from the posed slat nodes (their world bbox is the real
 * door) so the shutter centres on the opening with its top at the lintel.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

const URL = "/models/_arch_door/roller_shutter/roller_shutter.glb";
useGLTF.preload(URL);

export function RollerShutterDoor({
  width,
  height,
  isOpen,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  onClick,
}: {
  width: number;
  height: number;
  isOpen: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (e: { stopPropagation: () => void }) => void;
}) {
  const placement = useRef<THREE.Group>(null);
  const fit = useRef<THREE.Group>(null);
  const content = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(URL);

  const model = useMemo(() => {
    const c = skeletonClone(scene) as THREE.Object3D;
    const drop: THREE.Object3D[] = [];
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (/^Plane/.test(o.name) || /^Cube_037_/.test(o.name)) drop.push(o);
      }
    });
    for (const o of drop) o.removeFromParent();
    return c;
  }, [scene]);

  const { actions, names } = useAnimations(animations, placement);

  // Scale to fit the opening width. Guarded — a throw in an effect/frame is NOT
  // caught by React error boundaries and would crash the whole R3F render loop
  // (blank scene), so we swallow any geometry-math failure here.
  useLayoutEffect(() => {
    try {
      const p = placement.current, f = fit.current, c = content.current;
      if (!p || !f || !c) return;
      f.scale.setScalar(1);
      f.position.set(0, 0, 0);
      p.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && o.visible && m.geometry) {
          m.geometry.computeBoundingBox();
          box.expandByObject(m);
        }
      });
      if (box.isEmpty()) return;
      box.applyMatrix4(p.matrixWorld.clone().invert());
      const size = box.getSize(new THREE.Vector3());
      if (size.x < 1e-4 || size.y < 1e-4) return;
      f.scale.setScalar(Math.min(width / size.x, height / size.y));
      f.updateMatrixWorld(true);
    } catch { /* ignore — keep the scene alive */ }
  }, [model, width, height]);

  // Position from the posed slat nodes (run until they've posed).
  const placed = useRef(false);
  useLayoutEffect(() => { placed.current = false; }, [model, width, height]);
  useFrame(() => {
    if (placed.current) return;
    try {
      const p = placement.current, f = fit.current;
      if (!p || !f) return;
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      let any = false;
      p.traverse((o) => {
        if (/^gartentor_part/.test(o.name)) { box.expandByPoint(o.getWorldPosition(v)); any = true; }
      });
      if (!any || box.isEmpty()) return;
      p.updateWorldMatrix(true, true);
      box.applyMatrix4(p.matrixWorld.clone().invert());
      f.position.x -= (box.min.x + box.max.x) / 2;
      f.position.y -= box.max.y;
      f.position.z -= (box.min.z + box.max.z) / 2;
      f.updateMatrixWorld(true);
      placed.current = true;
    } catch { placed.current = true; /* give up positioning, keep scene alive */ }
  });

  // Open/close. t=0 = closed (down), t=end = open (rolled). ~25s clip → 6×;
  // snap to target on first mount.
  const firstRef = useRef(true);
  useEffect(() => {
    const action = names.length ? actions[names[0]] : null;
    if (!action) return;
    const dur = action.getClip().duration;
    action.loop = THREE.LoopOnce;
    action.clampWhenFinished = true;
    action.enabled = true;
    action.paused = false;
    action.timeScale = (isOpen ? 1 : -1) * 6;
    action.play();
    if (firstRef.current) {
      action.time = isOpen ? dur : 0;
      firstRef.current = false;
    }
  }, [isOpen, actions, names]);

  return (
    <group ref={placement} position={position} rotation={rotation} onClick={onClick}>
      <group ref={fit}>
        <group ref={content} rotation={[-Math.PI / 2, 0, 0]}>
          <primitive object={model} />
        </group>
      </group>
    </group>
  );
}
