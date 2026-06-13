"use client";

/**
 * sceneRegistry — 当前活跃 R3F 3D 场景的全局登记处。
 *
 * 三个 3D 视图（室内装修 RoomCanvas / 全屋3D GlobalCanvas / 整体外观
 * HouseCanvas）各自在 <Canvas> 里挂一个 <SceneRegistrar>，mount 时把自己的
 * THREE.Scene 登记进来、unmount 时清除。同一时刻只有一个 3D 视图在渲染，
 * 所以 current 就是"用户正在看的那个场景"。导出功能读它，无需把 scene
 * 散播到 window 或 store（避免与 React 渲染耦合）。
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three";

export type SceneViewKey = "interior" | "global3d" | "exterior";

interface RegisteredScene {
  scene: THREE.Scene;
  view: SceneViewKey;
}

let current: RegisteredScene | null = null;

export function getCurrentScene(): RegisteredScene | null {
  return current;
}

/** 放进任意 <Canvas> 内即可登记该视图的场景。 */
export function SceneRegistrar({ view }: { view: SceneViewKey }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    current = { scene, view };
    return () => {
      if (current?.scene === scene) current = null;
    };
  }, [scene, view]);
  return null;
}
