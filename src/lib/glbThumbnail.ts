"use client";

/**
 * glbThumbnail — 给 GLB 离屏烤一张预览缩略图（PNG data URL）。
 *
 * 用于：① 导入模型后生成 <file>.preview.png；② 目录侧边栏每件家具的卡片缩略图
 * （catalogThumbnails 串行队列调用，几十张连烤）；③ 程序化家具缩略图
 * （proceduralThumbnail 复用 renderObjectThumbnail）。
 *
 * 性能：渲染器 / 环境贴图(IBL) / Draco 解码器都做成**模块级单例**，全程只建一次、
 * 跨调用复用——连烤几十张时不再每张重建 WebGL 上下文 + 重算 PMREM 环境（这是
 * 之前加 RoomEnvironment 后目录缩略图变慢的原因）。每次只加载/释放模型本身。
 * 单例只有一个 WebGL 上下文常驻，远低于浏览器上限，无需 forceContextLoss。
 *
 * 成片（Batch 3）：纯透明底 + 灰底卡片让模型看起来像一小团灰棕色斑块。
 * 现在统一走「工作室」成片：ACES 色调映射 + 三点光 + 投影角点自适应取景
 * （物体占满画幅约 82%）+ 2D 合成暖灰渐变底 + 落地接触阴影。
 */
import type * as ThreeNS from "three";

type Singletons = {
  THREE: typeof ThreeNS;
  renderer: ThreeNS.WebGLRenderer;
  envTex: ThreeNS.Texture;
  loader: { loadAsync: (url: string) => Promise<{ scene: ThreeNS.Object3D }> };
};

let _singletonsP: Promise<Singletons | null> | null = null;

async function getSingletons(): Promise<Singletons | null> {
  if (_singletonsP) return _singletonsP;
  _singletonsP = (async () => {
    try {
      const THREE = await import("three");
      const { GLTFLoader, DRACOLoader, RoomEnvironment } = await import("three-stdlib");

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // ACES 让高光不死白、暗部不死黑，模型颜色更接近室内渲染。
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      // Neutral studio IBL — built ONCE here, reused for every thumbnail.
      // Critical for metallic (stainless fridge, steel sink) and glass so they
      // reflect something instead of rendering near-black.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const RoomEnv = RoomEnvironment as unknown as { new (): object };
      const envTex = pmrem.fromScene(new RoomEnv() as never, 0.04).texture;
      pmrem.dispose();

      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath("/draco/");
      loader.setDRACOLoader(draco);
      // 目录模型现在是 KTX2(KHR_texture_basisu 标了 required),不挂 KTX2Loader 会直接
      // 加载失败 → 家具卡片缩略图全烤不出来。这条路径不走 @/lib/drei 包装,得单独挂。
      const { extendKtx2 } = await import("./gltfKtx2");
      extendKtx2(loader);

      return { THREE, renderer, envTex, loader: loader as unknown as Singletons["loader"] } as Singletons;
    } catch {
      return null;
    }
  })();
  return _singletonsP;
}

export function disposeObject(THREE: typeof ThreeNS, obj: ThreeNS.Object3D): void {
  obj.traverse((o) => {
    const m = o as ThreeNS.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as ThreeNS.MeshStandardMaterial;
      sm?.map?.dispose?.();
      sm?.normalMap?.dispose?.();
      sm?.roughnessMap?.dispose?.();
      sm?.metalnessMap?.dispose?.();
      sm?.dispose?.();
    }
  });
}

/**
 * 把一个 three.js 对象渲染成「工作室」风格缩略图：暖灰渐变底 + 落地接触阴影。
 * root 坐标约定：y=0 为地面（程序化家具 / GLB 均如此）。
 * 失败返回 null（调用方回退到 SVG 剪影）。
 */
export async function renderObjectThumbnail(root: ThreeNS.Object3D, size = 128): Promise<string | null> {
  const s = await getSingletons();
  if (!s) return null;
  const { THREE, renderer, envTex } = s;

  try {
    const scene = new THREE.Scene();
    scene.environment = envTex;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 5, 4);
    scene.add(key);
    // 补光：从对侧打亮暗面，避免背面死黑；顶光提亮水平面。
    const fill = new THREE.DirectionalLight(0xfff2e0, 0.55);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    const top = new THREE.DirectionalLight(0xffffff, 0.35);
    top.position.set(0, 6, 0);
    scene.add(top);
    scene.add(root);

    // ── 自适应取景：投影全部 8 个包围盒角点，调距离让物体占满画幅 82% ──
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const sizeV = box.getSize(new THREE.Vector3());
    const corners: ThreeNS.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          corners.push(new THREE.Vector3(x, y, z));
    const sphereR = Math.max(sizeV.x, sizeV.y, sizeV.z) * 0.87;
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const dir = new THREE.Vector3(1, 0.62, 1).normalize();
    // 初值：包围球刚好入画；再迭代收紧到 82% 占幅。
    let dist = (sphereR / Math.tan(THREE.MathUtils.degToRad(17.5))) * 1.15;
    const place = (d: number) => {
      cam.position.copy(center).addScaledVector(dir, d);
      cam.near = Math.max(d / 100, 0.01);
      cam.far = d * 20;
      cam.lookAt(center);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
    };
    place(dist);
    for (let i = 0; i < 3; i++) {
      let maxN = 0;
      for (const c of corners) {
        const v = c.clone().project(cam);
        maxN = Math.max(maxN, Math.abs(v.x), Math.abs(v.y));
      }
      if (maxN < 0.01) break;
      dist *= maxN / 0.82;
      place(dist);
    }

    renderer.setSize(size, size);
    renderer.render(scene, cam);

    // ── 2D 合成：暖灰渐变底 + 落地接触阴影（按包围盒底面投影定位）──
    const out = document.createElement("canvas");
    out.width = out.height = size;
    const ctx = out.getContext("2d")!;
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, "#faf8f3");
    bg.addColorStop(0.62, "#efece5");
    bg.addColorStop(1, "#e2ddd3");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // 接触阴影：包围盒底面中心 + 底面两角投影，决定椭圆位置与宽度。
    const bottomCenter = new THREE.Vector3(center.x, box.min.y, center.z).project(cam);
    const bottomL = new THREE.Vector3(box.min.x, box.min.y, center.z).project(cam);
    const bottomR = new THREE.Vector3(box.max.x, box.min.y, center.z).project(cam);
    const sx = (bottomCenter.x * 0.5 + 0.5) * size;
    const sy = (-bottomCenter.y * 0.5 + 0.5) * size;
    const halfW = Math.max(Math.abs(bottomR.x - bottomL.x) * 0.25 * size, size * 0.14);
    const sh = ctx.createRadialGradient(sx, sy, 0, sx, sy, halfW);
    sh.addColorStop(0, "rgba(60,50,35,0.28)");
    sh.addColorStop(0.6, "rgba(60,50,35,0.12)");
    sh.addColorStop(1, "rgba(60,50,35,0)");
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.22);
    ctx.translate(-sx, -sy);
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(sx, sy, halfW, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(renderer.domElement, 0, 0, size, size);
    return out.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function makeGlbThumbnail(url: string, size = 128, recolor?: string): Promise<string | null> {
  const s = await getSingletons();
  if (!s) return null;
  const { loader } = s;

  let root: ThreeNS.Object3D | null = null;
  try {
    const gltf = await loader.loadAsync(url);
    root = gltf.scene;

    // Mirror the 3D scene's recolor (see GltfFurniture) so the catalog
    // thumbnail matches what gets placed — e.g. the teal-exported fridge
    // shows as the silver it renders in-room.
    if (recolor) {
      root.traverse((obj) => {
        const m = obj as ThreeNS.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as ThreeNS.MeshStandardMaterial & { transmission?: number };
          if (!sm || !sm.color) continue;
          if ((sm.transmission ?? 0) > 0.1 || (sm.transparent && sm.opacity < 0.6)) continue;
          sm.color.set(recolor);
          sm.map = null;
          sm.needsUpdate = true;
        }
      });
    }

    return await renderObjectThumbnail(root, size);
  } catch {
    return null;
  } finally {
    // Free the per-model geometry/textures; keep the shared renderer/env alive.
    if (root) { try { disposeObject(s.THREE, root); } catch { /* noop */ } }
  }
}
