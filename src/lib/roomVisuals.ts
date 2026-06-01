// ─── 房间视觉一致性：效果图 / 外观图 共享色值（唯一真源）────────────
//
// 背景：效果图（RoomCanvas）与外观图（FloorPlanExterior / ConcreteFacade）
// 是两条独立渲染路径。它们各自渲染门/窗/墙时，若各写各的色值，必然
// 出现"效果图白框浅蓝玻璃、外观黑框深玻璃"这类不一致。
//
// 这里把门窗的标准视觉色值收敛到一处。两条路径都从本模块取默认值：
//   • RoomCanvas        → 直接用这些常量画窗框/玻璃/窗梃；
//   • FloorPlanExterior → 作为 exterior.* 配置缺省时的 fallback。
// 改一处，两个视图同步，杜绝"手动凑色"导致的漂移。
//
// 注意：这些是「默认值」。用户在 exterior.* 里显式配置的颜色仍优先生效
// （保持可配置，满足上线需求）；只有未配置时，外观才回落到效果图同款值。

/** 窗户玻璃色（效果图程序化窗默认）。白天外观玻璃 opacity=1 不透明，
 *  此色仅作表面反射色，安全。 */
export const WINDOW_GLASS_COLOR = "#BED3E8";

/** 窗框色（白色铝框 / PVC 框）。 */
export const WINDOW_FRAME_COLOR = "#F4F4F2";

/** 窗梃（中挺 / mullion）色，比窗框略深一档。 */
export const WINDOW_MULLION_COLOR = "#E8E8E4";

/** 入户门门扇色（灰，对齐效果图 door_with_frame.gltf 灰门贴图均色
 *  ≈ rgb(152,147,151)）。 */
export const ENTRANCE_DOOR_COLOR = "#9C9699";

/** 入户门门套 / 门框色（浅灰，匹配效果图门框）。 */
export const ENTRANCE_DOOR_CASING_COLOR = "#C7C4C7";

/** 入户门金属把手色（拉丝金属）。 */
export const ENTRANCE_DOOR_HANDLE_COLOR = "#B7BBC0";
