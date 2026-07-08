/**
 * cinematic —— 电影机位路径（studio-mvp / 云横店孵化第一块砖）。
 *
 * 把「白膜 previz → AI 视频」管线的机位部分做成数据：一条路径 = 随时间 t
 * (0→1) 变化的 (相机位置, 注视点, fov)。MVP 提供三个参数化预设（按建筑
 * 尺寸自动取景），后续再上关键帧编辑器。
 *
 * 产物用途：外观图里按路径播放并用 MediaRecorder 录成短片 + 首/尾帧 PNG，
 * 直接可喂即梦/Kling 的图生视频、首尾帧模式。
 */

export interface CameraSample {
  /** 世界坐标相机位置 */
  pos: [number, number, number];
  /** 注视点 */
  lookAt: [number, number, number];
  /** 视场角（度） */
  fov: number;
}

export interface CinePreset {
  id: string;
  /** 中文名（UI 展示） */
  nameZh: string;
  nameEn: string;
  /** 建议时长（秒）——对齐主流视频模型 5s/10s 档 */
  duration: number;
  /** 按建筑包络采样：t∈[0,1] → 相机状态 */
  sample: (t: number, env: SceneEnvelope) => CameraSample;
}

/** 取景所需的场景包络（由外观图现算传入） */
export interface SceneEnvelope {
  /** 地面层footprint（米） */
  W: number;
  D: number;
  /** 层数 */
  floors: number;
}

const FLOOR_H = 2.8;

/** 平滑步进（两端缓入缓出），机位不匀速才有"摇臂感" */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export const CINE_PRESETS: CinePreset[] = [
  {
    id: "orbit",
    nameZh: "环绕一圈",
    nameEn: "Orbit 360°",
    duration: 10,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const r = Math.max(W, D) * 1.15 + 8;
      // 从东南角起转（与默认视角接近，起幅不突兀），逆时针一整圈
      const a = Math.PI * 0.25 + t * Math.PI * 2;
      return {
        pos: [Math.sin(a) * r, h * 0.85 + 2, Math.cos(a) * r],
        lookAt: [0, h * 0.45, 0],
        fov: 45,
      };
    },
  },
  {
    id: "dolly-in",
    nameZh: "推近入户",
    nameEn: "Dolly In",
    duration: 8,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const e = easeInOut(t);
      const far = Math.max(W, D) * 1.6 + 14;
      const near = Math.max(W, D) * 0.55 + 4;
      const r = far + (near - far) * e;
      // 南侧正面推近，镜头略降（远景俯瞰 → 近景平视，入户视角）
      const a = Math.PI * 0.12; // 略偏东南，立面有透视
      return {
        pos: [Math.sin(a) * r, (h * 0.9 + 4) * (1 - e) + 1.7 * e, Math.cos(a) * r],
        lookAt: [0, h * 0.4 * (1 - e) + 1.5 * e, 0],
        fov: 45 + 5 * e, // 推近时略广，加速度感
      };
    },
  },
  {
    id: "crane-up",
    nameZh: "摇臂升起",
    nameEn: "Crane Up",
    duration: 8,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const e = easeInOut(t);
      const r0 = Math.max(W, D) * 0.7 + 5;
      const r1 = Math.max(W, D) * 1.3 + 10;
      const r = r0 + (r1 - r0) * e;
      // 人眼高度起，升到俯瞰全宅 + 院子；水平方向缓慢右摇 40°
      const a = Math.PI * 0.2 + e * (Math.PI * 0.22);
      return {
        pos: [Math.sin(a) * r, 1.7 + (h + Math.max(W, D) * 0.55) * e, Math.cos(a) * r],
        lookAt: [0, (1.5 + h * 0.35 * e) * 1, 0],
        fov: 48 - 6 * e, // 升高时略收，画面更"航拍"
      };
    },
  },
];

export function getCinePreset(id: string): CinePreset | undefined {
  return CINE_PRESETS.find((p) => p.id === id);
}

/** 导出风格（并列可选，实景默认——实景渲染本身就是最强参考视频）：
 *  beauty 实景成品渲染；clay 白模灰盒（锁空间构图运动，材质交 AI 发挥，
 *  Seedance previz 规格）；depth 深度序列（近白远黑，VACE/ControlNet 输入）。 */
export type RenderStyle = "beauty" | "clay" | "depth";

export const RENDER_STYLES: Array<{ id: RenderStyle; nameZh: string; nameEn: string }> = [
  { id: "beauty", nameZh: "实景", nameEn: "Beauty" },
  { id: "clay", nameZh: "白模", nameEn: "Clay" },
  { id: "depth", nameZh: "深度", nameEn: "Depth" },
];

/** 演员占位（方块人级别即可——AI 上色阶段会替换成真人）。
 *  from/to 为地面世界坐标 [x, z]，录制时随播放头 t 从 from 走到 to。 */
export interface Actor {
  id: string;
  from: [number, number];
  to: [number, number];
}

export function makeActor(from: [number, number], to: [number, number]): Actor {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    from,
    to,
  };
}

/** 分镜里的一个镜头（Shot——产品的原子单位，见云横店蓝图 §三） */
export interface Shot {
  id: string;
  presetId: string;
  /** 时长（秒），可在预设默认值上微调 */
  duration: number;
  /** 本镜提示词（风格/内容描述），随控制包 storyboard.json 导出 */
  prompt: string;
}

export function makeShot(presetId: string): Shot {
  const preset = getCinePreset(presetId);
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    presetId,
    duration: preset?.duration ?? 8,
    prompt: "",
  };
}
