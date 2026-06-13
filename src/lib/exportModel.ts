"use client";

/**
 * exportModel — 把当前 3D 场景导出成可下载的模型文件。
 *
 * 支持格式（用户可选）：
 *   - glb  : 二进制单文件，含网格+材质+贴图，最通用（推荐）
 *   - gltf : 文本 JSON，贴图内嵌为 data URI（单文件，体积稍大、可读）
 *   - obj  : 仅网格+基础材质（无 PBR/贴图），通用 CAD/建模交换
 *   - stl  : 仅网格（无材质/颜色），3D 打印
 *
 * onlyVisible: 隐藏的对象（如被关掉的墙/天花板）不导出。光源/相机辅助/
 * drei Html 标签等非网格对象由各 exporter 自行跳过。
 */
import type * as THREE from "three";

export type ExportFormat = "glb" | "gltf" | "obj" | "stl";

export const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string; labelEn: string; ext: string }> = [
  { value: "glb",  label: "GLB（推荐 · 含材质贴图 · 单文件）", labelEn: "GLB (recommended · materials · single file)", ext: "glb" },
  { value: "gltf", label: "glTF（文本 · 贴图内嵌）",            labelEn: "glTF (text · embedded textures)",          ext: "gltf" },
  { value: "obj",  label: "OBJ（网格+基础材质）",               labelEn: "OBJ (mesh + basic materials)",             ext: "obj" },
  { value: "stl",  label: "STL（仅网格 · 3D 打印）",            labelEn: "STL (mesh only · 3D printing)",            ext: "stl" },
];

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportScene(
  scene: THREE.Scene,
  format: ExportFormat,
  baseName: string,
): Promise<void> {
  const { GLTFExporter, OBJExporter, STLExporter } = await import("three-stdlib");
  const file = `${baseName}.${format}`;

  if (format === "glb" || format === "gltf") {
    const exporter = new GLTFExporter();
    const result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
      exporter.parse(
        scene,
        (out) => resolve(out as ArrayBuffer | object),
        (err) => reject(err),
        { binary: format === "glb", onlyVisible: true, embedImages: true },
      );
    });
    if (format === "glb") {
      triggerDownload(new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }), file);
    } else {
      triggerDownload(
        new Blob([JSON.stringify(result)], { type: "model/gltf+json" }),
        file,
      );
    }
    return;
  }

  if (format === "obj") {
    const text = new OBJExporter().parse(scene);
    triggerDownload(new Blob([text], { type: "text/plain" }), file);
    return;
  }

  // stl
  const text = new STLExporter().parse(scene, { binary: false });
  triggerDownload(new Blob([text as string], { type: "model/stl" }), file);
}
