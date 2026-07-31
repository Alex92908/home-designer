"use client";

// NSWE 方位标「方牌 + 字母」的共享视觉组件——效果图(RoomCanvas)与漫游/外观
// (FloorPlanExterior)共用同一份，杜绝两处内联 Decal 的结构分叉；也去掉
// 「组件在 render 里内联定义」的 lint 问题。
//
// 字号/牌比例/颜色/描边等按观看距离不同由调用方传参（效果图近看小号粉字，
// 漫游/外观远看大号分房间配色），视觉刻意不同、但结构一份。

import * as THREE from "three";
import { Text } from "@react-three/drei";

export function WallCompassDecal({
  letter,
  pos,
  rot,
  color,
  fontSize = 0.32,
  plaqueRatio = 1.8,
  outlineRatio = 0.10,
  plateZ = -0.01,
  renderOrder = 0,
}: {
  letter: string;
  pos: [number, number, number];
  rot: [number, number, number];
  /** 字母颜色（效果图固定粉 #FF1493 / 外观图按房间取色）。 */
  color: string;
  /** 字母高度（米）。默认 0.32（漫游远看）。 */
  fontSize?: number;
  /** 白方牌边长 = fontSize × 此比例。默认 1.8。 */
  plaqueRatio?: number;
  /** 描边宽 = fontSize × 此比例。默认 0.10。 */
  outlineRatio?: number;
  /** 白方牌相对字母的 z 偏移（米，负=贴牌在字后）。默认 -0.01。 */
  plateZ?: number;
  /** renderOrder：外观图用 50 让方牌在同深度桶里压过相邻墙的镜像字。默认 0。 */
  renderOrder?: number;
}) {
  const plaqueSize = fontSize * plaqueRatio;
  return (
    <group position={pos} rotation={rot} renderOrder={renderOrder}>
      {/* 不透明白底牌——挡住 troika-text 忽略 material-side 时从背面漏出的镜像字。 */}
      <mesh position={[0, 0, plateZ]} raycast={() => null}>
        <planeGeometry args={[plaqueSize, plaqueSize]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <Text
        fontSize={fontSize}
        color={color}
        outlineWidth={fontSize * outlineRatio}
        outlineColor="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        {letter}
      </Text>
    </group>
  );
}
