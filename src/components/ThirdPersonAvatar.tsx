"use client";
/**
 * ThirdPersonAvatar — 第三人称人物漫游的化身（骨骼动画真人）。
 *
 * 用 three.js 官方 Soldier.glb（带骨骼 + Idle/Walk/Run 三段动画）。位置/朝向/速度由
 * WalkthroughController 每帧写进 `stateRef`（避免每帧 setState），本组件在自己的
 * useFrame 里直读并驱动：
 *   • 位置：脚底站在 (x, y=地面, z)
 *   • 朝向：面向移动方向（heading，弧度；模型默认朝 +Z，故直接用）
 *   • 动画：按水平速度在 Idle / Walk / Run 间淡入淡出混合（PUBG 式 locomotion 混合的
 *     单维简化版：idle → walk → run 按速度阈值切，0.2s 交叉淡化不突兀）
 *
 * 只此一处用 Soldier.glb，故直接在 useGLTF 的 scene 上跑 AnimationMixer（无需 clone）。
 * 想换更「真人」的形象：用 Ready Player Me 出同骨骼 GLB 换掉 SOLDIER 路径即可，本文件不动。
 */
import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

const SOLDIER = "/models/person/soldier/soldier.glb";
// 模型默认朝向修正：Soldier.glb 网格朝 -Z，而 heading=atan2(vx,vz) 以 +Z 为 0，
// 直接用会前后反 180°（用户实测："前后错了"）。整体 +π 扶正到面朝移动方向。
const MODEL_FACING = Math.PI;
// 脚底微调(米)：自身贴地射线把脚底落到地面后，若模型原点不完全在脚底可用此兜底
// 抬/降。Soldier.glb 原点≈脚底，默认 0；实测若仍陷/浮，改这一个数即可。
const MODEL_FOOT_LIFT = 0;

/** 由 WalkthroughController 每帧写、本组件每帧读的化身状态。 */
export interface AvatarState {
  x: number; y: number; z: number;  // 脚底世界坐标（米）
  heading: number;                  // 面向（弧度，绕 Y）
  speed: number;                    // 水平速度（m/s），驱动动画混合
  active: boolean;                  // 第三人称激活时才显示
}

export function ThirdPersonAvatar({ stateRef }: { stateRef: React.MutableRefObject<AvatarState> }) {
  const { scene, animations } = useGLTF(SOLDIER);
  const rootScene = useThree(s => s.scene);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);
  const curClip = useRef<"Idle" | "Walk" | "Run">("Idle");
  const headingRef = useRef(0);
  const groundRc = useMemo(() => new THREE.Raycaster(), []);
  const rcOrigin = useMemo(() => new THREE.Vector3(), []);
  const rcDown = useMemo(() => new THREE.Vector3(0, -1, 0), []);

  // 让模型自身投影 + 关掉视锥剔除（骨骼动画包围盒不随动，避免走出初始盒子被剔除消失）。
  // 脚底对齐改用运行时向下射线（见 useFrame）：骨骼模型 Box3 不准，改让化身自己贴地。
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
  }, [scene]);

  useEffect(() => {
    actions?.Idle?.reset().play();
  }, [actions]);

  useFrame((_, delta) => {
    const s = stateRef.current;
    const g = group.current;
    if (!g) return;
    g.visible = s.active;
    if (!s.active) return;
    // 自身贴地：从化身上方向下打射线，找脚下**真实地板网格**并把脚底落上去。
    // 跳过化身自身与「不可站立」家具。这样脚底不依赖 floorYRef 是否准、也不依赖骨骼
    // 模型盒算不算得准——命中什么真地面就站在什么上，不再陷进/浮起。找不到就回落 s.y。
    let footY = s.y;
    rcOrigin.set(s.x, s.y + 2.0, s.z);
    groundRc.set(rcOrigin, rcDown);
    for (const h of groundRc.intersectObjects(rootScene.children, true)) {
      let anc: THREE.Object3D | null = h.object, skip = false;
      while (anc) {
        if (anc === g) { skip = true; break; }                              // 自身网格
        if ((anc.userData as { notWalkable?: boolean })?.notWalkable) { skip = true; break; } // 家具
        anc = anc.parent;
      }
      if (skip) continue;
      if (h.point.y > s.y + 1.5) continue;   // 别吸到头顶天花板
      footY = h.point.y;
      break;
    }
    g.position.set(s.x, footY + MODEL_FOOT_LIFT, s.z);
    // 朝向平滑转（最短弧）——避免瞬间掉头
    let d = s.heading - headingRef.current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    headingRef.current += d * (1 - Math.exp(-12 * delta));
    g.rotation.y = headingRef.current + MODEL_FACING;
    // 速度 → 动画：Idle(<0.3) / Walk(<4.2) / Run(≥4.2)。0.2s 交叉淡化。
    const want: "Idle" | "Walk" | "Run" = s.speed < 0.3 ? "Idle" : s.speed < 4.2 ? "Walk" : "Run";
    if (want !== curClip.current && actions) {
      actions[curClip.current]?.fadeOut(0.2);
      actions[want]?.reset().fadeIn(0.2).play();
      curClip.current = want;
    }
  });

  return (
    <group ref={group} dispose={null} visible={false}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(SOLDIER);
