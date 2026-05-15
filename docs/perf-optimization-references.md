# 性能优化参考资料

> 针对 home-designer Three.js 应用的"减少场景对象数"专题。  
> 当前瓶颈：`projectObject()` 遍历 ~4200 mesh ≈ 120ms/帧。  
> 已完成的 perf 工作（commit `d79d409` + `821149b`）：shadow map 降级 / 软阴影关闭 / 拖拽时冻结阴影 + 隐藏室内对象。

---

## 1. 几何合并三大杀手锏

### A. InstancedMesh — N 个相同几何

适合：栏杆立柱（baluster）、围栏 slat、屋顶瓦片、外墙重复格、楼梯踏步

- **官方 doc**：[`THREE.InstancedMesh`](https://threejs.org/docs/#api/en/objects/InstancedMesh)
- **drei 包装组件**：[Pmndrs/drei `<Instances>`](https://github.com/pmndrs/drei#instances)
- **速度对比讨论**：[discourse.threejs.org #18908](https://discourse.threejs.org/t/instanced-mesh-vs-many-meshes/18908) — 10 000 个对象 from 60ms → 1ms

### B. BatchedMesh (Three r166+) — 不同几何 / 同 material 也能合

适合：不同尺寸的外墙板 / 地板砖 / 不同长度的栏杆段

- **官方 PR**：[mrdoob/three.js #22865](https://github.com/mrdoob/three.js/pull/22865)（作者 Garrett Johnson）
- **docs**：[`THREE.BatchedMesh`](https://threejs.org/docs/#api/en/objects/BatchedMesh)
- **背景论文 / 思想**：cluster-based rendering & multi-draw indirect

### C. BufferGeometryUtils.mergeGeometries() — 静态永不变形对象

适合：墙裙线条、外墙瓷砖、永久装饰条

- **源码**：[`examples/jsm/utils/BufferGeometryUtils.js`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/utils/BufferGeometryUtils.js)
- **API**：`BufferGeometryUtils.mergeGeometries(geometries: BufferGeometry[]) => BufferGeometry`

---

## 2. GLTF 子 mesh 爆炸 — 预处理工具链

家具 GLB 单文件常 100–500 子 mesh × 50 件 = 几万对象，是 `projectObject` 大头。

### gltfpack（meshoptimizer 出品）

- **Repo**：[zeux/meshoptimizer](https://github.com/zeux/meshoptimizer)
- **常用命令**：`gltfpack -i sofa.gltf -o sofa.gltf -kn -km` —— 可从 500 → ~10 子 mesh
- **flags**：
  - `-km` mesh merge
  - `-kn` keep names
  - `-cc` compress

### glTF-Transform（JS API）

- **官网**：[gltf-transform.dev](https://gltf-transform.dev)
- **build 脚本里可调用的算子**：`weld()` / `dedup()` / `instance()` / `simplify()`
- 加进 `scripts/` 自动跑过一遍 → bundle 也变小

---

## 3. three-mesh-bvh — Raycast / 剔除从 O(N) → O(log N)

每次点击窗 / 进房间 / 拖 yard 物件都走 raycast。4200 mesh 一次点击就 4200 次相交测试。

- **Repo**：[gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) ⭐ 2.6k
- **接入**：
  ```js
  import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  // 然后给每个 geometry 调用 computeBoundsTree()
  ```
- **R3F 集成**：drei `<Bvh>` 组件直接包整个场景
- **README 里有 demo + benchmark**：CAD viewer 通常用它降两个数量级

---

## 4. LOD — 远景低多边形、近景真实模型

DistantTreeRing、远景草地、屋顶瓦片 → 距离过远时切超低 poly。

- **Three.js API**：[`THREE.LOD`](https://threejs.org/docs/#api/en/objects/LOD)
- **R3F drei**：[`<Detailed>`](https://github.com/pmndrs/drei#detailed) 包装多份子树
- **gltf 扩展**：[`MSFT_lod`](https://gltf-transform.dev/extensions.html#msft_lod)
- **原始论文**：Levoy & Pulli 90s — 现代综述见 *Real-Time Rendering* 4th ed Ch. 19

---

## 5. R3F 特定 pitfalls — Pmndrs 官方 + Discord 总结

- **官方文档**：[docs.pmnd.rs/react-three-fiber/advanced/scaling-performance](https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance)
- **关键几条**：
  - ❌ 不要在 `useFrame` 里 `setState` — 每帧触发 React render
  - ✅ Canvas 用 `frameloop="demand"` — 静止时 0 渲染开销，靠 `invalidate()` 触发
  - ✅ `gl={{ powerPreference: "high-performance" }}`
  - ✅ `<PerformanceMonitor>` + ADR — FPS 掉时自动降 DPR / shadow map
- **<PerformanceMonitor>**：[drei docs](https://github.com/pmndrs/drei#performancemonitor)
- **ADR 实现思路**：[r3f #1814 "adaptive resolution"](https://github.com/pmndrs/react-three-fiber/discussions/1814)

---

## 6. Frustum culling 反向思考

- **永远在视野内的元素**（地基、远景树环）→ `mesh.frustumCulled = false` 跳过 sphere check
- **经常在视野外的**（楼上看不到的下层）→ 手动 parent group `visible=false`
- **论文**：Akenine-Möller *Real-Time Rendering* 4th ed Chapter 19 — culling techniques
- **R3F doc**：相关讨论在 [discourse.threejs.org "best-practices-for-1000-objects"](https://discourse.threejs.org/t/best-practices-for-1000-objects/4731)

---

## 7. 相关 Issue / PR / Discussion

- **mrdoob/three.js #21305** "Performance with many lights"（多个 shadow-casting light 各跑 6 passes）  
  https://github.com/mrdoob/three.js/issues/21305
- **pmndrs/react-three-fiber #2153** "lazy components and Suspense"（楼上房间走 React.lazy）  
  https://github.com/pmndrs/react-three-fiber/discussions/2153
- **discourse.threejs.org** "Optimizing scene with 1000+ objects" — InstancedMesh + frustum + texture atlas 综合  
  https://discourse.threejs.org/t/best-practices-for-1000-objects/4731

---

## 8. 架构级技术（持续瓶颈时）

### Visibility-based room culling (PVS-style)

参考 *Quake* 引擎的 PVS、*Unreal* 的 Precomputed Visibility。每个房间标记"从哪些相机位置可见"，渲染时只画必要房间。

- **奠基论文**：Teller & Sequin "Visibility preprocessing for interactive walkthroughs" SIGGRAPH '91  
  http://www.cs.cmu.edu/~ph/869/papers/teller-thesis.pdf

### WebGPU renderer 切换

- **R3F 已支持**：`@react-three/fiber/webgpu`
- **Three.js WebGPU**：[`THREE.WebGPURenderer`](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/renderers/webgpu)
- 多 light + many mesh 场景吞吐能涨 2–3×
- 你已有 `SSGIPostProcessing.tsx`，迁移路径相对短

---

## 落地优先级（按 ROI / 实施难度）

| 顺序 | 措施 | 预计收益 | 实施难度 |
|---|---|---|---|
| 1 | **gltfpack 预处理所有 .gltf** | 减几千 submesh，立竿见影 | 写一次脚本，自动跑 |
| 2 | **栏杆 / slat / 屋顶瓦 改 InstancedMesh** | 减 hundreds of meshes | 改 5-10 处循环 |
| 3 | **three-mesh-bvh 给 raycast 加速** | 点击体验立刻变快 | 接入 ~20 行代码 |
| 4 | **Canvas `frameloop="demand"`** | 静止 100% CPU/GPU 省 | 一行改动 |
| 5 | **frustumCulled 显式控制** | 减遍历开销 | grep + 调整 |
| 6 | **PerformanceMonitor 自适应降级** | FPS 低时自救 | 中等 |
| 7 | **远景元素 LOD 切换** | 远处对象 poly 数 ↓ | 中等 |
| 8 | **BatchedMesh 替代 N 个不同 box** | 进一步合 | 中等 |
| 9 | **WebGPU renderer 迁移** | 整体吞吐 2-3× | 较高（兼容性） |
| 10 | **PVS-style room visibility** | 大场景质变 | 高（架构） |

---

## 工具 / 库一览（实施时要装的）

```bash
# 1. gltfpack
npm install -g gltfpack  # 或用 brew install meshoptimizer

# 2. glTF-Transform
npm install --save-dev @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions @gltf-transform/cli

# 3. three-mesh-bvh
npm install three-mesh-bvh

# 4. drei（很多包装组件，应该已装）
# npm install @react-three/drei
```

---

最后更新：2026-05-15
