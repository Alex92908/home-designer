"use client";

/**
 * glbThumbnail — 给导入的 GLB 离屏烤一张预览缩略图（PNG data URL）。
 *
 * 导入完成后自动调用：加载模型 → 按包围盒取景（35° 视角、右前上方俯视）
 * → 128px 透明底渲染 → toDataURL。失败（解码错/WebGL 不可用）返回 null，
 * 绝不阻断导入流程；调用方把结果 PATCH 给 /api/import-model 落成
 * <file>.preview.png，库列表直接 <img> 显示。
 */
export async function makeGlbThumbnail(url: string, size = 128): Promise<string | null> {
  try {
    const THREE = await import("three");
    const { GLTFLoader, DRACOLoader } = await import("three-stdlib");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    loader.setDRACOLoader(draco);

    try {
      const gltf = await loader.loadAsync(url);
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
      renderer.dispose();
      draco.dispose();
    }
  } catch {
    return null;
  }
}
