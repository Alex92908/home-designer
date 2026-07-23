"use client";
/**
 * ThirdPersonAvatar — 第三人称人物漫游的化身（骨骼动画角色）。
 *
 * 目录驱动：AVATARS 里每条 = 一个可选角色（url + 朝向修正 + 脚底微调 + 三段动画名）。
 * 加更多形象只是往 AVATARS 加一条（如 Ready Player Me 出的同骨骼 GLB）。
 *
 * 位置/朝向/速度由 WalkthroughController 每帧写进 `stateRef`（免每帧 setState），本组件
 * 在 useFrame 里直读并驱动：
 *   • 位置：脚底站在真实地板上（运行时向下射线自身贴地，跳过家具/自身——骨骼模型 Box3
 *     不准，故不用它）
 *   • 朝向：面向移动方向（+ 每个模型自己的 facing 修正）
 *   • 动画：按水平速度在 idle / walk / run 间 0.2s 交叉淡化混合
 */
import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

/** 一个可选化身的配置。clips 给出该 GLB 里 idle/walk/run 三段动画的**实际名字**。 */
export interface AvatarDef {
  id: string;
  name: string;          // UI 显示名
  url: string;
  facing: number;        // 朝向修正(弧度)：模型默认朝向 → 面朝移动方向(+Z 为 0)
  footLift: number;      // 脚底微调(米)：原点不在脚底时兜底抬/降
  clips: { idle: string; walk: string; run: string };
}

/** 化身目录。加更多角色 = 加一条（同骨骼即可，代码不动）。 */
export const AVATARS: AvatarDef[] = [
  { id: "soldier", name: "士兵", url: "/models/person/soldier/soldier.glb",
    facing: Math.PI, footLift: 0, clips: { idle: "Idle", walk: "Walk", run: "Run" } },
  { id: "xbot", name: "素体人", url: "/models/person/xbot/xbot.glb",
    facing: 0, footLift: 0, clips: { idle: "idle", walk: "walk", run: "run" } },
];
export const DEFAULT_AVATAR_ID = "soldier";

/** 由 WalkthroughController 每帧写、本组件每帧读的化身状态。 */
export interface AvatarState {
  x: number; y: number; z: number;  // 脚底世界坐标（米）
  heading: number;                  // 面向（弧度，绕 Y）
  speed: number;                    // 水平速度（m/s），驱动动画混合
  active: boolean;                  // 第三人称激活时才显示
}

export function ThirdPersonAvatar({ avatar, stateRef }: {
  avatar: AvatarDef;
  stateRef: React.MutableRefObject<AvatarState>;
}) {
  const { scene, animations } = useGLTF(avatar.url);
  const rootScene = useThree(s => s.scene);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);
  const curClip = useRef<string>(avatar.clips.idle);
  const headingRef = useRef(0);
  const groundRc = useMemo(() => new THREE.Raycaster(), []);
  const rcOrigin = useMemo(() => new THREE.Vector3(), []);
  const rcDown = useMemo(() => new THREE.Vector3(0, -1, 0), []);

  // 投影 + 关视锥剔除（骨骼动画包围盒不随动，避免走出初始盒子被剔除消失）。
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
  }, [scene]);

  // 起手播 idle（换角色时 actions 变，重置到该角色的 idle）。
  useEffect(() => {
    curClip.current = avatar.clips.idle;
    actions?.[avatar.clips.idle]?.reset().play();
  }, [actions, avatar]);

  useFrame((_, delta) => {
    const s = stateRef.current;
    const g = group.current;
    if (!g) return;
    g.visible = s.active;
    if (!s.active) return;
    // 自身贴地：从化身上方向下打射线，找脚下真实地板网格并把脚底落上去。跳过自身与
    // 「不可站立」家具。不依赖 floorYRef 准不准、也不依赖骨骼模型盒——命中什么真地面就站上去。
    let footY = s.y;
    rcOrigin.set(s.x, s.y + 2.0, s.z);
    groundRc.set(rcOrigin, rcDown);
    for (const h of groundRc.intersectObjects(rootScene.children, true)) {
      let anc: THREE.Object3D | null = h.object, skip = false;
      while (anc) {
        if (anc === g) { skip = true; break; }
        if ((anc.userData as { notWalkable?: boolean })?.notWalkable) { skip = true; break; }
        anc = anc.parent;
      }
      if (skip) continue;
      // 跨上高度限制：只接受「比玩家脚下高 ≤0.35m」的面（楼梯踏步/小台阶照常）；
      // 桌面/柜顶/吧台(高 0.7m+)跳过 → 继续找它**下方**的真地板 → 化身不再跨上桌子。
      // 下限 -1.2m 兼容站到下沉院子地面；再低(天花板反射/远处)不吸。
      if (h.point.y > s.y + 0.35 || h.point.y < s.y - 1.2) continue;
      footY = h.point.y;
      break;
    }
    g.position.set(s.x, footY + avatar.footLift, s.z);
    // 朝向平滑转（最短弧）
    let d = s.heading - headingRef.current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    headingRef.current += d * (1 - Math.exp(-12 * delta));
    g.rotation.y = headingRef.current + avatar.facing;
    // 速度 → 动画：idle(<0.3) / walk(<4.2) / run(≥4.2)，0.2s 交叉淡化。
    // 自愈：不只在 want 变化时切——只要目标动画没在播就补播(兜住初始 effect 没抓住
    // 时机 / 换角色 mixer 重建的情况，避免停在 T-pose 不动)。
    const want = s.speed < 0.3 ? avatar.clips.idle : s.speed < 4.2 ? avatar.clips.walk : avatar.clips.run;
    const wantAction = actions?.[want];
    if (wantAction && !wantAction.isRunning()) {
      if (curClip.current !== want) actions?.[curClip.current]?.fadeOut(0.2);
      wantAction.reset().fadeIn(0.2).play();
      curClip.current = want;
    }
  });

  return (
    <group ref={group} dispose={null} visible={false}>
      <primitive object={scene} />
    </group>
  );
}

AVATARS.forEach(a => useGLTF.preload(a.url));
