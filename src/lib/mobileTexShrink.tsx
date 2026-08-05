"use client";
// 移动端贴图内存治理(每 ~0.4s 扫一遍新进场的贴图),两件事:
//  ① 把未压缩(非 KTX2)贴图缩到 256² —— 运行时贴图(地板/墙/壁画/玻璃)不是 GLB、
//     无法 KTX2,原尺寸时 318 张 ≈ 450MB,缩完 ~1/16。
//  ② **上传 GPU 后释放 CPU 侧副本** —— 实测这是最大单项:合计 842MB 里 CPU 残留贴图
//     占 546MB(256 张),把 JS 堆顶到 1.1GB。见 texCpuRelease.ts。
import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { shrinkSceneTexturesForMobile, isMobileDevice } from "@/lib/device";
import { releaseCpuAfterUpload, hasReleasedCpuTextures, resetReleasedFlag } from "@/lib/texCpuRelease";
import { clearLoadedGltfCache } from "@/lib/drei";

const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const;

// 【已回退】运行时「丢掉压缩纹理最大一级 mip」(1024²→512²,显存省 4 倍)。
// 显存收益确实很大(压缩纹理 500MB→167MB,家具从 363 张增至 549 张全部出齐),但它对
// **已经上传过**的纹理设 needsUpdate → 整批重新上传,旧的还没释放、新的已在传,瞬时
// 内存翻倍 → 真机「有概率崩溃」,画面也变暗(用户实拍)。
// 正确做法是把降分辨率放到**离线资产管线**(scripts/ktx2-encode.mjs 编码时就按 512 出图),
// 而不是在运行时给活着的纹理做手术。

export function MobileTextureShrink(): null {
  const scene = useThree((s) => s.scene);
  const acc = useRef(0);
  // 画布卸载时:若本画布释放过 CPU 贴图副本,必须清掉 GLTF 解析缓存。
  // 那些 THREE.Texture 已经没有 CPU 数据,换个视图 = 新 WebGL context = 需要重新上传,
  // 复用它们就是黑图(真机实拍:效果图里车、门全黑)。清掉后下个视图重新解析 GLB
  // (文件走 HTTP 缓存不重下),纹理完整,内存收益也照旧。
  useEffect(() => () => {
    if (!isMobileDevice()) return;
    if (!hasReleasedCpuTextures()) return;
    clearLoadedGltfCache();
    resetReleasedFlag();
  }, []);
  useFrame((_s, delta) => {
    if (!isMobileDevice()) return;
    acc.current += delta;
    if (acc.current < 0.4) return;
    acc.current = 0;
    // 先缩(要读 image 画到小 canvas),再挂释放钩子(上传后把 CPU 副本清掉)。
    shrinkSceneTexturesForMobile(scene, 256);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        for (const k of TEX_KEYS) {
          const t = (m as unknown as Record<string, THREE.Texture | null>)[k];
          if (t) releaseCpuAfterUpload(t);
        }
      }
    });
  });
  return null;
}
