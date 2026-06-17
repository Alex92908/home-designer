"use client";

/**
 * glbThumbnail — 给 GLB 离屏烤一张预览缩略图（PNG data URL）。
 *
 * 用于：① 导入模型后生成 <file>.preview.png；② 目录侧边栏每件家具的卡片缩略图
 * （catalogThumbnails 串行队列调用，几十张连烤）。
 *
 * 性能：渲染器 / 环境贴图(IBL) / Draco 解码器都做成**模块级单例**，全程只建一次、
 * 跨调用复用——连烤几十张时不再每张重建 WebGL 上下文 + 重算 PMREM 环境（这是
 * 之前加 RoomEnvironment 后目录缩略图变慢的原因）。每次只加载/释放模型本身。
 * 单例只有一个 WebGL 上下文常驻，远低于浏览器上限，无需 forceContextLoss。
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

      return { THREE, renderer, envTex, loader: loader as unknown as Singletons["loader"] } as Singletons;
    } catch {
      return null;
    }
  })();
  return _singletonsP;
}

function disposeObject(THREE: typeof ThreeNS, obj: ThreeNS.Object3D): void {
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

export async function makeGlbThumbnail(url: string, size = 128, recolor?: string): Promise<string | null> {
  const s = await getSingletons();
  if (!s) return null;
  const { THREE, renderer, envTex, loader } = s;

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

    const scene = new THREE.Scene();
    scene.environment = envTex;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    scene.add(root);

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const sizeV = box.getSize(new THREE.Vector3());
    const radius = Math.max(sizeV.x, sizeV.y, sizeV.z, 0.01);

    const cam = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 20);
    cam.position.set(center.x + radius * 1.3, center.y + radius * 0.95, center.z + radius * 1.3);
    cam.lookAt(center);

    renderer.setSize(size, size);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    // Free the per-model geometry/textures; keep the shared renderer/env alive.
    if (root) { try { disposeObject(THREE, root); } catch { /* noop */ } }
  }
}
