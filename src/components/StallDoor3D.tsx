"use client";

import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * StallDoor3D — 公共卫生间「隔间门」，可点击 / 漫游 E 键开合。
 *
 * 复用房间门的做法（WalkthroughDoor3D 同款 useFrame 指数平滑 + 铰链绕轴旋转），
 * 但做成**自包含、每实例本地开合态**的家具组件：不接房间门的 openMap / store，
 * 所以对房间门管线零改动、零回归风险。由 PlacedItemMesh 按 furnitureId==="stall-door"
 * 分支渲染，位置/朝向走通用家具手柄（parent group 已套好 position+rotationY）。
 *
 * 几何：门扇沿本地 +X 展开（长度 fw），铰链在 -X 边；rotation.y 从 0 摆到
 * swingSign·π/2。两侧细门框柱标示门洞。高度 fh（隔间门上下留空，同真实公厕）。
 *
 * 交互：
 *  - 点击门扇 → 开/关（效果图 / 全屋3D 轨道视角下用；RoomCanvas 已开启 raycast）。
 *  - 漫游模式按 E → FirstPersonControls 派发 "firstperson:interact"（带相机世界坐标）；
 *    门就近（<1.7m）自行开合。
 */
export function StallDoor3D({
  fw,
  fh,
  leafColor = "#D9D6CF",
  frameColor = "#B4B0A8",
  swingSign = 1,
}: {
  fw: number;
  fh: number;
  leafColor?: string;
  frameColor?: string;
  /** 摆向：+1 绕铰链向隔间内开（默认，公厕坑位内开），-1 向走道外开。
   *  男女厕左右镜像用 placedItem.mirrorX 翻转（PlacedItemMesh 里对 group 施加 scale.x=-1）。 */
  swingSign?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const pivot = useRef<THREE.Group>(null);
  const [open, setOpen] = useState(false);
  const anim = useRef(0);

  useFrame((_, delta) => {
    const target = open ? swingSign * (Math.PI / 2) : 0;
    const cur = anim.current;
    const diff = target - cur;
    if (Math.abs(diff) > 0.001) {
      // 帧率无关指数平滑（k≈12），与 WalkthroughDoor3D 手感一致。
      anim.current = cur + diff * (1 - Math.exp(-delta * 12));
      if (pivot.current) pivot.current.rotation.y = anim.current;
    } else if (anim.current !== target) {
      anim.current = target;
      if (pivot.current) pivot.current.rotation.y = target;
    }
  });

  // 漫游 E 键：就近开合。
  useEffect(() => {
    const onInteract = (e: Event) => {
      const det = (e as CustomEvent).detail as { position?: [number, number, number] } | undefined;
      if (!det?.position || !root.current) return;
      const wp = new THREE.Vector3();
      root.current.getWorldPosition(wp);
      const dx = wp.x - det.position[0];
      const dz = wp.z - det.position[2];
      if (Math.hypot(dx, dz) < 1.7) setOpen((o) => !o);
    };
    window.addEventListener("firstperson:interact", onInteract);
    return () => window.removeEventListener("firstperson:interact", onInteract);
  }, []);

  const jamb = 0.04; // 门框柱宽
  const t = 0.035; // 门扇厚
  return (
    <group ref={root}>
      {/* 两侧门框柱 */}
      <mesh position={[-fw / 2 - jamb / 2, fh / 2, 0]} castShadow>
        <boxGeometry args={[jamb, fh, 0.1]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[fw / 2 + jamb / 2, fh / 2, 0]} castShadow>
        <boxGeometry args={[jamb, fh, 0.1]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* 铰链在 -X 边，门扇向 +X 展开 */}
      <group ref={pivot} position={[-fw / 2, 0, 0]}>
        <mesh
          position={[fw / 2, fh / 2, 0]}
          castShadow
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <boxGeometry args={[fw - 0.02, fh - 0.04, t]} />
          <meshStandardMaterial color={leafColor} roughness={0.55} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
        {/* 门把手（远铰链端） */}
        <mesh position={[fw - 0.1, fh * 0.45, t / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 0.12, 10]} />
          <meshStandardMaterial color="#8C8C8C" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}
