// 门的 3D 定位「单一真源」——效果图(RoomCanvas.RoomDoor3D)与漫游/外观
// (WalkthroughDoor3D)共用同一套落位算法，杜绝两处手写导致的分叉。
//
// 历史分叉(本函数消除)：两套曾各写一份 switch，W 墙定位一处翻转、一处没翻
// → 同一扇 W 墙门在效果图/漫游里落到不同世界坐标。本函数采用效果图那版**正确**的
// W 墙翻转 + 角落 clamp(注释见原 RoomDoor3D，修过「符号写反」bug)，两图统一。
//
// 薄/厚墙差异用 `wallInset` 参数吸收(效果图 0 厚平面墙 0.02 / 漫游 10cm 厚盒子墙
// 0.08)；外观图门凸出墙面用 `outwardProtrude`。几何/朝向本身两图一致。

import type { WallSide } from "./types";

/** 门离墙角至少留的边(米)——门洞与门板都按此 clamp，避免贴角露白竖条。 */
export const DOOR_CORNER_MARGIN = 0.06;

export interface DoorTransform {
  /** 门板父组(铰链)在房间局部中心坐标系的位置。 */
  groupPos: [number, number, number];
  /** 门板父组绕 Y 的旋转。 */
  groupRot: [number, number, number];
  /** 关门时门板在局部 +X 延伸方向(始终 1)。 */
  hingeOffset: number;
  /** 受墙长约束后的门实际宽度(米)。 */
  doorW: number;
  /** 门沿墙的落位(米，已翻转/clamp)。 */
  doorPos: number;
}

/**
 * 计算门板父组(铰链)的世界局部变换。房间中心坐标系：原点房间中心，x→东，z→南。
 * @param doorWall 门所在墙 N/S/W/E
 * @param W,D      房间宽(x)/深(z)，米
 * @param doorPosCm 门沿墙位置(cm，北参照，与 2D/getRoomDoors 同口径)
 * @param doorLenCm 门宽(cm)
 * @param wallInset 门板贴墙内缩(米)：薄平面墙 0.02 / 厚盒子墙 0.08
 * @param outwardProtrude 沿墙外法线向外推(米)，外观图让门凸出墙面不被厚墙挡；默认 0
 */
export function computeDoorTransform(
  doorWall: WallSide,
  W: number,
  D: number,
  doorPosCm: number,
  doorLenCm: number,
  wallInset = 0.02,
  outwardProtrude = 0,
): DoorTransform | null {
  // 门宽受所在墙物理长度约束：宽度优先，位置回推。
  const wallLenForDoor = (doorWall === "N" || doorWall === "S") ? W : D;
  const doorW = Math.max(0.5, Math.min(doorLenCm / 100, wallLenForDoor));
  const doorCornerM = Math.min(DOOR_CORNER_MARGIN, Math.max(0, (wallLenForDoor - doorW) / 2));
  // W 墙翻转：门 pos 北参照，而 W 墙 wall-local x 从南端起，故把 pos 翻成
  // 「墙长-pos-门宽」再套用；E/N/S 无需翻转。(效果图那版的正确逻辑)
  const rawDoorPos = doorWall === "W" ? wallLenForDoor - doorPosCm / 100 - doorW : doorPosCm / 100;
  const doorPos = Math.max(doorCornerM, Math.min(rawDoorPos, wallLenForDoor - doorW - doorCornerM));

  let groupPos: [number, number, number];
  let groupRot: [number, number, number];
  switch (doorWall) {
    case "N": // 后墙 z=-D/2
      groupPos = [doorPos - W / 2, 0, -D / 2 + wallInset];
      groupRot = [0, 0, 0];
      break;
    case "S": // 前墙 z=+D/2，绕 Y 转 180° 使门朝室内(-Z)
      groupPos = [-W / 2 + doorPos + doorW, 0, D / 2 - wallInset];
      groupRot = [0, Math.PI, 0];
      break;
    case "W": // 西墙 x=-W/2，转 +90°；铰链落门洞 +Z 南缘 = D/2 - doorPos
      groupPos = [-W / 2 + wallInset, 0, D / 2 - doorPos];
      groupRot = [0, Math.PI / 2, 0];
      break;
    case "E": // 东墙 x=+W/2，转 -90°
      groupPos = [W / 2 - wallInset, 0, -(doorPos - D / 2) - doorW];
      groupRot = [0, -Math.PI / 2, 0];
      break;
    default:
      return null;
  }

  // 外观图：沿墙外法线往外推，使门凸出墙面、不被 10cm 厚墙遮挡。
  // 各墙外法线：N=-Z, S=+Z, W=-X, E=+X。
  if (outwardProtrude !== 0) {
    switch (doorWall) {
      case "N": groupPos = [groupPos[0], groupPos[1], groupPos[2] - outwardProtrude]; break;
      case "S": groupPos = [groupPos[0], groupPos[1], groupPos[2] + outwardProtrude]; break;
      case "W": groupPos = [groupPos[0] - outwardProtrude, groupPos[1], groupPos[2]]; break;
      case "E": groupPos = [groupPos[0] + outwardProtrude, groupPos[1], groupPos[2]]; break;
    }
  }

  return { groupPos, groupRot, hingeOffset: 1, doorW, doorPos };
}
