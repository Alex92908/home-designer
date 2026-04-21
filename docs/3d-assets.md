# 3D 资产接入指南

Step 2 BuildCores-style 视觉升级：用真实 glTF / GLB 模型替换程序化盒子几何。
基建已就绪（见 `src/lib/types.ts` 的 `FurnitureItem.model3d`），
本文档说明如何加入资产、命名约定、坐标规范、授权要求。

## 目录约定

所有资产放在 `public/models/<category>/<slug>.glb`：

```
public/
  models/
    sofa/
      nordic-3seat.glb
      leather-l-shape.glb
    bed/
      oak-platform.glb
    dining_table/
      round-marble.glb
    ...
```

运行时路径：`"/models/sofa/nordic-3seat.glb"`（相对站点根，Next.js
的 `public/` 直接映射到根路径）。

## 在代码里启用一个资产

在 `src/lib/furniture.ts` 里给对应家具条目加 `model3d` 字段：

```ts
{
  id: "sofa-fabric-gray",
  name: "布艺三人沙发",
  ...
  width: 240, depth: 95, height: 85,
  // 👇 新增
  model3d: {
    url: "/models/sofa/nordic-3seat.glb",
    // scale: 1.05,         // 可选：微调比例
    // rotation: Math.PI,   // 可选：如果资产的 +Z 不是"前方"
    // yOffset: 0.02,       // 可选：让模型离地几厘米（避免 z-fighting）
  },
},
```

首次在 3D 视图切到含该家具的房间，drei 的 `useGLTF` 会缓存并立刻渲染。

## 坐标与比例规范

代码会按家具条目的 `width × depth × height`（cm）自动缩放到正确大小——
资产实际导出尺寸不重要，但以下三件事必须对：

1. **朝向**：资产在 +Z 方向是"正面"（面向沙发背后 → -Z 是后背、人坐在
   +Z 方向）。不对就用 `rotation` 补偿（π = 180°）。
2. **原点在底部中心**：家具脚/底座的中心点在 (0, 0, 0)；向上是 +Y。如
   果资产原点在几何中心，用 `yOffset` 把它顶上去；或更好的办法：在
   Blender 里重设原点再导出。
3. **比例不能各向异性失真**：代码用 `Math.min(sx, sy, sz)` 取均匀缩
   放。如果资产 aspect ratio 和 width/depth/height 差很多，家具
   footprint 就会"瘦身"看起来不对——最好让资产的 bounding box 比例
   接近目标尺寸。

## 资产来源（按推荐程度）

**CC0 / 免费商用**

- **Poly Haven** (<https://polyhaven.com/models>)：高质量 CC0 室内家具 +
  附带 PBR 贴图，是首选
- **Khronos glTF-Sample-Models**：测试用，不一定是家具
- **Sketchfab** 的 "CC0" 或 "CC-BY" 筛选：海量，但质量参差，注意看署名要求

**付费**

- **CGTrader**、**TurboSquid**：专业品质，按件收费，有 glTF 过滤
- **Sketchfab Store**：$5-$50 区间居多

**规避**

- 含商标的品牌模型（宜家、Vitra 等）：可能侵权，除非官方授权站
- Format 不是 glTF/GLB 的：FBX/OBJ 要经 Blender 转换（保留 PBR 贴图易丢失）

## 性能预算

每个家具资产建议：

- 单文件 ≤ 2 MB（GLB 二进制 + DRACO 压缩）
- Triangle count ≤ 30k
- 贴图 ≤ 2048 × 2048，共 ≤ 4 张（albedo + normal + roughness + metallic）

超过就考虑在 Blender 里 Decimate + Bake 再导。

## 降级策略

如果资产加载失败（404、CORS、格式错误），代码自动回退到程序化盒子（见
`GltfFurnitureWithFallback` 组件）。用户看不到空洞，只是失去真实感。这
意味着可以先接一批，缺失的品类不会 block 其他功能。

## 工作节奏建议

不要一次性替换全部 146 件。按视觉影响力排序，每轮换一类：

1. **沙发**（客厅 C 位，视觉权重最高）
2. **床 + 床品**（卧室 C 位）
3. **餐桌椅**
4. **衣柜 / 电视柜 / 橱柜**
5. **卫浴三件套**
6. **小件**（落地灯、植物、书架等）

每轮 1 commit，保留原有程序化几何作 fallback，风险可控。
