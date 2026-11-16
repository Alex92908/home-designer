/**
 * ProceduralFurnitureMesh — 程序化家具的 R3F 包装。
 *
 * 薄包装：useMemo 里调 `buildProceduralGeometry`（纯 three.js，见
 * `src/lib/proceduralFurniture.ts`）生成 Group，`<primitive>` 挂上去；
 * 卸载时遍历释放几何体/材质。未知 id（理论上不应发生，harness 会拦）
 * 回退成一件与目录颜色/尺寸一致的素盒子，不让场景崩掉。
 *
 * 调用点：RoomCanvas `FurnitureMesh` 顶部按 `proc-` 前缀分流（与
 * sign-shop-fascia / stall-door 等 id 特例同一路数）；PlacedItemMesh
 * 的 group 已处理位置/朝向/缩放/台面吸附，这里只负责几何本身。
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { FurnitureItem } from "@/lib/types";
import { buildProceduralGeometry } from "@/lib/proceduralFurniture";

export function ProceduralFurnitureMesh({ item, w, d, h }: {
  item: FurnitureItem;
  w: number; // 米
  d: number; // 米
  h: number; // 米
}) {
  const group = useMemo(
    () => buildProceduralGeometry(item.id, w, d, h, item.color, item.secondaryColor),
    [item.id, item.color, item.secondaryColor, w, d, h],
  );

  useEffect(() => {
    return () => {
      group?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) (m as THREE.Material | undefined)?.dispose?.();
        }
      });
    };
  }, [group]);

  if (!group) {
    return (
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={item.color || "#888888"} roughness={0.8} />
      </mesh>
    );
  }
  // eslint-disable-next-line react/no-unknown-property
  return <primitive object={group} />;
}
