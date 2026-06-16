"use client";

/**
 * glbThumbnail — 给导入的 GLB 离屏烤一张预览缩略图（PNG data URL）。
 *
 * 导入完成后自动调用：加载模型 → 按包围盒取景（35° 视角、右前上方俯视）
 * → 128px 透明底渲染 → toDataURL。失败（解码错/WebGL 不可用）返回 null，
 * 绝不阻断导入流程；调用方把结果 PATCH 给 /api/import-model 落成
 * <file>.preview.png，库列表直接 <img> 显示。
 */
export async function makeGlbThumbnail(url: string, size = 128, recolor?: string): Promise<string | null> {
  try {
    const THREE = await import("three");
    const { GLTFLoader, DRACOLoader, RoomEnvironment } = await import("three-stdlib");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    // Image-based lighting from a neutral studio room. Critical for metallic
    // (stainless fridge, steel sink) and glass materials: without an
    // environment map they reflect nothing and render near-black, which
    // misrepresents how they look in the app (which has its own <Environment>).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const RoomEnv = RoomEnvironment as unknown as { new (): object };
    const envTex = pmrem.fromScene(new RoomEnv() as never, 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    loader.setDRACOLoader(draco);

    try {
      const gltf = await loader.loadAsync(url);
      // Mirror the 3D scene's recolor (see GltfFurniture) so the catalog
      // thumbnail matches what gets placed — e.g. the teal-exported fridge
      // shows as the silver it renders in-room.
      if (recolor) {
        gltf.scene.traverse((obj) => {
          const m = obj as { isMesh?: boolean; material?: unknown };
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const sm = mat as { color?: { set: (c: string) => void }; map?: unknown; transmission?: number; transparent?: boolean; opacity?: number; needsUpdate?: boolean };
            if (!sm || !sm.color) continue;
            if ((sm.transmission ?? 0) > 0.1 || (sm.transparent && (sm.opacity ?? 1) < 0.6)) continue;
            sm.color.set(recolor);
            sm.map = null;
            sm.needsUpdate = true;
          }
        });
      }
      scene.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      const sizeV = box.getSize(new THREE.Vector3());
      const radius = Math.max(sizeV.x, sizeV.y, sizeV.z, 0.01);

      const cam = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 20);
      cam.position.set(center.x + radius * 1.3, center.y + radius * 0.95, center.z + radius * 1.3);
      cam.lookAt(center);

      renderer.render(scene, cam);
      return renderer.domElement.toDataURL("image/png");
    } finally {
      // forceContextLoss frees the GPU context immediately — critical when
      // baking dozens of catalog thumbnails back-to-back, else Chrome hits
      // "Too many active WebGL contexts" and drops the oldest.
      try { renderer.forceContextLoss(); } catch { /* noop */ }
      pmrem.dispose();
      envTex.dispose();
      renderer.dispose();
      draco.dispose();
    }
  } catch {
    return null;
  }
}
