"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SLAT_COUNT = 16;
const SLAT_GAP = 0.005;
const FRAME_THICKNESS = 0.06;
const FRAME_DEPTH = 0.08;
const SLAT_DEPTH = 0.02;
const FRAME_COLOR = "#8a8a8a";
const SLAT_COLOR = "#c0c0c0";

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
  const slatRefs = useRef<(THREE.Mesh | null)[]>([]);
  const animProgress = useRef(0);

  useEffect(() => {
    slatRefs.current = slatRefs.current.slice(0, SLAT_COUNT);
  }, []);

  const slatH = (height - SLAT_GAP * (SLAT_COUNT - 1)) / SLAT_COUNT;
  const innerW = width - FRAME_THICKNESS * 2;

  useFrame((_, delta) => {
    const target = isOpen ? 1 : 0;
    const diff = target - animProgress.current;
    if (Math.abs(diff) > 0.001) {
      animProgress.current += diff * Math.min(1, delta * 5);
    } else {
      animProgress.current = target;
    }

    const t = animProgress.current;
    for (let i = 0; i < SLAT_COUNT; i++) {
      const mesh = slatRefs.current[i];
      if (!mesh) continue;
      const closedY = slatH / 2 + i * (slatH + SLAT_GAP);
      const openY = height - (SLAT_COUNT - i) * 0.008;
      mesh.position.y = THREE.MathUtils.lerp(closedY, openY, t);
      mesh.scale.y = THREE.MathUtils.lerp(1, 0.05, t);
    }
  });

  return (
    <group position={position} rotation={rotation} onClick={onClick}>
      {/* Left frame rail */}
      <mesh castShadow receiveShadow position={[FRAME_THICKNESS / 2, height / 2, 0]}>
        <boxGeometry args={[FRAME_THICKNESS, height, FRAME_DEPTH]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Right frame rail */}
      <mesh castShadow receiveShadow position={[width - FRAME_THICKNESS / 2, height / 2, 0]}>
        <boxGeometry args={[FRAME_THICKNESS, height, FRAME_DEPTH]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Top housing */}
      <mesh castShadow receiveShadow position={[width / 2, height + FRAME_THICKNESS / 2, 0]}>
        <boxGeometry args={[width, FRAME_THICKNESS, FRAME_DEPTH * 1.5]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Slats */}
      {Array.from({ length: SLAT_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => { slatRefs.current[i] = el; }}
          castShadow
          receiveShadow
          position={[width / 2, slatH / 2 + i * (slatH + SLAT_GAP), 0]}
        >
          <boxGeometry args={[innerW, slatH, SLAT_DEPTH]} />
          <meshStandardMaterial
            color={SLAT_COLOR}
            roughness={0.4}
            metalness={0.2}
          />
        </mesh>
      ))}
    </group>
  );
}
