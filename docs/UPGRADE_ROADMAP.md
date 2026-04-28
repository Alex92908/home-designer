# 院子去 Low-Poly 化升级路线图

**作者**：Claude（基于代码审计 + 用户产品方向沟通）
**日期**：2026-04-26
**版本**：v1 — 方案文档，不动代码
**目标读者**：本仓库的开发者 / 产品负责人

---

## TL;DR（90 秒读完）

院子的"玩具感"不是单一原因，而是**三层结构性问题**叠加：

1. **资产层**：Kenney Nature Kit 是为像素卡通游戏设计的低面 / 平涂资源，几何与材质上限就是"我的世界"。换皮治不了。
2. **数据模型层**：`YardItem` 是单体颗粒（一棵树 / 一个篝火 / 一段栅栏），没有"区域 / 复合组件 / 流线"概念。`YARD_PRESETS` 只是把单体往坐标上撒，所以视觉上必然散乱。
3. **渲染层**：`HouseCanvas.tsx` 里其实已经分裂成了两个体系——
   - **建筑级**：Pool / Pergola / Driveway / Cabana 用程序化几何 + `MeshReflectorMaterial`，质量已经接近"地产效果图"；
   - **景观级**：`YardPlanItems3D` 把 Kenney GLB 又用 `cylinderGeometry + coneGeometry` 重画一遍（注释明确写着 "SketchUp-Free aesthetic: simple primitives. Detail comes from AI render, not the live preview"）。
   两套美术混在一个画面里，所以观感像"高端别墅模型上撒了一把乐高"。

**升级不是换贴图，是把这三层一次性对齐**到"建筑师视角 + PBR 真实感"。下面给的是**分四个阶段、可独立交付**的迁移路径，每个阶段后画面都能见效，且不会半途崩坏现有功能。

---

## 1. 代码事实清单（避免空谈）

下面是这版方案的所有事实依据，全部来自 `src/` 目录的实际文件，不是猜的。后面所有"改动建议"都对应这里的行号。

| 关注点 | 文件 / 位置 | 现状 | 与目标的差距 |
|---|---|---|---|
| 单体资产库 | `src/lib/outdoorAssets.ts` 第 37-80 行 | `OUTDOOR_ASSET_LIBRARY`：树 7、花草 8、岩石 5、设施 14。每条都指向 Kenney GLB。 | 没有"复合组件"一等公民。`category: "tree" \| "plant" \| "rock" \| "feature"` 是平铺枚举，无法表达"社交岛"这类聚合概念。 |
| 预设 | `src/lib/outdoorAssets.ts` 第 97-238 行 | `YARD_PRESETS` 4 个（地中海别墅 / 热带度假 / 日式禅意 / 田园农庄），每个 25-35 条单体坐标。 | 没有空间逻辑分区，纯坐标平铺，所以截图里出现"23 elements 散点"。 |
| 用户画布数据模型 | `src/lib/types.ts` 第 30-51 行 | `YardItem` 字段：`id / kind / x / z / rot / scale`。`YardPlan` 还有未启用的 `groundPolygons` 和 `paths` v2 占位。 | `groundPolygons` 已经为"区域 / 铺装"留好坑位，但从未启用。这是天然的"叙事流"宿主。 |
| 2D 编辑器 | `src/components/YardPlan.tsx` | 顶视图 SVG，`AssetGlyph` 用建筑学符号（双圆同心 + 辐射线）画树——**2D 一侧已经是建筑师审美**了。 | 跟 3D 一侧严重脱节：用户在 2D 里画的是"建筑制图"，3D 里却变成 Minecraft。 |
| 3D 景观层 | `src/components/HouseCanvas.tsx` 第 781-840+ 行 `YardPlanItems3D` | 每个 YardItem 用 `cylinderGeometry + coneGeometry` 程序化重画。注释：*"SketchUp-Free aesthetic… Detail comes from AI render"*。 | 程序化原语 + Kenney 调色 = 玩具感的主因。Kenney GLB 文件其实大多没真正在跑，但配色和形态延续了它的语言。 |
| 3D 建筑层 | `src/components/HouseCanvas.tsx` 第 1367-1647 行 | Pool 已经用 `MeshReflectorMaterial`、`normal map drift` 模拟水流；Cabana / 灯柱 / 长椅都是程序化精细几何。 | **这部分已经达到"地产效果图"水准**。问题是它跟玩具树站一起，被拉低了。 |
| 资产加载封装 | `src/components/HouseCanvas.tsx` 第 765-776 行 `KenneyAsset` | 直写 `useGLTF('/models/kenney_nature/${name}.glb')`，路径硬编码。 | 替换资产包需要抽出加载层，不能再硬编码 `kenney_nature`。 |

---

## 2. 整体策略：三层对齐

### 2.1 资产策略 — 彻底替换 Kenney（用户已确认）

**留**：`/public/models/kenney_nature/` 目录可保留作为 fallback，但**不再作为主渲染源**。

**进**：双轨制 PBR 资产管线

| 用途 | 资产源 | 许可 | 文件大小预估 | 备注 |
|---|---|---|---|---|
| 单体植物 / 树（精细，>100MB 也能接受） | **Poly Haven** | CC0 | 5-50 MB / 件，含 4K PBR | 只用作"孤植大树"——每个院子最多 2-3 棵，可以负担 |
| 群植 / 灌木丛 / 草本 | **Quaternius Ultimate Nature Pack** | CC0 | 0.3-2 MB / 件，含基础 PBR | 适合 instanced，每场景 50+ 实例不掉帧 |
| 硬质景观（铺装、墙面、混凝土、岩板） | **Poly Haven 材质库**（PBR 贴图，不是模型） | CC0 | 1-10 MB / 张 4K | 配合代码生成的 `BoxGeometry` / `ExtrudeGeometry` |
| HDRI 环境光 | **Poly Haven HDRI** | CC0 | 1-30 MB | 仓库已用 `potsdamer_platz_1k.hdr`，可继续 |

**实施细节**：
- Poly Haven 官方下载页提供 1K / 2K / 4K / 8K 的纹理分级和 LOD glTF — 默认拉 **2K + LOD2**，bundle 增量可控（约 8-15 MB / 棵）。
- Quaternius Ultimate Nature 在 [poly.pizza](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr) 直接打包下载 glTF；其官网部分包仅给 .blend / .fbx，需要 `gltf-transform` 一次性转换。
- 写一个 `scripts/download-assets.mjs`（参考已有的 `scripts/download-artworks.mjs` 风格），把 Poly Haven 的 API 调用、压缩、放置都自动化。资产二进制不入 git（用 `.gitignore` + CI 拉取）。

### 2.2 数据模型策略 — 引入 Prefab 一等公民

把 `YardItem` 从"单体颗粒"扩展成"颗粒 + 复合组件"两态共存的 union。

```ts
// src/lib/types.ts ── 现状
export interface YardItem {
  id: string;
  kind: string;       // "tree.olive" | "feature.fence" | …
  x: number; z: number;
  rot?: number; scale?: number;
}

// 提案 v2
export type YardItem = YardSingleton | YardPrefab | YardZone;

interface YardCommonFields {
  id: string;
  x: number; z: number;
  rot?: number; scale?: number;
}

export interface YardSingleton extends YardCommonFields {
  type: "singleton";
  kind: string;       // 同现状，单体资产
}

export interface YardPrefab extends YardCommonFields {
  type: "prefab";
  prefabKind: PrefabKind;        // "social_island" | "farm_box" | "porte_cochere" | …
  /** Prefab 自身的可调参数。每个 PrefabKind 一套 schema。 */
  params: Record<string, unknown>;
  /** 派生：渲染时由 prefab 的 expand() 函数生成的子项。不入 store. */
}

export interface YardZone extends YardCommonFields {
  type: "zone";
  zoneKind: "social" | "private" | "utility" | "agro";
  /** 多边形顶点（cm，相对 zone 中心）。Prefab / singleton 落在 zone 内
   *  时由编辑器联动调整铺装、植物密度等。 */
  polygon: Array<[number, number]>;
  /** 铺装材质的 MaterialItem.id，让 Zone 直接能换皮。 */
  pavingMaterialId?: string;
}
```

**关键设计选择**：
- **Prefab 不展开存储**：store 里只保留 `prefabKind + params`，渲染时 `expandPrefab()` 函数生成子节点。这样用户可以"整块拖、整块换肤、整块替换"，不会因为 30 个子节点污染 undo 栈。
- **Zone 是叙事流的载体**：用户的"中心化叙事流"（社交核心 / 私密休闲 / 功能配套）由 Zone 表达。Zone 自己渲染铺装与边界，Prefab 落在内部。
- **向后兼容**：现有 `YardItem` 全部视为 `YardSingleton`，加一个 `migrateYardItem()` 在 store 读取时补 `type: "singleton"` 默认值。已有保存的项目不会丢。

**新文件结构提案**：

```
src/lib/
  outdoorAssets.ts      ← 现有：单体库
  outdoorPrefabs.ts     ← 新建：Prefab 注册表 + expandPrefab()
  outdoorZones.ts       ← 新建：Zone 类型 + 区域间约束规则
  yardPlanLayouts.ts    ← 新建：基于 Zone+Prefab 重写的 4 个 PRESET
  outdoorClearance.ts   ← 现有：扩展为支持 Zone 内 / 跨 Zone 的间距规则
```

### 2.3 渲染层策略 — 终结 "Kenney Adapter" 注释

把 `HouseCanvas.tsx` 第 781-840 行的程序化重画**完整删除**，所有 YardItem 走真正的 GLB 加载。但要做到三件事，否则会卡：

1. **Suspense 分级 + 懒加载**：Poly Haven 的高分树 gltf 不能在首次渲染同步加载。包一层 `<Suspense fallback={<LowPolyPlaceholder />}>`，placeholder 用现在的 `cylinderGeometry + coneGeometry`（也就是说，**当前的程序化代码降级为 fallback**，这是它最合理的归宿）。
2. **Instanced Mesh**：同一棵树在场景里出现 20 次时，用 `<Instances>`（@react-three/drei）+ `<Instance>`，几何只上传一次。Quaternius 灌木尤其适合这个。
3. **LOD**：用 drei 的 `<Detailed>` 包高分树，远景自动切到 Quaternius 简模。Poly Haven 4K 树只在近景 < 15m 时启用。

---

## 3. 视觉升级：哪些靠 Shader，哪些靠 PBR

不是所有东西都要 PBR 资产。下面列哪几样**用 shader 比换贴图更划算**。

### 3.1 水面（Pool）

现状（HouseCanvas.tsx 第 1367-1444 行）已经用 `MeshReflectorMaterial`，已经有 `normal map drift` 模拟流动。**不需要重写**，但有两个低成本改进：

- 加 **菲涅尔混合**：视角越平，反射越强，越垂直越透到底部 turquoise。drei 的 `MeshReflectorMaterial` 支持 `mixStrength` + `distortionMap`，调参即可。
- 加 **caustic 投影**：底部贴一张动态 caustic 纹理（Poly Haven 有 CC0 的 `pool_caustics_seq` 序列），用 `<videoTexture>` 循环播放。0 mesh 增量，`+12-step` 视觉跃迁。

### 3.2 地面铺装（核心高级感）

这是最大的 ROI。

| 当前 | 提案 |
|---|---|
| `meshStandardMaterial color="#D4D4D8" roughness={1}` 单色块（GlobalCanvas 第 273 行同款） | Poly Haven `travertine_floor`（4K diffuse + normal + roughness + AO + displacement），用 `useTexture` 加载，repeat 1.5×1.5m |
| 全场地一张材质 | 按 Zone 切：社交核心铺岩板，私密区铺木台，功能区铺碎石。`zone.pavingMaterialId` 直接驱动 |

**实现要点**：
- 用 `MeshStandardMaterial` + `displacementMap` + `displacementScale: 0.005` 给岩板拼缝深度，无须几何切割。
- `anisotropy: 16` 拉满，切线方向的清晰度直接拉开"PS5"和"PS2"的差距。

### 3.3 篱笆 → 景墙（叙事性的关键）

用户分析里点出的"虚实结合景墙"。技术上：

- 删除 `feature.fence` 单体（或保留为 fallback），新增 Prefab `boundary.slat_wall`：
  - 程序化生成竖向木格栅 `BoxGeometry` 阵列，每根 5×80×3cm，间距 2cm；
  - 后置一面深色混凝土墙（可选 transparent），白天阳光打过来能在地面投出节奏感强烈的条纹阴影；
  - 用 `castShadow` + 高分 `shadow-mapSize` 才有效。
- 这种"做光影"的组件比换 4K 树的 ROI 高得多——它在 sunset 和 night 模式（截图右上角已有）下视觉冲击最大。

### 3.4 树 — 孤植大树 vs 集群灌木的二分

按用户的"孤植大树"原则：

- **每个 Zone 只允许 1 棵 Hero Tree**（罗汉松 / 橄榄 / 枫树），从 Poly Haven 拉高分版本。
- 其余密度由 Prefab 内部的 instanced 生成，例如 `farm_box.expand()` 里塞 `<Instances>` 200 株薰衣草。

UI 层面：YardPlan 编辑器里要给"Hero Tree"特殊的 glyph（更大双圆 + 中心十字标），跟普通灌木区分。

---

## 4. Prefab 体系详细设计（v1 收敛三个）

第一阶段先收敛三个 Prefab，覆盖用户分析里点出的最关键三个空间：

### 4.1 `social_island` — 社交核心

**组件清单**（`expandPrefab` 内部生成）：
- 1× 下沉卡座（程序化 `ExtrudeGeometry`，台阶下沉 35cm）
- 1× 圆形 / 椭圆篝火池（Box + 内嵌 `<pointLight>` + 火焰 sprite）
- 1× 户外厨房岛台（程序化，台面用 Poly Haven `marble_calacatta`）
- 4-6× Quaternius 装饰盆栽（instanced）

**可调参数**：
```ts
{
  shape: "rect" | "L" | "circle";
  sizeM: { w: number; d: number };  // 默认 6×4m
  fireFeature: "pit" | "table" | "none";
  kitchenFacing: "north" | "south" | "east" | "west";
}
```

**摆放约束**：必须紧邻房屋外墙 1 个 face，且与 Pool 边界距离 ≤ 3m（保证社交闭环）。`outdoorClearance.ts` 里加 `validatePrefabPlacement(prefab, yardPlan)`。

### 4.2 `farm_box` — 抬高床菜园

**组件清单**：
- N× 木质抬高床（程序化 `BoxGeometry`，60cm 高 + 木纹贴图）
- 内部：参数化网格采样，每格 30cm 放一株 Quaternius 薰衣草 / 迷迭香 / 生菜
- 边界：1.2m 高细木桩 + 不锈钢拉索（程序化 `CylinderGeometry`）

**可调参数**：
```ts
{
  bedCount: number;        // 默认 4
  bedShape: "rect" | "U";
  cropMix: "herbs" | "veggies" | "mixed";
  pathBetween: boolean;    // 是否在床之间留 60cm 步道
}
```

### 4.3 `porte_cochere` — 入户挑檐 + 隐藏车位

**组件清单**：
- 主体：从主屋外墙挑出的 RC 板（程序化 `BoxGeometry`，6×4m × 25cm 厚）
- 2× 圆形或方形清水混凝土柱（程序化）
- 地面：Zone 内自动铺 `polished_concrete`
- 两侧：高 1.8m 常绿绿篱（instanced）

**可调参数**：
```ts
{
  carCount: 1 | 2 | 3;
  facingDir: "front" | "side";
  pillarStyle: "round" | "square" | "none";  // none = 悬挑结构
}
```

**与现有 `Driveway`（HouseCanvas 第 1872 行）的关系**：
现有 `Driveway` 是程序化圆形车道。Prefab `porte_cochere` 不取代它，而是作为入户起点；Driveway 的曲线终点对接到 `porte_cochere.entryPoint`。后续可以让 `Driveway` 也变成 Prefab，但**不在第一阶段做**——避免破坏现有 demo。

---

## 5. Preset 重写：从"撒豆"到"3 个 Zone + N 个 Prefab"

把 `YARD_PRESETS` 4 个完全重写。每个 preset 长这样：

```ts
{
  id: "modern_villa",
  label: "现代别墅",
  zones: [
    { kind: "social",  polygon: [...], pavingMaterialId: "travertine_l" },
    { kind: "private", polygon: [...], pavingMaterialId: "wood_deck_teak" },
    { kind: "utility", polygon: [...], pavingMaterialId: "polished_concrete" },
  ],
  prefabs: [
    { kind: "social_island",  x: -200, z: 400, params: { fireFeature: "pit" } },
    { kind: "farm_box",       x:  800, z: 200, params: { bedCount: 4 } },
    { kind: "porte_cochere",  x:    0, z: -900, params: { carCount: 2 } },
  ],
  heroTrees: [
    { kind: "tree.poly_haven_olive_old", x: -500, z: 0 },
    { kind: "tree.poly_haven_pine_tall", x:  600, z: 600 },
  ],
  // 完全不再放零散 plant / flower —— 全部由 Prefab 内部 instanced 生成
}
```

对比现状：地中海别墅原本 30 条 item，新版变成 **3 zones + 3 prefabs + 2 hero trees = 8 个一等公民**。Site Plan 显示从 "23 elements" 变成 "8 elements"，但视觉密度反而更高，因为 Prefab 内部能塞 50 株植物。

---

## 6. 分阶段实施 — 每个阶段都能出 demo

| 阶段 | 工时（人日，单人） | 改动文件 | demo 卖点 |
|---|---|---|---|
| **P0：拆 Kenney 直接依赖** | 1 | `HouseCanvas.tsx`（抽 `KenneyAsset` → `OutdoorAsset`，加 `assetPath` 配置） | 内部重构，无视觉变化 |
| **P1：数据模型扩展 + 兼容** | 2 | `types.ts`、`store.ts`、`outdoorPrefabs.ts`（新建）、`outdoorZones.ts`（新建） | 已有 preset 100% 兼容；新模型可用但暂无 UI |
| **P2：第一个 Prefab `social_island`（程序化版本，不动资产）** | 2 | `outdoorPrefabs.ts`、`HouseCanvas.tsx`（加 `<PrefabRenderer>`） | 用户首次能整块拖一个"完整的社交区"。视觉上首次跳出玩具感（程序化挑檐 + 下沉卡座 + 灯具阴影） |
| **P3：地面铺装 PBR + Zone 分区** | 1.5 | `outdoorZones.ts`、`HouseCanvas.tsx`（替换 ground material）、`textures.ts`（加 Poly Haven 加载） | 截图最大跃迁——一眼"地产效果图" |
| **P4：景墙 Prefab 替换 fence** | 1 | `outdoorPrefabs.ts`（加 `boundary.slat_wall`） | sunset 模式下投影戏剧化，营销素材级 |
| **P5：替换 4 个 PRESET 为 Zone+Prefab 形式** | 1 | `yardPlanLayouts.ts`（新建，原 `YARD_PRESETS` 废弃） | 每个一键模板都是"建筑师手作"质感 |
| **P6：引入 Poly Haven Hero Tree（含下载脚本）** | 2 | `scripts/download-poly-haven.mjs`（新建）、`outdoorAssets.ts`（加 PBR 资产条目） | 1-2 棵 hero tree，构图焦点感 |
| **P7：剩余 Prefab `farm_box` + `porte_cochere`** | 3 | `outdoorPrefabs.ts` | 完整三环叙事流到位 |
| **P8：水面 Caustic + 菲涅尔调优** | 0.5 | `HouseCanvas.tsx` Pool 局部 | 锦上添花，preset 录屏视频感更强 |

**总工时**：约 **14 人日**。如果要砍范围只做最有 ROI 的 3 步：**P3 + P4 + P5**（4 人日），截图能从"乐高"直接跨到"高端楼盘渲染图"。

---

## 7. 风险与坑

1. **Bundle size**：Poly Haven 4K 树单棵 30+ MB。**必须**走 CDN / 动态 import，不能塞进 Next.js public bundle。建议放 `public/models/polyhaven/` 但用 `next.config.js` 的 `outputFileTracing` 排除，或挂到对象存储 + `assetPrefix`。
2. **WebGL 纹理上限**：现在 GlobalCanvas 注释里已经吃过 `MAX_TEXTURE_IMAGE_UNITS=16` 的亏（第 30-33 行）。每个 PBR 材质 4-5 张贴图，全场景共享同一 `TextureLoader` 实例 + `Material` 缓存是必须的。
3. **iOS Safari**：Poly Haven 部分 USD 资产 iOS 不支持。glTF 必选，USD 永远走桌面。
4. **CC0 ≠ 不署名**：商用前在产品 About 页加一段 "3D assets courtesy of Poly Haven & Quaternius (CC0)" 是行业惯例，不是法律要求但能避免被同行截图喷。
5. **Prefab 拖拽 UX**：用户从单体拖变成整块拖，落地点的预览框需要画出整个 prefab 的 bounding box（不是单点）。`YardPlan.tsx` 的 `AssetGlyph` 要新增 `PrefabGlyph`——一个虚线包络框 + 内部图标。
6. **AI 渲染的提示词**（`comfyWorkflow.ts`、`roomPrompt.ts`）需要同步：当 Zone 是 social_core 时，prompt 加 "sunken seating, fire pit, calacatta marble countertop"——否则渲染图与 3D 预览割裂。

---

## 8. 改动文件清单（按阶段映射）

新增：
- `src/lib/outdoorPrefabs.ts`
- `src/lib/outdoorZones.ts`
- `src/lib/yardPlanLayouts.ts`（取代 `YARD_PRESETS`）
- `src/components/PrefabRenderer.tsx`
- `src/components/ZoneRenderer.tsx`
- `scripts/download-poly-haven.mjs`
- `scripts/convert-quaternius-to-gltf.mjs`
- `docs/3d-assets-pbr.md`（接续 `docs/3d-assets.md`）

修改：
- `src/lib/types.ts` — `YardItem` union 扩展
- `src/lib/store.ts` — `migrateYardItem` 兼容；`addYardPrefab` / `addYardZone` actions
- `src/lib/outdoorAssets.ts` — 标记 Kenney 条目为 `legacy: true`，新增 PBR 条目；`KenneyAsset` 改名 `OutdoorAsset3D`
- `src/lib/outdoorClearance.ts` — 加 prefab / zone 校验
- `src/components/YardPlan.tsx` — Prefab / Zone glyph，区域 polygon 编辑
- `src/components/HouseCanvas.tsx` — 删除第 781-840 行程序化重画（降级为 Suspense fallback）；接入 `<PrefabRenderer>` + `<ZoneRenderer>`；地面材质替换
- `src/lib/preload.ts` — PBR 贴图与 hero tree 的 preload 名单
- `src/lib/textures.ts` — 加 `loadPbrTextureSet(name)` 工厂
- `next.config.js` — `serverExternalPackages` / 资产路径处理

废弃（保留代码、加 `@deprecated` 注释，下个大版本删）：
- `KenneyAsset` 直接调用
- `YARD_PRESETS` 中的散点坐标
- `YardPlanItems3D` 内的 cylinder/cone 重画分支

---

## 9. 决策需要你拍板的几件事

读到这里，下面这几个问题决定了 P1-P3 怎么开工。建议在动代码前先定：

1. **PBR 资产是否走对象存储**？如果走 public bundle，整包会 +200MB；如果走 CDN，需要新增运维（推荐 Cloudflare R2 + 脚本同步）。
2. **Prefab 用户能否自定义参数**？P2 默认硬编码 social_island 为 "6×4m + pit + east"。是否在 RightPanel 里给 prefab 加参数面板（+1 人日）。
3. **"低多边形"风格是否完全废弃**？还是作为一个 "卡通模式"开关保留（在 TopBar 里加切换器）？保留的话能服务部分二次元 / 玩具风用户，但每个 Prefab 都得画两套。
4. **Hero Tree 的法务**：如果要在国内市场跑，是否对 Poly Haven 链接（境外）有合规担忧？需要时可以先用 Quaternius（境外但更轻量），把 Poly Haven 留到出海版本。

---

## 10. 参考资料

- Quaternius Ultimate Nature Pack（CC0）— [quaternius.com/packs/ultimatenature.html](https://quaternius.com/packs/ultimatenature.html)
- Quaternius Stylized Nature MegaKit — [quaternius.com/packs/stylizednaturemegakit.html](https://quaternius.com/packs/stylizednaturemegakit.html)
- poly.pizza Quaternius bundle（直接 glTF 下载）— [poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr)
- Poly Haven 3D Models（CC0）— [polyhaven.com/models](https://polyhaven.com/models)
- Poly Haven Trees — [polyhaven.com/models/trees](https://polyhaven.com/models/trees)
- Poly Haven Plants — [polyhaven.com/models/plants](https://polyhaven.com/models/plants)
- @react-three/drei 文档 — `<Instances>`、`<Detailed>`、`MeshReflectorMaterial`

---

## 附 A：现状代码位置速查

```
src/lib/types.ts:30          YardItem 接口
src/lib/types.ts:45          YardPlan + groundPolygons / paths v2 占位
src/lib/outdoorAssets.ts:37  OUTDOOR_ASSET_LIBRARY 单体表
src/lib/outdoorAssets.ts:97  YARD_PRESETS 4 个预设
src/components/YardPlan.tsx:42  AssetGlyph（2D 建筑符号）
src/components/HouseCanvas.tsx:765  KenneyAsset 加载封装
src/components/HouseCanvas.tsx:781  YardPlanItems3D 程序化重画
src/components/HouseCanvas.tsx:1367 Pool + MeshReflectorMaterial
src/components/HouseCanvas.tsx:1648 Pergola（程序化）
src/components/HouseCanvas.tsx:1867 Driveway（程序化）
src/components/GlobalCanvas.tsx:30   GlobalRoomLight（已规避 MAX_TEXTURE_IMAGE_UNITS）
```
