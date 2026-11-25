// Film mocap demo (SPIKE, additive only — does not touch CinematicDirector
// or the poseFor action system).
//
// One VRM 1.0 humanoid (pixiv's official three-vrm sample model) driven by
// a CMU Motion Capture Database BVH clip through BVH→VRM retargeting
// (src/lib/mocap/bvhToVrm.ts), standing between two of the existing
// procedural film mannequins for visual comparison. The clip loops in place;
// the buttons switch between the six vendored CMU clips.
"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { BVHLoader } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { BvhToVrmRetargeter } from "@/lib/mocap/bvhToVrm";

const VRM_URL = "/models/mocap/VRM1_Constraint_Twist_Sample.vrm";

export const CLIPS = [
  { id: "walk", label: "走路 walk", file: "/models/mocap/cmu/cmu_walk.bvh", cmu: "02_01" },
  { id: "run", label: "跑步 run", file: "/models/mocap/cmu/cmu_run.bvh", cmu: "09_01" },
  { id: "idle", label: "待机 idle", file: "/models/mocap/cmu/cmu_idle.bvh", cmu: "140_06" },
  { id: "sit", label: "坐下 sit", file: "/models/mocap/cmu/cmu_sit.bvh", cmu: "13_01" },
  { id: "wave", label: "挥手 wave", file: "/models/mocap/cmu/cmu_wave.bvh", cmu: "111_37" },
  { id: "punch", label: "出拳 punch", file: "/models/mocap/cmu/cmu_punch.bvh", cmu: "02_05" },
] as const;

type ClipId = (typeof CLIPS)[number]["id"];

interface LoadedClip {
  skeleton: THREE.Skeleton;
  clip: THREE.AnimationClip;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  retargeter: BvhToVrmRetargeter;
  bones: number;
  duration: number;
}

interface Store {
  vrm: VRM | null;
  clips: Partial<Record<ClipId, LoadedClip>>;
  error: string | null;
}

function loadVrm(): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return new Promise((resolve, reject) => {
    loader.load(
      VRM_URL,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) return reject(new Error("GLTF loaded but no VRM found in userData"));
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        vrm.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        resolve(vrm);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

async function loadClip(
  vrm: VRM,
  vrmHeightM: number,
  def: (typeof CLIPS)[number],
): Promise<LoadedClip> {
  const text = await (await fetch(def.file)).text();
  const { skeleton, clip } = new BVHLoader().parse(text);
  // BVH tracks are named `.bones[Hips].quaternion`; PropertyBinding only
  // resolves those when the mixer root carries a `.skeleton` property.
  const mixer = new THREE.AnimationMixer({ skeleton } as unknown as THREE.Object3D);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  // The action MUST be playing before setTime/update, otherwise the mixer
  // applies nothing and the retargeter would read identity quaternions.
  action.play();
  mixer.setTime(0);
  mixer.update(0);
  // Measure the BVH skeleton height at frame 0 (T-pose) and scale BVH
  // units → metres so root motion matches the VRM model's size.
  skeleton.bones[0].updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of skeleton.bones) {
    b.getWorldPosition(v);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const bvhHeight = maxY - minY;
  const retargeter = new BvhToVrmRetargeter(vrm, skeleton, vrmHeightM / bvhHeight, bvhHeight);
  return { skeleton, clip, mixer, action, retargeter, bones: skeleton.bones.length, duration: clip.duration };
}

/** The existing film mannequin, rebuilt standalone for visual comparison
 * (same measurements as ActorsLayer in CinematicDirector.tsx — read-only
 * reference): capsule torso + sphere head + two capsule arms, no legs,
 * no skeleton. Torso centre y=0.75, head y=1.52, arm pivots y=1.28. */
function Mannequin({ position, armRaise = 0 }: { position: [number, number, number]; armRaise?: number }) {
  const mat = "#e8e6e1";
  return (
    <group position={position}>
      {/* torso capsule: radius 0.22, length 0.8, centre 0.75 m */}
      <mesh position={[0, 0.75, 0]}>
        <capsuleGeometry args={[0.22, 0.8, 4, 12]} />
        <meshStandardMaterial color={mat} roughness={0.85} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.52, 0]}>
        <sphereGeometry args={[0.17, 16, 12]} />
        <meshStandardMaterial color={mat} roughness={0.85} />
      </mesh>
      {/* arms pivot at the shoulders, capsules hang 0.42 below the pivot */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * 0.28, 1.28, 0]} rotation={[0, 0, side * -armRaise]}>
          <mesh position={[0, -0.42, 0]}>
            <capsuleGeometry args={[0.08, 0.7, 4, 8]} />
            <meshStandardMaterial color={mat} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function MocapActor({
  store,
  activeId,
  timeRef,
}: {
  store: React.MutableRefObject<Store>;
  activeId: ClipId;
  timeRef: React.MutableRefObject<number>;
}) {
  const activeRef = useRef(activeId);
  useFrame((_, delta) => {
    const s = store.current;
    if (!s.vrm) return;
    const loaded = s.clips[activeRef.current];
    if (loaded) {
      loaded.mixer.update(Math.min(delta, 0.05));
      loaded.retargeter.apply();
      timeRef.current = loaded.action.time;
    }
    s.vrm.update(Math.min(delta, 0.05));
  });

  // Switch clip actions when the selection changes.
  useEffect(() => {
    const prev = store.current.clips[activeRef.current];
    if (prev) prev.action.stop();
    activeRef.current = activeId;
    const next = store.current.clips[activeId];
    if (next) {
      next.action.reset().play();
    }
  }, [activeId, store]);

  const vrm = store.current.vrm;
  if (!vrm) return null;
  return <primitive object={vrm.scene} position={[0, 0, 0]} />;
}

export default function FilmMocapDemoPage() {
  const store = useRef<Store>({ vrm: null, clips: {}, error: null });
  const timeRef = useRef(0);
  const [activeId, setActiveId] = useState<ClipId>("walk");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("loading VRM + BVH clips…");
  const [clipInfo, setClipInfo] = useState<Record<string, { bones: number; duration: number }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vrm = await loadVrm();
        if (cancelled) return;
        store.current.vrm = vrm;
        const vrmBox = new THREE.Box3().setFromObject(vrm.scene);
        const vrmHeightM = vrmBox.max.y - vrmBox.min.y;
        setStatus(`VRM loaded (height ${vrmHeightM.toFixed(2)} m) — loading BVH clips…`);
        const info: Record<string, { bones: number; duration: number }> = {};
        for (const def of CLIPS) {
          const loaded = await loadClip(vrm, vrmHeightM, def);
          if (cancelled) return;
          store.current.clips[def.id] = loaded;
          info[def.id] = { bones: loaded.bones, duration: loaded.duration };
          setClipInfo({ ...info });
        }
        const first = store.current.clips.walk;
        if (first) {
          first.action.play();
          setStatus(
            `playing walk · ${first.bones} bones · ${first.duration.toFixed(2)}s · ` +
              `mapped ${first.retargeter.stats.mappedBones} · ` +
              `bvh height ${first.retargeter.stats.bvhHeightUnits.toFixed(1)}u → ${vrmHeightM.toFixed(2)}m (scale ${first.retargeter.stats.positionScale.toFixed(4)})`,
          );
        }
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        store.current.error = msg;
        setError(msg);
        setStatus(`ERROR: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live clip-time readout for the frame check (Playwright reads it).
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock(timeRef.current), 250);
    return () => clearInterval(t);
  }, []);

  // Keep the status line honest when the clip is switched.
  useEffect(() => {
    if (!ready) return;
    const loaded = store.current.clips[activeId];
    if (!loaded) return;
    setStatus(
      `playing ${activeId} · ${loaded.bones} bones · ${loaded.duration.toFixed(2)}s · ` +
        `mapped ${loaded.retargeter.stats.mappedBones} · ` +
        `bvh height ${loaded.retargeter.stats.bvhHeightUnits.toFixed(1)}u (scale ${loaded.retargeter.stats.positionScale.toFixed(4)})`,
    );
  }, [activeId, ready]);

  const activeInfo = clipInfo[activeId];

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#111827", color: "#f9fafb" }}>
      <Canvas
        shadows
        dpr={1}
        camera={{ position: [0, 1.6, 6.0], fov: 40 }}
        gl={{ antialias: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow />
        <directionalLight position={[-3, 4, -2]} intensity={0.5} />
        {/* floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[12, 12]} />
          <meshStandardMaterial color="#374151" roughness={0.9} />
        </mesh>
        <gridHelper args={[12, 24, "#6b7280", "#4b5563"]} position={[0, 0.01, 0]} />
        {ready && <MocapActor store={store} activeId={activeId} timeRef={timeRef} />}
        {/* existing-style mannequins for comparison */}
        <Mannequin position={[-1.5, 0, 0]} />
        <Mannequin position={[1.5, 0, 0]} armRaise={0.9} />
        <OrbitControls target={[0, 1, 0]} />
      </Canvas>

      <div
        style={{
          position: "absolute", top: 12, left: 12, right: 12,
          display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          动捕 Demo · CMU BVH → VRM humanoid
        </div>
        <div style={{ fontSize: 13, color: "#d1d5db" }}>
          中间：VRM 人形（BVH 驱动）· 两侧：现有程序化白模方块人（无骨骼，仅作对比）
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", pointerEvents: "auto" }}>
          {CLIPS.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid #6b7280",
                background: activeId === c.id ? "#2563eb" : "#1f2937",
                color: "#fff", cursor: "pointer", fontSize: 13,
              }}
            >
              {c.label} · CMU {c.cmu}
            </button>
          ))}
        </div>
        <div
          id="mocap-status"
          data-ready={ready ? "yes" : "no"}
          data-bones={activeInfo ? String(activeInfo.bones) : ""}
          data-duration={activeInfo ? String(activeInfo.duration) : ""}
          data-time={clock.toFixed(2)}
          data-error={error ?? ""}
          style={{ fontSize: 13, color: error ? "#fca5a5" : "#a7f3d0" }}
        >
          {status} · clip t={clock.toFixed(2)}s
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>
          动作来源：CMU Graphics Lab Motion Capture Database（mocap.cs.cmu.edu），
          BVH 转换：Bruce Hahne（cgspeed），免费用于研究与商业用途，不得转售数据本身。
          人形模型：pixiv three-vrm 官方示例 VRM1_Constraint_Twist_Sample.vrm（VRM Public License 1.0）。
        </div>
      </div>
    </div>
  );
}
