/**
 * Z-layer ordering & z-fight防护 helper.
 *
 * 标准 CAD viewer / Maya / D5 都靠两层方法防止"两个共面 mesh 闪烁"：
 *
 * 1. 位移层级（这个文件的 Z_LAYER）— 给每类 mesh 一个语义高度，越上层
 *    数值越大；render 时 mesh 的位置在它的 "vector toward camera" 方向
 *    上偏移 layer × 1mm。逻辑层面"墙在地板上、装饰在墙上、贴纸在装饰上"。
 *
 * 2. GPU polygonOffset — 距离远的时候 depth buffer 精度不够，光靠位移
 *    还是会闪。打开材质的 `polygonOffset: true` 让 GPU 在 rasterize
 *    时自动调整 depth value（factor 负数 = 推近相机）。这是 CAD 行业
 *    标配，对 sticker / 贴纸 / decal 类几乎必须开。
 *
 * 用法：
 *   <mesh position={[x, y, z + getLayerOffset("artwork")]}>
 *     <meshStandardMaterial color="..." {...overlayMaterialProps()} />
 *   </mesh>
 *
 * 或者直接用 <Layered layer="artwork"> 包装，最少改动。
 */

export const Z_LAYER = {
  /** 楼板 / 地板 / 大地 */
  ground: 0,
  /** 房间地板（贴在 ground 之上） */
  floor: 1,
  /** 地毯 */
  rug: 2,
  /** 网格线 / floor decal */
  floorDecal: 3,
  /** 墙体本体（内 / 外） */
  wall: 0,
  /** 墙裙 / 护墙板 */
  wainscot: 1,
  /** 窗户玻璃 / 门洞门板 */
  windowGlass: 2,
  /** 壁画 / 镜子 / 室内挂画 */
  artwork: 3,
  /** 灯条 / 装饰边框 */
  trim: 4,
  /** 外墙装饰 */
  exteriorDecor: 3,
  /** 春联 / 门牌 / 国旗等"超浅贴" */
  sticker: 5,
  /** 天花板本体 */
  ceiling: 0,
  /** 天花装饰（吊顶造型） */
  ceilingTrim: 1,
} as const;

/** 单位 mm（converted to m below）。1mm 是经验值——足够区分 layer 又
 *  不会让物体明显悬空。 */
const STEP_MM = 1;

/** 把 layer 索引转成位移量（meters）。常用法是直接加在 mesh position 上。 */
export function getLayerOffset(layer: keyof typeof Z_LAYER): number {
  return (Z_LAYER[layer] * STEP_MM) / 1000;
}

/** 给"贴在底层 mesh 上"的 overlay 材质用，开启 GPU polygonOffset。
 *  注意：底层 mesh 不需要这个，只有上面的 overlay 需要。
 *
 *  factor / units 经验值：
 *  - -1, -1 适合 stickers / decals（最常用）
 *  - -2, -2 适合相隔多层的复杂叠加（外墙装饰之上又叠了贴纸）
 *  - -3, -3 适合"门板玻璃压在门框 + 门洞 + 墙体"这种叠了三层的开口件
 */
export function overlayMaterialProps(strength: 1 | 2 | 3 = 1) {
  return {
    polygonOffset: true,
    polygonOffsetFactor: -strength,
    polygonOffsetUnits: -strength,
  } as const;
}
