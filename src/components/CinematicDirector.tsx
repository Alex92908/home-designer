"use client";

/**
 * CinematicDirector —— 分镜工作台 + 多风格录制 + 演员走位（云横店 M1-M3）。
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
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  CINE_PRESETS, RENDER_STYLES, getCinePreset, makeShot, makeActor,
  type Shot, type Actor, type RenderStyle, type SceneEnvelope,
} from "@/lib/cinematic";

/** 播放头（模块级可变对象，ActorsLayer 在 useFrame 里直读，避免每帧 setState） */
export const cinePlayhead = { t: 0, active: false };

interface QueueItem { shot: Shot; style: RenderStyle; }

interface CineState {
  /** 分镜（持久化） */
  shots: Shot[];
  addShot: (presetId: string) => void;
  removeShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  updateShot: (id: string, patch: Partial<Pick<Shot, "duration" | "prompt">>) => void;

  /** 导出风格（至少保留一个） */
  styles: RenderStyle[];
  toggleStyle: (s: RenderStyle) => void;

  /** 演员（持久化） */
  actors: Actor[];
  addActorMode: boolean;
  pendingFrom: [number, number] | null;
  beginAddActor: () => void;
  placePoint: (p: [number, number]) => void;
  cancelAddActor: () => void;
  removeActor: (id: string) => void;

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
      addShot: (presetId) => set({ shots: [...get().shots, makeShot(presetId)] }),
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
      beginAddActor: () => set({ addActorMode: true, pendingFrom: null }),
      placePoint: (p) => {
        const { addActorMode, pendingFrom, actors } = get();
        if (!addActorMode) return;
        if (!pendingFrom) set({ pendingFrom: p });
        else set({ actors: [...actors, makeActor(pendingFrom, p)], pendingFrom: null, addActorMode: false });
      },
      cancelAddActor: () => set({ addActorMode: false, pendingFrom: null }),
      removeActor: (id) => set({ actors: get().actors.filter((a) => a.id !== id) }),

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
    // 只持久化创作数据；录制态易失
    { name: "zhuya-cine-shots-v1", partialize: (s) => ({ shots: s.shots, actors: s.actors, styles: s.styles }) },
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
 *  toDataURL 读到陈旧缓冲，必须 readPixels——外观截图管线验证过的做法） */
function captureFramePNG(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<Blob | null> {
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
  return new Promise((resolve) => c2.toBlob(resolve, "image/png"));
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
      const s = preset.sample(t, envRef.current);
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
          version: 2,
          createdAt: new Date().toISOString(),
          scene: envRef.current,
          fps: 30,
          styles: stylesUsed,
          actors: st.actors.map((a) => ({ from: a.from, to: a.to })),
          shots: st.shots.map((s, i) => {
            const p = getCinePreset(s.presetId)!;
            const n = String(i + 1).padStart(2, "0");
            const filesByStyle = Object.fromEntries(
              stylesUsed.map((sty) => {
                const b = `zhuya_${stampRef.current}_${n}-${p.id}${STYLE_SUFFIX[sty]}`;
                return [sty, { video: `${b}.${ext}`, first: `${b}_first.png`, last: `${b}_last.png` }];
              }),
            );
            return { index: i + 1, preset: p.id, name: p.nameZh, duration: s.duration, prompt: s.prompt, files: filesByStyle };
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
      if (first && !cancelled) downloadBlob(first, files.first);
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
          if (last && !cancelled) downloadBlob(last, files.last);
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

/** Canvas 内组件：演员放置（地面点两下：起点→终点）+ 渲染 + 录制时行走。 */
export function ActorsLayer() {
  const actors = useCineStore((s) => s.actors);
  const addMode = useCineStore((s) => s.addActorMode);
  const pendingFrom = useCineStore((s) => s.pendingFrom);
  const groupRefs = useRef(new Map<string, THREE.Group>());
  const { invalidate } = useThree();

  // Esc 取消放置
  useEffect(() => {
    if (!addMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useCineStore.getState().cancelAddActor(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMode]);

  // 行走：播放头驱动（frameloop=demand 下由录制循环的 invalidate 带动）
  useFrame(() => {
    const ph = cinePlayhead;
    for (const a of useCineStore.getState().actors) {
      const g = groupRefs.current.get(a.id);
      if (!g) continue;
      const t = ph.active ? ph.t : 0;
      const x = a.from[0] + (a.to[0] - a.from[0]) * t;
      const z = a.from[1] + (a.to[1] - a.from[1]) * t;
      // 步频起伏（走路感）；静止时落地
      const bob = ph.active ? Math.abs(Math.sin(t * Math.PI * 10)) * 0.05 : 0;
      g.position.set(x, bob, z);
      const dx = a.to[0] - a.from[0], dz = a.to[1] - a.from[1];
      if (dx !== 0 || dz !== 0) g.rotation.y = Math.atan2(dx, dz);
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
      {/* 起点已定，等终点 */}
      {pendingFrom && (
        <mesh position={[pendingFrom[0], 0.06, pendingFrom[1]]}>
          <cylinderGeometry args={[0.28, 0.28, 0.1, 16]} />
          <meshBasicMaterial color="#2dd4bf" />
        </mesh>
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
          {/* 方块人：胶囊身 + 球头（白模/深度 pass 会被 override 一起处理——正是走位入 previz 的意义） */}
          <group
            ref={(g) => { if (g) groupRefs.current.set(a.id, g); else groupRefs.current.delete(a.id); }}
            position={[a.from[0], 0, a.from[1]]}
          >
            <mesh position={[0, 0.75, 0]} castShadow>
              <capsuleGeometry args={[0.22, 0.8, 4, 12]} />
              <meshStandardMaterial color="#a8b0bc" roughness={0.85} />
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

/** DOM 覆盖层：🎬 入口 + 快拍 + 分镜 + 风格 + 演员 + 录制进度。 */
export function CinematicPanel({ locale = "zh" }: { locale?: string }) {
  const {
    shots, addShot, removeShot, moveShot, updateShot,
    styles, toggleStyle,
    actors, addActorMode, pendingFrom, beginAddActor, cancelAddActor, removeActor,
    queue, queueIdx, progress, menuOpen,
    startQuick, startStoryboard, cancel, setMenuOpen,
  } = useCineStore();
  const en = locale === "en";

  // ── 演员放置提示（独立于菜单，放置时始终可见）──
  if (addActorMode) {
    return (
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
    );
  }

  // ── 录制中：进度 + 取消 ──
  if (queue) {
    const item = queue[queueIdx];
    const preset = item ? getCinePreset(item.shot.presetId) : undefined;
    const styleName = item ? RENDER_STYLES.find((s) => s.id === item.style) : undefined;
    return (
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
    );
  }

  // ── 空闲：🎬 按钮 + 面板（左下角——右下角被页面级 AI 入口占用）──
  return (
    <div className="absolute bottom-5 left-4 z-50 flex flex-col items-start gap-2">
      {menuOpen && (
        <div
          className="flex flex-col gap-1 p-2 rounded-xl shadow-xl text-xs text-white w-[256px] max-h-[62vh] overflow-y-auto"
          style={{ background: "rgba(20,22,32,0.92)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          {/* 快拍：单镜实景立即录 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40">{en ? "QUICK SHOT" : "快拍"}</div>
          {CINE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => startQuick(p.id)}
              className="flex items-center justify-between gap-4 px-3 py-1.5 rounded-lg hover:bg-white/10 text-left"
            >
              <span>{en ? p.nameEn : p.nameZh}</span>
              <span className="text-white/40">{p.duration}s</span>
            </button>
          ))}

          {/* 分镜工作台 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "STORYBOARD" : "分镜"}
          </div>
          {shots.map((s, i) => {
            const p = getCinePreset(s.presetId);
            return (
              <div key={s.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate">{en ? p?.nameEn : p?.nameZh}</span>
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
                <input
                  type="text" value={s.prompt} placeholder={en ? "Prompt (optional)" : "本镜提示词（可选，随控制包导出）"}
                  onChange={(e) => updateShot(s.id, { prompt: e.target.value })}
                  className="w-full bg-white/10 rounded px-2 py-1 outline-none placeholder:text-white/25"
                />
              </div>
            );
          })}
          <div className="flex gap-1">
            {CINE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => addShot(p.id)}
                className="flex-1 px-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-center"
                title={en ? `Add ${p.nameEn}` : `加一镜：${p.nameZh}`}
              >
                ＋{(en ? p.nameEn : p.nameZh).slice(0, en ? 5 : 2)}
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

          {/* 演员走位 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "ACTORS" : "演员走位"}
          </div>
          {actors.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5">
              <span>🚶</span>
              <span className="flex-1 text-white/70 tabular-nums truncate">
                {en ? "Actor" : "演员"}{i + 1}：({a.from[0].toFixed(1)},{a.from[1].toFixed(1)})→({a.to[0].toFixed(1)},{a.to[1].toFixed(1)})
              </span>
              <button onClick={() => removeActor(a.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
            </div>
          ))}
          <button
            onClick={() => { beginAddActor(); setMenuOpen(false); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-left"
          >
            🚶 {en ? "+ Add actor (click ground: start → end)" : "＋加演员（地面点两下：起点→终点）"}
          </button>

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
  );
}
