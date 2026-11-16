"use client";

/**
 * CinematicDirector —— 分镜工作台 + 多风格录制 + 演员走位（云横店 M1-M3）
 * ＋ 导演台 MVP：一键搭片场、室内机位、具名角色走位、轴线、打斗单节 beat、
 * 9:16 取景框、带角色信息的控制包导出。
 *
 * 产品原子是 Shot（镜头）：机位预设 + 时长 + 提示词。用户排一组镜头（分镜），
 * 勾选导出风格（实景/白模/深度），一键批量拍摄——队列按「镜头 × 风格」展开，
 * 每次产出 参考视频 + 首/尾帧 PNG，末尾附 storyboard.json，整套即「控制包」：
 *   · 实景：本身就是最强参考视频（喂即梦/Kling 图生视频、首尾帧）
 *   · 白模：overrideMaterial 灰盒——Seedance 2.5 白模 previz 官方输入规格
 *   · 深度：近白远黑线性深度——Wan VACE / ControlNet 结构控制输入
 *
 * 演员走位（M3）：方块人级别的占位演员，在地面点两下设起点→终点，录制时
 * 随播放头行走——白模/深度 pass 同样入镜（这正是走位进 previz 的意义）。
 * 分工红线：我们锁 blocking（空间/构图/机位/走位时机），表演细节归下游 AI。
 *
 * 结构（跨 Canvas 内外，本文件内的 zustand store 通信）：
 *   <CinematicPanel/>       DOM：🎬 按钮 + 快拍 + 分镜 + 风格 + 演员 + 进度
 *   <CameraPathPlayer env/> Canvas 内：队列驱动相机 + 风格覆盖 + 录制下载
 *   <ActorsLayer/>          Canvas 内：演员放置（地面点选）+ 渲染 + 行走
 *
 * 录制期间接管相机（禁用 OrbitControls），整队拍完/取消后还原用户视角。
 * frameloop="demand" 下靠每帧 invalidate() 驱动渲染。
 * 分镜/演员 persist 到 localStorage。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  CINE_PRESETS, RENDER_STYLES, getCinePreset, makeShot, makeActor,
  actorDisplayName, actorFacing, actorAction, ACTOR_ACTIONS, shotCrossesAxis,
  type Shot, type Actor, type ActorAction, type RenderStyle, type SceneEnvelope,
} from "@/lib/cinematic";
import { SCENE_SETS } from "@/lib/sceneSets";
import { matchProjectTemplate } from "@/lib/matchProjectTemplate";
import { useDesignerStore } from "@/lib/store";
import { runRender } from "@/lib/useAiRender";
import { getAiRenderConfig, localizeWorkflowName, type RenderWorkflow } from "@/lib/aiRenderConfig";

/** 播放头（模块级可变对象，ActorsLayer 在 useFrame 里直读，避免每帧 setState） */
export const cinePlayhead = { t: 0, active: false };

interface QueueItem { shot: Shot; style: RenderStyle; }

/** 逐镜成片的单镜状态（phase 沿用 useAiRender 的 RenderPhase 语义） */
interface GenEntry { phase: string; msg?: string; outputs?: string[]; }

interface CineState {
  /** 分镜（持久化） */
  shots: Shot[];
  addShot: (presetId: string) => void;
  removeShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  updateShot: (id: string, patch: Partial<Pick<Shot, "duration" | "prompt" | "targetActorId">>) => void;

  /** 导出风格（至少保留一个） */
  styles: RenderStyle[];
  toggleStyle: (s: RenderStyle) => void;

  /** 演员（持久化） */
  actors: Actor[];
  addActorMode: boolean;
  pendingFrom: [number, number] | null;
  /** 重设走位中（点两下改该演员的起点→终点，名字/角色/动作保留） */
  replaceActorId: string | null;
  beginAddActor: () => void;
  beginReplaceActor: (id: string) => void;
  placePoint: (p: [number, number]) => void;
  cancelAddActor: () => void;
  removeActor: (id: string) => void;
  updateActor: (id: string, patch: Partial<Actor>) => void;

  /** 9:16 竖屏取景框（易失，画布上的安全框覆盖层） */
  show916: boolean;
  toggle916: () => void;

  /** 实景首帧留存（shotId → dataURL，易失）——「逐镜成片」的输入图 */
  takes: Record<string, string>;
  _setTake: (shotId: string, dataUrl: string) => void;

  /** 逐镜成片（走既有「AI 出图设置」的后端/工作流体系） */
  genWorkflowId: string;
  setGenWorkflowId: (id: string) => void;
  genRunning: boolean;
  genState: Record<string, GenEntry>;
  _setGenRunning: (v: boolean) => void;
  _setGen: (shotId: string, patch: GenEntry) => void;

  /** 录制队列：null = 空闲。快拍 = 单镜实景；分镜 = shots × styles。 */
  queue: QueueItem[] | null;
  queueIdx: number;
  batch: boolean;
  progress: number;
  menuOpen: boolean;
  startQuick: (presetId: string) => void;
  startStoryboard: () => void;
  cancel: () => void;
  setMenuOpen: (open: boolean) => void;
  _advance: () => void;
  _finish: () => void;
  _setProgress: (p: number) => void;
}

export const useCineStore = create<CineState>()(
  persist(
    (set, get) => ({
      shots: [],
      addShot: (presetId) => {
        const first = get().actors[0];
        set({ shots: [...get().shots, makeShot(presetId, first ? { targetActorId: first.id } : undefined)] });
      },
      removeShot: (id) => set({ shots: get().shots.filter((s) => s.id !== id) }),
      moveShot: (id, dir) => {
        const arr = [...get().shots];
        const i = arr.findIndex((s) => s.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        set({ shots: arr });
      },
      updateShot: (id, patch) =>
        set({ shots: get().shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),

      styles: ["beauty"],
      toggleStyle: (s) => {
        const cur = get().styles;
        const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
        if (next.length) set({ styles: next }); // 至少留一个
      },

      actors: [],
      addActorMode: false,
      pendingFrom: null,
      replaceActorId: null,
      beginAddActor: () => set({ addActorMode: true, pendingFrom: null, replaceActorId: null }),
      beginReplaceActor: (id) => set({ addActorMode: true, pendingFrom: null, replaceActorId: id }),
      placePoint: (p) => {
        const { addActorMode, pendingFrom, actors, replaceActorId } = get();
        if (!addActorMode) return;
        if (!pendingFrom) { set({ pendingFrom: p }); return; }
        if (replaceActorId) {
          // 重设走位：只改 from/to，名字/角色/动作/朝向保留
          set({
            actors: actors.map((a) => (a.id === replaceActorId ? { ...a, from: pendingFrom, to: p } : a)),
            pendingFrom: null, addActorMode: false, replaceActorId: null,
          });
          return;
        }
        // 新演员默认名：演员N（跳过已占用的号）
        let n = actors.length + 1;
        while (actors.some((a) => a.name === `演员${n}`)) n++;
        set({
          actors: [...actors, makeActor(pendingFrom, p, { name: `演员${n}` })],
          pendingFrom: null, addActorMode: false,
        });
      },
      cancelAddActor: () => set({ addActorMode: false, pendingFrom: null, replaceActorId: null }),
      removeActor: (id) => set({ actors: get().actors.filter((a) => a.id !== id) }),
      updateActor: (id, patch) =>
        set({ actors: get().actors.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),

      show916: false,
      toggle916: () => set({ show916: !get().show916 }),

      takes: {},
      _setTake: (shotId, dataUrl) => set({ takes: { ...get().takes, [shotId]: dataUrl } }),

      genWorkflowId: "",
      setGenWorkflowId: (id) => set({ genWorkflowId: id }),
      genRunning: false,
      genState: {},
      _setGenRunning: (v) => set({ genRunning: v }),
      _setGen: (shotId, patch) =>
        set({ genState: { ...get().genState, [shotId]: { ...get().genState[shotId], ...patch } } }),

      queue: null,
      queueIdx: 0,
      batch: false,
      progress: 0,
      menuOpen: false,
      startQuick: (presetId) =>
        set({ queue: [{ shot: makeShot(presetId), style: "beauty" }], queueIdx: 0, batch: false, progress: 0, menuOpen: false }),
      startStoryboard: () => {
        const { shots, styles } = get();
        if (!shots.length) return;
        // 镜头为主序、风格为次序：01-实景 → 01-白模 → 02-实景 → …
        const queue: QueueItem[] = [];
        for (const shot of shots) for (const style of styles) queue.push({ shot, style });
        set({ queue, queueIdx: 0, batch: true, progress: 0, menuOpen: false });
      },
      cancel: () => set({ queue: null, queueIdx: 0, progress: 0 }),
      setMenuOpen: (open) => set({ menuOpen: open }),
      _advance: () => set({ queueIdx: get().queueIdx + 1, progress: 0 }),
      _finish: () => set({ queue: null, queueIdx: 0, progress: 0 }),
      _setProgress: (p) => set({ progress: p }),
    }),
    // 只持久化创作数据；录制态/首帧/生成态易失
    { name: "zhuya-cine-shots-v1", partialize: (s) => ({ shots: s.shots, actors: s.actors, styles: s.styles, genWorkflowId: s.genWorkflowId }) },
  ),
);

/** 挑一个当前浏览器支持的视频封装（Safari 走 mp4，Chrome/Edge 走 webm） */
function pickMime(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return { mime: "", ext: "webm" };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 同步渲一帧并从帧缓冲读出 PNG（preserveDrawingBuffer:false 下
 *  toDataURL 读到陈旧缓冲，必须 readPixels——外观截图管线验证过的做法）。
 *  同时返回 dataURL：实景首帧要留在内存里给「逐镜成片」当输入图。 */
function captureFramePNG(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<{ blob: Blob | null; dataUrl: string }> {
  gl.render(scene, camera);
  const ctx = gl.getContext();
  const cv = gl.domElement;
  const w = cv.width, h = cv.height;
  const buf = new Uint8Array(w * h * 4);
  ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
  const c2 = document.createElement("canvas");
  c2.width = w; c2.height = h;
  const g2 = c2.getContext("2d")!;
  const img = g2.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - 1 - y) * w * 4 + w * 4), y * w * 4);
  }
  g2.putImageData(img, 0, 0);
  const dataUrl = c2.toDataURL("image/png");
  return new Promise((resolve) => c2.toBlob((blob) => resolve({ blob, dataUrl }), "image/png"));
}

/** 近白远黑的线性深度材质（MiDaS 习惯；VACE/ControlNet 深度输入） */
function makeDepthMaterial(env: SceneEnvelope): THREE.ShaderMaterial {
  const far = Math.max(30, Math.hypot(env.W, env.D) * 2.8);
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.5 }, uFar: { value: far } },
    vertexShader: `varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vZ;
      void main(){ float d = clamp(1.0 - (vZ - uNear) / (uFar - uNear), 0.0, 1.0); gl_FragColor = vec4(vec3(d), 1.0); }`,
  });
}

/** 隐藏 shader 类物件（天空/星空/水面粒子等）——白模/深度 pass 只保留实体几何。
 *  返回还原函数。 */
function hideNonSolid(scene: THREE.Scene): () => void {
  const touched: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const isShader = Array.isArray(mat)
      ? mat.some((x) => (x as THREE.ShaderMaterial).isShaderMaterial)
      : !!(mat as THREE.ShaderMaterial | undefined)?.isShaderMaterial;
    const points = (o as unknown as { isPoints?: boolean }).isPoints;
    const sprite = (o as unknown as { isSprite?: boolean }).isSprite;
    if (o.visible && (points || sprite || (m.isMesh && isShader))) {
      touched.push(o);
      o.visible = false;
    }
  });
  return () => touched.forEach((o) => (o.visible = true));
}

/** 应用导出风格（beauty 无操作）。返回还原函数。 */
function applyStyle(scene: THREE.Scene, style: RenderStyle, env: SceneEnvelope): () => void {
  if (style === "beauty") return () => {};
  const unhide = hideNonSolid(scene);
  const prevOverride = scene.overrideMaterial;
  const prevBg = scene.background;
  const mat = style === "clay"
    ? new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.9, metalness: 0 })
    : makeDepthMaterial(env);
  scene.overrideMaterial = mat;
  scene.background = new THREE.Color(style === "clay" ? 0xdfe3e8 : 0x000000);
  return () => {
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    unhide();
    mat.dispose();
  };
}

const STYLE_SUFFIX: Record<RenderStyle, string> = { beauty: "", clay: "_clay", depth: "_depth" };

// ─── 逐镜成片（M4-A）────────────────────────────────────────
// 复用「AI 出图设置」的后端/工作流体系（本地 ComfyUI / 自建 / RunningHub），
// 每镜：实景首帧为输入图 + 本镜提示词 → runRender（上传/提交/轮询/取产出）。
// 串行执行（别挤爆用户 GPU）；菜单关了也继续跑（状态在 store）。
const genCancelFlag = { current: false };

async function runStoryboardGen() {
  const st0 = useCineStore.getState();
  if (st0.genRunning) return;
  const cfg = getAiRenderConfig();
  const wf = cfg.workflows.find((w) => w.id === st0.genWorkflowId);
  if (!wf || !st0.shots.length) return;
  genCancelFlag.current = false;
  st0._setGenRunning(true);
  for (const shot of st0.shots) {
    if (genCancelFlag.current) break;
    const st = useCineStore.getState();
    const preset = getCinePreset(shot.presetId);
    const image = st.takes[shot.id];
    if (wf.needsImage && !image) {
      st._setGen(shot.id, { phase: "error", msg: "缺首帧——先「拍摄全部」（含实景风格）留住首帧" });
      continue;
    }
    // 提示词：用户写了用用户的；空则给一句带运镜语义的兜底
    const prompt = shot.prompt.trim()
      || `cinematic ${preset?.nameEn ?? "camera"} shot of a modern villa, photorealistic, high quality`;
    st._setGen(shot.id, { phase: "submitting", msg: undefined, outputs: undefined });
    const res = await runRender(
      { workflow: wf, prompt, image },
      {
        onPhase: (p) => useCineStore.getState()._setGen(shot.id, { phase: p }),
        cancelRef: genCancelFlag,
        timeoutMs: 20 * 60_000, // 视频工作流慢，放宽到 20 分钟
      },
    );
    if (res === null) { useCineStore.getState()._setGen(shot.id, { phase: "idle", msg: "已取消" }); break; }
    if ("error" in res) useCineStore.getState()._setGen(shot.id, { phase: "error", msg: res.error });
    else useCineStore.getState()._setGen(shot.id, { phase: "done", outputs: res.images });
  }
  useCineStore.getState()._setGenRunning(false);
}

const GEN_PHASE_ZH: Record<string, string> = {
  uploading: "上传首帧…", submitting: "提交任务…", rendering: "生成中…",
  done: "完成", error: "失败", idle: "—",
};

/** Canvas 内组件：镜头×风格队列驱动相机 + 录制 + 产物下载。 */
export function CameraPathPlayer({ env }: { env: SceneEnvelope }) {
  const queue = useCineStore((s) => s.queue);
  const queueIdx = useCineStore((s) => s.queueIdx);
  const { gl, scene, camera, controls, invalidate } = useThree();
  const envRef = useRef(env);
  envRef.current = env;
  // 整队共享：用户视角备份 + 批次时间戳（首项建立，末项/取消时使用）
  const savedRef = useRef<{
    pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; target: THREE.Vector3 | null;
  } | null>(null);
  const stampRef = useRef("");

  useEffect(() => {
    if (!queue) return;
    const item = queue[queueIdx];
    const preset = item ? getCinePreset(item.shot.presetId) : undefined;
    if (!item || !preset) { useCineStore.getState()._finish(); return; }
    const isFirst = queueIdx === 0;
    const isLast = queueIdx === queue.length - 1;
    const cam = camera as THREE.PerspectiveCamera;
    const ctl = controls as unknown as { enabled: boolean; target: THREE.Vector3; update: () => void } | null;

    // ── 首项：备份用户视角 + 建批次时间戳，整队期间禁用轨道控制 ──
    if (isFirst) {
      savedRef.current = {
        pos: cam.position.clone(),
        quat: cam.quaternion.clone(),
        fov: cam.fov,
        target: ctl ? ctl.target.clone() : null,
      };
      stampRef.current = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    }
    if (ctl) ctl.enabled = false;

    const restore = () => {
      const saved = savedRef.current;
      if (!saved) return;
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      if (cam.fov !== saved.fov) { cam.fov = saved.fov; cam.updateProjectionMatrix(); }
      if (ctl) {
        if (saved.target) ctl.target.copy(saved.target);
        ctl.enabled = true;
        ctl.update();
      }
      savedRef.current = null;
      invalidate();
    };

    const applySample = (t: number) => {
      // 室内机位要框人：本镜的 targetActorId → 演员（缺省第一个演员）；
      // 室外预设忽略第三个参数（向后兼容）。
      const st = useCineStore.getState();
      const actor = st.actors.find((a) => a.id === item.shot.targetActorId) ?? st.actors[0];
      const target = actor
        ? { from: actor.from, to: actor.to, facing: actorFacing(actor) }
        : undefined;
      const s = preset.sample(t, envRef.current, target);
      cam.position.set(...s.pos);
      cam.lookAt(...s.lookAt);
      if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      cinePlayhead.t = t;
      cinePlayhead.active = true;
    };

    // ── 风格覆盖（白模/深度）——本项全程生效，结束/取消还原 ──
    const restoreStyle = applyStyle(scene, item.style, envRef.current);

    // ── 本项录制 ──
    const { mime, ext } = pickMime();
    const stream = gl.domElement.captureStream(30);
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    let cancelled = false;
    let rafId = 0;
    // 队列是 shot-major 展开（每镜连续 stylesPerShot 项）→ 镜号 = idx / 每镜项数
    const stylesPerShot = queue.filter((q) => q.shot.id === queue[0].shot.id).length;
    const no = String(Math.floor(queueIdx / stylesPerShot) + 1).padStart(2, "0");
    const base = `zhuya_${stampRef.current}_${no}-${preset.id}${STYLE_SUFFIX[item.style]}`;
    const files = { video: `${base}.${ext}`, first: `${base}_first.png`, last: `${base}_last.png` };

    recorder.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (!cancelled && chunks.length) {
        downloadBlob(new Blob(chunks, { type: mime || "video/webm" }), files.video);
      }
    };

    /** 末项收尾：附 storyboard.json（分镜批拍才有）→ 还原视角 → 归位 */
    const finishAll = () => {
      const st = useCineStore.getState();
      if (st.batch) {
        const stylesUsed = st.styles;
        const meta = {
          tool: "zhuya-cinematic",
          version: 3,
          createdAt: new Date().toISOString(),
          scene: envRef.current,
          fps: 30,
          styles: stylesUsed,
          // 导演台 v3：演员带名字/角色/朝向/动作（旧存档缺失字段按默认值解析）
          actors: st.actors.map((a, i) => ({
            id: a.id,
            name: actorDisplayName(a, i),
            role: a.role ?? "",
            from: a.from,
            to: a.to,
            facing: actorFacing(a),
            action: actorAction(a),
          })),
          shots: st.shots.map((s, i) => {
            const p = getCinePreset(s.presetId)!;
            const n = String(i + 1).padStart(2, "0");
            const filesByStyle = Object.fromEntries(
              stylesUsed.map((sty) => {
                const b = `zhuya_${stampRef.current}_${n}-${p.id}${STYLE_SUFFIX[sty]}`;
                return [sty, { video: `${b}.${ext}`, first: `${b}_first.png`, last: `${b}_last.png` }];
              }),
            );
            const targetIdx = st.actors.findIndex((a) => a.id === s.targetActorId);
            const target = targetIdx >= 0 ? st.actors[targetIdx] : st.actors[0];
            return {
              index: i + 1,
              preset: p.id,
              name: p.nameZh,
              indoor: !!p.indoor,
              duration: s.duration,
              prompt: s.prompt,
              targetActorId: target?.id ?? null,
              targetActorName: target ? actorDisplayName(target, targetIdx >= 0 ? targetIdx : 0) : null,
              // 本镜在场的角色（MVP：场景里全部演员都在场，镜头框住 target）
              characters: st.actors.map((a, ai) => ({
                id: a.id,
                name: actorDisplayName(a, ai),
                role: a.role ?? "",
                action: actorAction(a),
              })),
              files: filesByStyle,
            };
          }),
        };
        downloadBlob(
          new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }),
          `zhuya_${stampRef.current}_storyboard.json`,
        );
      }
      cinePlayhead.active = false;
      restoreStyle();
      restore();
      st._finish();
    };

    // ── 播放循环 ──
    let lastPct = -1;
    const durMs = item.shot.duration * 1000;
    const t0 = performance.now();

    const run = async () => {
      applySample(0);
      const first = await captureFramePNG(gl, scene, camera);
      if (first.blob && !cancelled) downloadBlob(first.blob, files.first);
      // 实景首帧留在内存：给「逐镜成片」当输入图（needsImage 工作流）
      if (item.style === "beauty" && !cancelled) {
        useCineStore.getState()._setTake(item.shot.id, first.dataUrl);
      }
      if (cancelled) return;
      recorder.start();

      const tick = async (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - t0) / durMs);
        applySample(t);
        invalidate();
        const pct = Math.round(t * 100);
        if (pct !== lastPct) { lastPct = pct; useCineStore.getState()._setProgress(pct); }
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          const last = await captureFramePNG(gl, scene, camera);
          if (last.blob && !cancelled) downloadBlob(last.blob, files.last);
          if (recorder.state !== "inactive") recorder.stop();
          if (cancelled) return;
          if (isLast) finishAll();
          else { restoreStyle(); useCineStore.getState()._advance(); }
        }
      };
      rafId = requestAnimationFrame(tick);
    };
    void run();

    return () => {
      // 两种触发：① 用户取消（queue 已置 null → 还原风格+视角）
      //          ② 队列推进（queue 还在 → 本项已在 advance 前还原过风格）
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (recorder.state !== "inactive") recorder.stop();
      if (!useCineStore.getState().queue) {
        cinePlayhead.active = false;
        restoreStyle();
        restore();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, queueIdx]);

  return null;
}

/** 打斗单节 beat：逼近→收→再扑→收（t∈[0,1] 上的冲量系数曲线）。
 *  纯摆拍：位置在"朝对手冲出 70% → 收回 → 再扑 80% → 收"之间往复，
 *  无接触、无编舞时间轴——完整 beats/phrases/reset 系统不在 MVP 范围。 */
const FIGHT_BEAT: Array<[number, number]> = [[0, 0], [0.25, 0.7], [0.5, 0.2], [0.75, 0.8], [1, 0.1]];
function fightBeat(t: number): number {
  for (let i = 1; i < FIGHT_BEAT.length; i++) {
    if (t <= FIGHT_BEAT[i][0]) {
      const [t0, v0] = FIGHT_BEAT[i - 1];
      const [t1, v1] = FIGHT_BEAT[i];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return FIGHT_BEAT[FIGHT_BEAT.length - 1][1];
}

/** Canvas 内组件：演员放置（地面点两下：起点→终点）+ 渲染 + 录制时行走。
 *  拖拽调整：按住演员拖动，from/to 一起平移（期间禁用轨道控制，松手恢复）。
 *  轴线：前两位演员起点连线（180 度轴线，橙色虚线 + "轴线"标牌）。 */
export function ActorsLayer() {
  const actors = useCineStore((s) => s.actors);
  const addMode = useCineStore((s) => s.addActorMode);
  const pendingFrom = useCineStore((s) => s.pendingFrom);
  const groupRefs = useRef(new Map<string, THREE.Group>());
  const { invalidate, controls } = useThree();
  // 拖拽时禁用轨道控制：经 ref 间接改 enabled（直接改 useThree 返回值会
  // 触发 react-hooks/immutability lint；本文件旧代码已有同类报错，不再新增）。
  const controlsRef = useRef<typeof controls | null>(null);
  useEffect(() => { controlsRef.current = controls; }, [controls]);
  const setControlsEnabled = (v: boolean) => {
    const ctl = controlsRef.current as unknown as { enabled: boolean } | null;
    if (ctl) ctl.enabled = v;
  };
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string; start: [number, number];
    origFrom: [number, number]; origTo: [number, number];
  } | null>(null);

  // 轴线标牌（CanvasTexture 精灵，离线可用，不依赖在线字体）
  const axisLabelTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(20,22,32,0.88)";
    g.fillRect(8, 16, 240, 64);
    g.strokeStyle = "#f59e0b";
    g.lineWidth = 4;
    g.strokeRect(8, 16, 240, 64);
    g.fillStyle = "#fbbf24";
    g.font = "bold 40px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("轴 线", 128, 50);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => axisLabelTex.dispose(), [axisLabelTex]);

  const endDrag = () => {
    setControlsEnabled(true);
    dragRef.current = null;
    setDraggingId(null);
  };
  // 指针在画布外松开也要结束拖拽
  useEffect(() => {
    if (!draggingId) return;
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

  // Esc 取消放置
  useEffect(() => {
    if (!addMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useCineStore.getState().cancelAddActor(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMode]);

  // 行走/跑/打斗：播放头驱动（frameloop=demand 下由录制循环的 invalidate 带动）
  useFrame(() => {
    const ph = cinePlayhead;
    const list = useCineStore.getState().actors;
    const t = ph.active ? ph.t : 0;
    for (const a of list) {
      const g = groupRefs.current.get(a.id);
      if (!g) continue;
      const action = actorAction(a);
      if (action === "fight") {
        // 对手：最近的另一位打斗演员；没有则最近的其他演员；再没有则用 to 点
        const others = list.filter((o) => o.id !== a.id);
        const fighters = others.filter((o) => actorAction(o) === "fight");
        const pool = fighters.length ? fighters : others;
        let px = a.to[0], pz = a.to[1];
        if (pool.length) {
          let best = pool[0], bd = Infinity;
          for (const o of pool) {
            const ox = o.from[0] + (o.to[0] - o.from[0]) * t;
            const oz = o.from[1] + (o.to[1] - o.from[1]) * t;
            const d = (ox - a.from[0]) ** 2 + (oz - a.from[1]) ** 2;
            if (d < bd) { bd = d; best = o; }
          }
          px = best.from[0] + (best.to[0] - best.from[0]) * t;
          pz = best.from[1] + (best.to[1] - best.from[1]) * t;
        }
        if (!ph.active) {
          // 静止：站在起点，面向对手
          g.position.set(a.from[0], 0, a.from[1]);
          g.rotation.set(0, Math.atan2(px - a.from[0], pz - a.from[1]), 0);
          continue;
        }
        // 逼近→收→再扑→收：朝对手方向冲出再收回（摆拍，无接触）
        const beat = fightBeat(t);
        const k = 0.12 + 0.55 * beat;
        const x = a.from[0] + (px - a.from[0]) * k;
        const z = a.from[1] + (pz - a.from[1]) * k;
        const bob = Math.abs(Math.sin(t * Math.PI * 14)) * 0.06;
        g.position.set(x, bob, z);
        g.rotation.set(0.1 + 0.12 * beat, Math.atan2(px - x, pz - z), 0);
        continue;
      }
      const x = a.from[0] + (a.to[0] - a.from[0]) * t;
      const z = a.from[1] + (a.to[1] - a.from[1]) * t;
      if (action === "run") {
        // 跑：步频更快 + 身体前倾
        const bob = ph.active ? Math.abs(Math.sin(t * Math.PI * 16)) * 0.07 : 0;
        g.position.set(x, bob, z);
        g.rotation.set(ph.active ? 0.12 : 0, actorFacing(a), 0);
      } else {
        // 走：步频起伏；静止时落地
        const bob = ph.active ? Math.abs(Math.sin(t * Math.PI * 10)) * 0.05 : 0;
        g.position.set(x, bob, z);
        g.rotation.set(0, actorFacing(a), 0);
      }
    }
  });

  return (
    <>
      {/* 放置模式：铺一张接收点击的地面（微透明示意可点） */}
      {addMode && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            useCineStore.getState().placePoint([e.point.x, e.point.z]);
            invalidate();
          }}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial transparent opacity={0.06} color="#2dd4bf" depthWrite={false} />
        </mesh>
      )}
      {/* 拖拽中：铺一张接住指针移动的地面，演员 from/to 跟着平移 */}
      {draggingId && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            e.stopPropagation();
            const dx = e.point.x - d.start[0];
            const dz = e.point.z - d.start[1];
            useCineStore.getState().updateActor(d.id, {
              from: [d.origFrom[0] + dx, d.origFrom[1] + dz],
              to: [d.origTo[0] + dx, d.origTo[1] + dz],
            });
            invalidate();
          }}
          onPointerUp={() => endDrag()}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial transparent opacity={0.04} color="#2dd4bf" depthWrite={false} />
        </mesh>
      )}
      {/* 起点已定，等终点 */}
      {pendingFrom && (
        <mesh position={[pendingFrom[0], 0.06, pendingFrom[1]]}>
          <cylinderGeometry args={[0.28, 0.28, 0.1, 16]} />
          <meshBasicMaterial color="#2dd4bf" />
        </mesh>
      )}
      {/* 180 度轴线：前两位演员起点连线 + 标牌（分镜越轴警告的基准） */}
      {actors.length >= 2 && (
        <group>
          <Line
            points={[[actors[0].from[0], 0.06, actors[0].from[1]], [actors[1].from[0], 0.06, actors[1].from[1]]]}
            color="#f59e0b" dashed dashSize={0.3} gapSize={0.2} lineWidth={1.5}
          />
          <sprite
            position={[
              (actors[0].from[0] + actors[1].from[0]) / 2,
              0.55,
              (actors[0].from[1] + actors[1].from[1]) / 2,
            ]}
            scale={[1.4, 0.55, 1]}
          >
            <spriteMaterial map={axisLabelTex} transparent depthTest={false} />
          </sprite>
        </group>
      )}
      {actors.map((a) => (
        <group key={a.id}>
          {/* 走位路径（虚线）+ 终点环 */}
          <Line
            points={[[a.from[0], 0.05, a.from[1]], [a.to[0], 0.05, a.to[1]]]}
            color="#2dd4bf" dashed dashSize={0.35} gapSize={0.22} lineWidth={1.5}
          />
          <mesh position={[a.to[0], 0.04, a.to[1]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.2, 0.32, 20]} />
            <meshBasicMaterial color="#2dd4bf" side={THREE.DoubleSide} />
          </mesh>
          {/* 方块人：胶囊身 + 球头（白模/深度 pass 会被 override 一起处理——正是走位入 previz 的意义）。
              按住可拖动调整走位（from/to 一起平移）。 */}
          <group
            ref={(g) => { if (g) groupRefs.current.set(a.id, g); else groupRefs.current.delete(a.id); }}
            position={[a.from[0], 0, a.from[1]]}
            onPointerDown={(e) => {
              if (addMode) return;
              e.stopPropagation();
              setControlsEnabled(false);
              dragRef.current = {
                id: a.id,
                start: [e.point.x, e.point.z],
                origFrom: [...a.from],
                origTo: [...a.to],
              };
              setDraggingId(a.id);
            }}
          >
            <mesh position={[0, 0.75, 0]} castShadow>
              <capsuleGeometry args={[0.22, 0.8, 4, 12]} />
              <meshStandardMaterial color={actorAction(a) === "fight" ? "#e07856" : "#a8b0bc"} roughness={0.85} />
            </mesh>
            <mesh position={[0, 1.52, 0]} castShadow>
              <sphereGeometry args={[0.17, 16, 12]} />
              <meshStandardMaterial color="#c2c9d4" roughness={0.85} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

/** 9:16 竖屏取景框：fixed 覆盖层，居中 9:16 安全框 + 四角标记 + 标签。
 *  pointer-events-none，不拦截画布操作；不改 HouseCanvas，面板自带。 */
function Frame916Overlay() {
  const corner: CSSProperties = { position: "absolute", width: 28, height: 28, borderColor: "#2dd4bf", borderStyle: "solid" };
  return (
    <div
      className="pointer-events-none"
      style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="relative"
        style={{ aspectRatio: "9 / 16", height: "100%", maxWidth: "100%", border: "2px solid rgba(45,212,191,0.9)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
      >
        <div style={{ ...corner, top: -2, left: -2, borderWidth: "4px 0 0 4px" }} />
        <div style={{ ...corner, top: -2, right: -2, borderWidth: "4px 4px 0 0" }} />
        <div style={{ ...corner, bottom: -2, left: -2, borderWidth: "0 0 4px 4px" }} />
        <div style={{ ...corner, bottom: -2, right: -2, borderWidth: "0 4px 4px 0" }} />
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
          style={{ background: "rgba(20,22,32,0.85)", color: "#2dd4bf" }}
        >
          9:16 安全框
        </div>
      </div>
    </div>
  );
}

/** DOM 覆盖层：🎬 入口 + 快拍 + 分镜 + 风格 + 演员 + 录制进度。 */
export function CinematicPanel({ locale = "zh" }: { locale?: string }) {
  const {
    shots, addShot, removeShot, moveShot, updateShot,
    styles, toggleStyle,
    actors, addActorMode, pendingFrom, beginAddActor, beginReplaceActor, cancelAddActor, removeActor, updateActor,
    queue, queueIdx, progress, menuOpen,
    startQuick, startStoryboard, cancel, setMenuOpen,
    genWorkflowId, setGenWorkflowId, genRunning, genState,
    show916, toggle916,
  } = useCineStore();
  const en = locale === "en";
  // 片场选择（本地态：刚应用的片场打 ✓；描述匹配结果文案）
  const [appliedSetId, setAppliedSetId] = useState<string | null>(null);
  const [setQuery, setSetQuery] = useState("");
  const [setMatchMsg, setSetMatchMsg] = useState("");
  const applySet = (id: string) => {
    useDesignerStore.getState().applyProjectTemplate(id);
    setAppliedSetId(id);
    setSetMatchMsg("");
  };
  const matchSetQuery = () => {
    const hit = matchProjectTemplate(setQuery);
    if (hit) {
      applySet(hit.id);
      setSetMatchMsg(en ? `Matched: ${hit.nameEn}` : `已匹配：${hit.name}`);
    } else {
      setSetMatchMsg(en ? "No set matched — try: café / office / apartment living room" : "未匹配到片场，试试：咖啡馆 / 办公室 / 公寓客厅");
    }
  };

  // ── 演员放置提示（独立于菜单，放置时始终可见）──
  if (addActorMode) {
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(45,212,191,0.5)" }}
        >
          <span>🚶</span>
          <span>
            {pendingFrom
              ? (en ? "Click the ground: end point" : "在地面点击：终点")
              : (en ? "Click the ground: start point" : "在地面点击：起点")}
          </span>
          <button onClick={cancelAddActor} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10">
            {en ? "Cancel" : "取消"}
          </button>
        </div>
      </>
    );
  }

  // ── 录制中：进度 + 取消 ──
  if (queue) {
    const item = queue[queueIdx];
    const preset = item ? getCinePreset(item.shot.presetId) : undefined;
    const styleName = item ? RENDER_STYLES.find((s) => s.id === item.style) : undefined;
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>
            {queueIdx + 1}/{queue.length}：{en ? preset?.nameEn : preset?.nameZh}
            {item && item.style !== "beauty" && (
              <span className="text-white/50">（{en ? styleName?.nameEn : styleName?.nameZh}）</span>
            )}
          </span>
          <div className="w-32 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#2dd4bf", transition: "width 0.1s linear" }} />
          </div>
          <span className="tabular-nums w-8 text-right">{progress}%</span>
          <button onClick={cancel} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10" title={en ? "Cancel" : "取消"}>
            ✕
          </button>
        </div>
      </>
    );
  }

  // ── 空闲：🎬 按钮 + 面板（左下角——右下角被页面级 AI 入口占用）──
  return (
    <>
    {show916 && <Frame916Overlay />}
    {/* 移动端抬高一层:样板间底部是整条主按钮「在设计器中打开此方案」,贴 bottom-5 会重叠。 */}
    <div className="absolute bottom-20 sm:bottom-5 left-4 z-50 flex flex-col items-start gap-2">
      {menuOpen && (
        <div
          className="flex flex-col gap-1 p-2 rounded-xl shadow-xl text-xs text-white w-[256px] max-h-[62vh] overflow-y-auto"
          style={{ background: "rgba(20,22,32,0.92)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          {/* 一键搭片场：点选片场即加载；或输一句描述匹配最合适的片场 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40">{en ? "SET" : "片场"}</div>
          {SCENE_SETS.map((s) => (
            <button
              key={s.id}
              onClick={() => applySet(s.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 text-left"
              title={en ? s.descriptionEn : s.description}
            >
              <span>{s.emoji}</span>
              <span className="flex-1 truncate">{en ? s.nameEn : s.name}</span>
              <span className="text-white/40 tabular-nums">{s.areaSqm}㎡</span>
              {appliedSetId === s.id && <span className="text-teal-300">✓</span>}
            </button>
          ))}
          <div className="flex gap-1 px-1">
            <input
              type="text"
              value={setQuery}
              placeholder={en ? "Describe a set: e.g. apartment living room" : "描述片场，如：公寓客厅 / 咖啡馆"}
              onChange={(e) => setSetQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") matchSetQuery(); }}
              className="flex-1 min-w-0 bg-white/10 rounded-lg px-2 py-1.5 outline-none placeholder:text-white/25"
            />
            <button
              onClick={matchSetQuery}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Match" : "匹配"}
            </button>
          </div>
          {setMatchMsg && <div className="px-2 text-[10px] leading-relaxed text-teal-300/90">{setMatchMsg}</div>}

          {/* 9:16 竖屏取景框 */}
          <button
            onClick={toggle916}
            className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-white/10 text-left border-t border-white/10 mt-1 pt-2"
          >
            <span>📱 {en ? "9:16 frame" : "9:16 取景框"}</span>
            <span className={show916 ? "text-teal-300" : "text-white/40"}>{show916 ? (en ? "On" : "开") : (en ? "Off" : "关")}</span>
          </button>

          {/* 快拍：单镜实景立即录 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40">{en ? "QUICK SHOT" : "快拍"}</div>
          {CINE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => startQuick(p.id)}
              className="flex items-center justify-between gap-4 px-3 py-1.5 rounded-lg hover:bg-white/10 text-left"
            >
              <span>{en ? p.nameEn : p.nameZh}{p.indoor && <span className="ml-1 text-[10px] text-teal-300/80">{en ? "indoor" : "室内"}</span>}</span>
              <span className="text-white/40">{p.duration}s</span>
            </button>
          ))}

          {/* 分镜工作台 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "STORYBOARD" : "分镜"}
          </div>
          {shots.map((s, i) => {
            const p = getCinePreset(s.presetId);
            const crosses = i > 0 && shotCrossesAxis(s, shots[i - 1], actors);
            return (
              <div key={s.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate">{en ? p?.nameEn : p?.nameZh}</span>
                  {crosses && (
                    <span className="px-1 py-0.5 rounded text-[10px] whitespace-nowrap" style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }} title={en ? "Camera crosses the 180° axis vs the previous indoor shot" : "本镜机位与上一室内镜分处轴线两侧，可能越轴"}>
                      ⚠️ {en ? "Axis cross" : "可能越轴"}
                    </span>
                  )}
                  <input
                    type="number" min={2} max={15} value={s.duration}
                    onChange={(e) => updateShot(s.id, { duration: Math.max(2, Math.min(15, Number(e.target.value) || 2)) })}
                    className="w-10 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none"
                    title={en ? "Duration (s)" : "时长(秒)"}
                  />
                  <span className="text-white/40">s</span>
                  <button onClick={() => moveShot(s.id, -1)} disabled={i === 0}
                    className="px-1 rounded hover:bg-white/10 disabled:opacity-25">↑</button>
                  <button onClick={() => moveShot(s.id, 1)} disabled={i === shots.length - 1}
                    className="px-1 rounded hover:bg-white/10 disabled:opacity-25">↓</button>
                  <button onClick={() => removeShot(s.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                </div>
                {/* 本镜框住的角色（室内镜跟拍用；缺省第一个演员） */}
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 whitespace-nowrap">{en ? "Frames" : "框住"}</span>
                  <select
                    value={s.targetActorId ?? actors[0]?.id ?? ""}
                    onChange={(e) => updateShot(s.id, { targetActorId: e.target.value || undefined })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                    style={{ colorScheme: "dark" }}
                    disabled={!actors.length}
                  >
                    {!actors.length && <option value="">{en ? "No actors yet" : "还没有演员"}</option>}
                    {actors.map((a, ai) => (
                      <option key={a.id} value={a.id}>{actorDisplayName(a, ai)}{a.role ? `（${a.role}）` : ""}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text" value={s.prompt} placeholder={en ? "Prompt (optional)" : "本镜提示词（可选，随控制包导出）"}
                  onChange={(e) => updateShot(s.id, { prompt: e.target.value })}
                  className="w-full bg-white/10 rounded px-2 py-1 outline-none placeholder:text-white/25"
                />
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1">
            {CINE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => addShot(p.id)}
                className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-center"
                title={en ? `Add ${p.nameEn}` : `加一镜：${p.nameZh}`}
              >
                ＋{en ? p.nameEn : p.nameZh}
              </button>
            ))}
          </div>

          {/* 导出风格 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "EXPORT STYLES" : "导出风格"}
          </div>
          <div className="flex gap-1 px-1">
            {RENDER_STYLES.map((s) => {
              const on = styles.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleStyle(s.id)}
                  className="flex-1 px-1 py-1.5 rounded-lg text-center"
                  style={{ background: on ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.05)", border: on ? "1px solid rgba(45,212,191,0.6)" : "1px solid transparent" }}
                  title={s.id === "beauty"
                    ? (en ? "Final render — strongest reference video" : "成品渲染——最强参考视频")
                    : s.id === "clay"
                      ? (en ? "Gray blockout — Seedance previz spec" : "灰盒白模——Seedance previz 规格")
                      : (en ? "Depth pass — VACE/ControlNet input" : "深度序列——VACE/ControlNet 输入")}
                >
                  {en ? s.nameEn : s.nameZh}
                </button>
              );
            })}
          </div>

          {/* 演员走位：名字/角色/动作/朝向可编；按住 3D 里的人可拖动调整走位 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "ACTORS" : "演员走位"}
          </div>
          {actors.map((a, i) => {
            const facingDeg = Math.round(((actorFacing(a) * 180) / Math.PI) % 360 + 360) % 360;
            return (
              <div key={a.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span>🚶</span>
                  <input
                    type="text" value={actorDisplayName(a, i)}
                    onChange={(e) => updateActor(a.id, { name: e.target.value })}
                    className="w-16 bg-white/10 rounded px-1.5 py-0.5 outline-none"
                    title={en ? "Character name" : "角色名"}
                  />
                  <input
                    type="text" value={a.role ?? ""}
                    placeholder={en ? "Role (e.g. owner)" : "角色（如店主）"}
                    onChange={(e) => updateActor(a.id, { role: e.target.value })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1.5 py-0.5 outline-none placeholder:text-white/25"
                  />
                  <button onClick={() => removeActor(a.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={actorAction(a)}
                    onChange={(e) => updateActor(a.id, { action: e.target.value as ActorAction })}
                    className="bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Action" : "动作"}
                  >
                    {ACTOR_ACTIONS.map((ac) => (
                      <option key={ac.id} value={ac.id}>{en ? ac.nameEn : ac.nameZh}</option>
                    ))}
                  </select>
                  <span className="text-white/40 whitespace-nowrap">{en ? "Facing" : "朝向"}</span>
                  <input
                    type="range" min={0} max={359} value={facingDeg}
                    onChange={(e) => updateActor(a.id, { facing: (Number(e.target.value) * Math.PI) / 180 })}
                    className="flex-1 min-w-0 accent-teal-400"
                    title={en ? "Facing direction (degrees)" : "朝向（度）"}
                  />
                  <span className="text-white/50 tabular-nums w-9 text-right">{facingDeg}°</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-white/50 tabular-nums truncate">
                    ({a.from[0].toFixed(1)},{a.from[1].toFixed(1)})→({a.to[0].toFixed(1)},{a.to[1].toFixed(1)})
                  </span>
                  <button
                    onClick={() => { beginReplaceActor(a.id); setMenuOpen(false); }}
                    className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 whitespace-nowrap"
                    title={en ? "Click ground twice to reset this actor's path" : "地面点两下，重设该演员的起点→终点"}
                  >
                    {en ? "↻ Reset path" : "↻ 重设走位"}
                  </button>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => { beginAddActor(); setMenuOpen(false); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-left"
          >
            🚶 {en ? "+ Add actor (click ground: start → end)" : "＋加演员（地面点两下：起点→终点）"}
          </button>
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Drag an actor in 3D to shift their path. With 2+ actors, the orange dashed axis line appears; indoor shots on opposite sides of it get an axis-cross warning."
              : "按住 3D 里的演员可拖动平移走位。两人以上出现橙色轴线虚线；室内镜机位若与上一镜分处轴线两侧，会标「可能越轴」。"}
          </div>

          <button
            onClick={startStoryboard}
            disabled={!shots.length}
            className="mt-1 px-3 py-2 rounded-lg text-center font-semibold disabled:opacity-30"
            style={{ background: "#007AFF" }}
          >
            🎬 {en
              ? `Shoot all (${shots.length}×${styles.length})`
              : `拍摄全部（${shots.length} 镜 × ${styles.length} 风格）`}
          </button>

          {/* 逐镜成片（M4-A：走「AI 出图设置」的后端/工作流，本地 ComfyUI / RunningHub 通吃） */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "GENERATE (MY COMFYUI)" : "逐镜成片（我的 ComfyUI）"}
          </div>
          {(() => {
            const cfg = getAiRenderConfig();
            const wfs = cfg.workflows;
            if (!wfs.length) {
              return (
                <div className="px-2 py-1.5 text-white/45 leading-relaxed">
                  {en
                    ? "No workflows yet — add backends & workflows in AI Assistant → Render Settings (local ComfyUI supported), then pick one here."
                    : "还没有工作流——先到「AI 助手 → 出图设置」配置后端（支持本地 ComfyUI）并导入/添加工作流，再回这里选用。"}
                </div>
              );
            }
            return (
              <>
                <select
                  value={genWorkflowId}
                  onChange={(e) => setGenWorkflowId(e.target.value)}
                  className="mx-1 bg-white/10 rounded-lg px-2 py-1.5 outline-none"
                  style={{ colorScheme: "dark" }}
                >
                  <option value="">{en ? "Choose a workflow…" : "选择工作流…"}</option>
                  {wfs.map((w: RenderWorkflow) => (
                    <option key={w.id} value={w.id}>
                      {localizeWorkflowName(w, en ? "en" : "zh")}{w.needsImage ? "" : en ? " (no image)" : "（不吃图）"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => (genRunning ? (genCancelFlag.current = true) : void runStoryboardGen())}
                  disabled={!genRunning && (!shots.length || !genWorkflowId)}
                  className="px-3 py-2 rounded-lg text-center font-semibold disabled:opacity-30"
                  style={{ background: genRunning ? "rgba(239,68,68,0.8)" : "rgba(45,212,191,0.28)", border: "1px solid rgba(45,212,191,0.5)" }}
                >
                  {genRunning
                    ? (en ? "⏹ Stop" : "⏹ 停止")
                    : `🎞 ${en ? `Generate ${shots.length} shots` : `逐镜生成（${shots.length} 镜）`}`}
                </button>
                {shots.map((s, i) => {
                  const g = genState[s.id];
                  if (!g) return null;
                  const p = getCinePreset(s.presetId);
                  return (
                    <div key={s.id} className="px-2 py-1 rounded-lg bg-white/5 flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        <span className="flex-1 truncate">{en ? p?.nameEn : p?.nameZh}</span>
                        <span className={g.phase === "error" ? "text-red-400" : g.phase === "done" ? "text-teal-300" : "text-white/60"}>
                          {en ? g.phase : (GEN_PHASE_ZH[g.phase] ?? g.phase)}
                        </span>
                      </div>
                      {g.msg && <div className="text-[10px] text-red-300/80 leading-snug">{g.msg}</div>}
                      {!!g.outputs?.length && (
                        <div className="flex gap-2 flex-wrap">
                          {g.outputs.map((u, j) => (
                            <a key={j} href={u} target="_blank" rel="noreferrer" className="text-teal-300 underline">
                              {en ? "Output" : "产出"}{g.outputs!.length > 1 ? ` ${j + 1}` : ""} ↗
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-2 text-[10px] leading-relaxed text-white/40">
                  {en
                    ? "Uses your existing render backends (local ComfyUI / RunningHub). Shoot first (beauty style) to capture first frames; each shot = first frame + its prompt."
                    : "走「AI 出图设置」里的后端（本地 ComfyUI / RunningHub）。先「拍摄全部」（含实景）留住首帧；每镜 = 首帧 + 本镜提示词。"}
                </div>
              </>
            );
          })()}
          <div className="px-2 pt-1 pb-0.5 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Each shot × style exports video + first/last frames; storyboard.json bundles metadata — the control pack for AI video models"
              : "每镜×风格导出短片 + 首/尾帧；批拍附 storyboard.json——整套控制包可喂 AI 视频模型或 ComfyUI/VACE"}
          </div>
        </div>
      )}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
        style={{ background: menuOpen ? "#007AFF" : "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
        title={en ? "Cinematic shots" : "分镜出片"}
      >
        🎬 {en ? "Shots" : "出短片"}
      </button>
    </div>
    </>
  );
}
