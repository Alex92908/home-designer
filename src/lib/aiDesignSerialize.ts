/**
 * Serialize the current designer state into the same AiDesignResult shape the
 * AI emits. Used by 增量微调 (edit mode): we hand this snapshot to the model as
 * `current` so it can patch the existing home instead of rebuilding from
 * scratch. Keeping input/output one schema means applyAiDesign can re-apply
 * the edited result unchanged.
 */
import type { ExteriorSettings, FloorPlan } from "./types";
import type { AiDesignResult, AiDesignYardItem } from "./aiDesignTypes";

const VALID_ROOF_TYPES = ["flat", "gable", "hip", "chinese"] as const;

export function serializeCurrentDesign(
  floorPlans: FloorPlan[],
  exterior: ExteriorSettings,
): AiDesignResult {
  const floors = Math.max(1, exterior.floors);
  const floorLayouts = [];
  for (let fi = 0; fi < floors; fi++) {
    const fp = floorPlans[fi];
    if (!fp) continue;
    const rooms = fp.enabledRooms.map((rt) => {
      const pos = fp.roomLayout[rt] ?? { x: 50, y: 50 };
      const dim = fp.roomDimensions[rt] ?? { width: 300, depth: 260 };
      // 现有家具回传成 { id, x, y }，让 edit 模式能保住手动摆的家具+位置。
      // 取整：避免回传一长串小数把 prompt/输出撑大（容易触发截断 → JSON 解析失败）。
      const furniture = (fp.rooms[rt]?.placedItems ?? []).map((p) => ({
        id: p.furnitureId, x: Math.round(p.x), y: Math.round(p.z),
        // 朝向/缩放/吊顶：非默认值才回传，省 token；让 edit 模式保住手动调过的家具姿态。
        ...(p.rotation ? { rotation: p.rotation } : {}),
        ...(p.scaleW != null && p.scaleW !== 1 ? { scaleW: p.scaleW } : {}),
        ...(p.scaleD != null && p.scaleD !== 1 ? { scaleD: p.scaleD } : {}),
        ...(p.scaleH != null && p.scaleH !== 1 ? { scaleH: p.scaleH } : {}),
        ...(p.elevationY ? { elevationY: Math.round(p.elevationY) } : {}),
        ...(p.mountCeiling ? { mountCeiling: true } : {}),
      }));
      // 回传当前材质 id（墙/地/灯/砖），让 edit 模式能看到现状并只改用户点名的那项。
      const mats = fp.rooms[rt]?.materials;
      // 回传当前窗户（精简成 wall/pos/len/h/sill，去掉 id 省 token）与开放/拆墙的 NSWE。
      const wins = (fp.roomWindows?.[rt] ?? []).map((w) => ({
        wall: w.wall, pos: Math.round(w.pos), len: Math.round(w.len),
        ...(w.h != null ? { h: Math.round(w.h) } : {}),
        ...(w.sill != null ? { sill: Math.round(w.sill) } : {}),
        ...(w.style ? { style: w.style } : {}),
        // 多边形房间的窗绑定边索引：必须回传，AI 照抄后 applyAiDesign 才能还原；
        // 丢了的话 L 型房内折角墙上的窗会跑到错误的墙段。
        ...(w.edgeIndex != null ? { edgeIndex: w.edgeIndex } : {}),
      }));
      const openWalls = Object.entries(fp.roomWallsHidden?.[rt] ?? {})
        .filter(([k, v]) => v && (k === "N" || k === "S" || k === "W" || k === "E"))
        .map(([k]) => k as "N" | "S" | "W" | "E");
      const doorStyle = fp.roomDoorStyle?.[rt];
      const doorWall = fp.roomDoorWall?.[rt];
      const doorPos = fp.roomDoorPos?.[rt];
      const doorLen = fp.roomDoorLen?.[rt];
      const hasDoor = fp.roomHasDoor?.[rt];
      const shape = fp.roomShapes?.[rt]?.preset;
      const extStyle = fp.roomExteriorStyle?.[rt];
      // 外墙装饰：回传精简版（id/wall/u/v 两位小数），edit 模式整组重建语义。
      const wallDecor = (fp.rooms[rt]?.exteriorDecor ?? []).map((d) => ({
        id: d.furnitureId, wall: d.wall,
        u: Math.round(d.u * 100) / 100, v: Math.round(d.v * 100) / 100,
      }));
      // 多门数组（新 schema）：有就回传精简版，让 edit 模式能改单扇门。
      const doors = (fp.roomDoors?.[rt] ?? []).map((d) => ({
        wall: d.wall, pos: Math.round(d.pos),
        ...(d.len != null ? { len: Math.round(d.len) } : {}),
        ...(d.h != null ? { h: Math.round(d.h) } : {}),
        ...(d.style ? { style: d.style } : {}),
      }));
      return {
        type: rt,
        widthCm: Math.round(dim.width),
        depthCm: Math.round(dim.depth),
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        furniture,
        ...(mats?.wall?.id  ? { wall:  mats.wall.id  } : {}),
        ...(mats?.floor?.id ? { floor: mats.floor.id } : {}),
        ...(mats?.light?.id ? { light: mats.light.id } : {}),
        ...(mats?.tile?.id  ? { tile:  mats.tile.id  } : {}),
        ...(mats?.ceiling?.id   ? { ceiling:   mats.ceiling.id   } : {}),
        ...(mats?.wallLower?.id ? { wallLower: mats.wallLower.id } : {}),
        ...(wins.length ? { windows: wins } : {}),
        ...(openWalls.length ? { openWalls } : {}),
        ...(doorStyle ? { door: doorStyle } : {}),
        ...(doorWall ? { doorWall } : {}),
        ...(doorPos != null ? { doorPos: Math.round(doorPos) } : {}),
        ...(doorLen != null ? { doorLen: Math.round(doorLen) } : {}),
        ...(hasDoor === false ? { hasDoor: false } : {}),
        ...(doors.length ? { doors } : {}),
        ...(wallDecor.length ? { wallDecor } : {}),
        // custom 多边形不回传（点坐标太长），只回传预设形状名。
        ...(shape && shape !== "rect" && shape !== "custom" ? { shape } : {}),
        ...(extStyle && extStyle !== "auto" ? { exteriorStyle: extStyle } : {}),
      };
    });
    floorLayouts.push({ floorIndex: fi, rooms });
  }

  const roofType = (VALID_ROOF_TYPES as readonly string[]).includes(exterior.roofStyle)
    ? (exterior.roofStyle as AiDesignResult["exterior"]["roofType"])
    : undefined;

  // 院子（floor 0）现状：只回传 AI 能产出的两类——结构件 prefab 与单体 kind，
  // 取整坐标省 token。zone/glb 等复杂项不回传（AI 也不直接生成它们）。
  const yardItems = floorPlans[0]?.yardPlan?.items ?? [];
  const yardAdd: AiDesignYardItem[] =
    yardItems.flatMap((it): AiDesignYardItem[] => {
      if (it.type === "prefab") {
        if (!["pool", "pergola_classic", "outdoor_kitchen", "fountain"].includes(it.prefabKind)) return [];
        return [{ prefab: it.prefabKind as "pool", x: Math.round(it.x), z: Math.round(it.z) }];
      }
      if (it.type === undefined || it.type === "singleton") {
        return [{ kind: (it as { kind: string }).kind, x: Math.round(it.x), z: Math.round(it.z) }];
      }
      return [];
    });

  return {
    floors,
    exterior: {
      preset: exterior.preset,
      wallColor: exterior.wallColor,
      roofColor: exterior.roofColor,
      roofType,
      accentColor: exterior.accentColor,
      hasRooftop: exterior.hasRooftop,
      ...(exterior.wallMaterial ? { wallMaterial: exterior.wallMaterial } : {}),
      ...(exterior.footprintShape && exterior.footprintShape !== "rect"
        ? { footprintShape: exterior.footprintShape } : {}),
    },
    floorLayouts,
    ...(yardAdd.length ? { yard: { add: yardAdd } } : {}),
  };
}
