---
name: zhuya-scene-authoring
description: >
  筑雅 ZHUYA（本仓库）专用：素材（GLB）入库 + 场景/房间/片场模板搭建的准确工作流。
  当任务涉及以下任一项时使用：往 furniture.ts 加家具/道具、导入压缩 GLB 模型、
  搭建或修改样板间/片场/房间布局、给房间摆家具（placedItems / furnitureOverrides）、
  新增家具分类、调家具尺寸朝向、跑 compress-models 资产管线。
  本 skill 记录的是「这个代码库真实的约定」，不是通用 Three.js 教程——
  外部通用 R3F/Three.js skill 不知道这些，别用它们的假设覆盖本文。
---

# 筑雅场景搭建 · 项目专属

> 本文所有约定都从真实代码核对而来（`src/lib/{types,furniture,store,projectTemplates,defaultProject}.ts`、
> `scripts/compress-models.mjs`）。改动前如与代码不符，以**代码为准**并更新本文。

## 0. 铁律（先读）

- **搭任何空间前，先读 [`design-rubric.md`](./design-rubric.md)**：设计评审 rubric（焦点/
  动线/尺度/留白/光/色/生活感 7 维）+ 各场景参考卡 + 真实尺寸速查。搭之前查参考卡、
  搭之后逐条过 rubric、**看图迭代到无红项**。这是「既理性又有艺术感」的落地办法——
  靠规则+参考+看图闭环，不靠灵感。
- **搭任何场景/模板前，先调研真实参考**（WebSearch 看星巴克等实体案例）→ 对照
  目录列缺口清单 → 缺口补齐或明确替代 → **才写坐标** → **截图迭代校验，不盲摆**。
  凭想象摆出来的是「均匀撒家具」，不是真实动线。（血泪教训，见记忆
  `research-before-scene-building`。）
- **看图闭环不可省**：摆完必须开 preview 真的看（布局用 `viewMode:"all"` 2D 平面，
  观感/光/色用 `"3d"`），按 rubric 挑毛病再改。「摆完即完成」是搭积木，不是设计。
- **所有面向用户的文字用中文。** 只有被明确要求才提交/推送。
- 这不是你熟悉的 Next.js（`AGENTS.md`）：写 Next 代码前读 `node_modules/next/dist/docs/`。

## 1. 数据模型（真实结构）

zustand store（persist key `home-designer-v2`）：

```
store
 ├─ floorPlans: FloorPlan[]          // 每层一个（index 0 = 首层）
 │   └─ FloorPlan {
 │        rooms: Record<RoomType, RoomState>       // RoomState.placedItems 是家具
 │        enabledRooms: RoomType[]                 // 本层启用哪些房间
 │        roomLayout: Record<RoomType,{x,y}>       // 房间左上角(cm，楼层平面)
 │        roomDimensions: Record<RoomType,{width,depth}>  // 房间尺寸(cm)
 │        roomWindows / roomDoors / roomWallsHidden / …   // 门窗/开放式拆墙
 │      }
 ├─ yardPlan: YardPlan               // ★地块级公共资源，顶层独立持有，所有楼栋共享
 ├─ exterior: ExteriorSettings       // 立面/屋顶/颜色/facade 预设
 └─ buildings[] / activeBuilding     // 多栋
```

**RoomState.placedItems**（房间里的一件家具）：
```ts
{ instanceId, furnitureId, x, z, rotation, scaleW, scaleD }
```
- 坐标 = **房间局部中心坐标，单位 cm**；原点 (0,0)=房间**西北角**；**x→东，z→南**；
  `rotation` 单位**度**。
- `furnitureId` 指向 `FURNITURE` 目录里某个 id。

## 2. 家具目录 `src/lib/furniture.ts`

`FURNITURE: FurnitureItem[]`，单行一条：
```ts
{ id, name, brand, price, unit, category, roomTypes, color,
  width, depth, height,   // ★真实世界尺寸 cm
  tags, description, icon,
  model3d?: { url, scale?, rotation?, yOffset?, fit?, recolor? } }
```

**`model3d.fit` 是关键：**
- `fit:"contain"` → 把 GLB **归一化到声明的 width×depth×height**。所以 **GLB 原始单位无所谓**，
  只要把 `width/depth/height` 填成真实 cm 即可。**这是加新道具的默认选择。**
- `rotation`（度）：模型朝向不对时绕 Y 补偿（如面朝墙就 +180）。
- `yOffset`（cm）：模型悬空/入地时上下微调。

**分类无兜底——加新分类要改两处**（否则侧边栏根本不渲染、选不到）：
1. `src/lib/types.ts` 的 `FurnitureCategory` 联合类型加一项；
2. `src/lib/furniture.ts` 的 `FURNITURE_CATEGORIES` 数组加 `{ id, label, icon }`。
（历史坑：楼梯 4 款曾因分类没挂进数组而选不到。）

## 3. 素材（GLB）入库管线

1. **落盘**：每个模型放 `public/models/<子目录>/<name>/<name>.glb`。
   - `<name>` 用 **snake_case，无空格/括号/中文**（如 `cafe_counter`）。
   - 片场道具统一放 `public/models/filmset/`；室内装饰放 `public/models/indoor_decor/`。
2. **策展**：一批下载里**去重复/损坏/超大**（>15MB 谨慎；缺必需 glTF 扩展的直接丢）。
   OBJ/STL/C4D 等非 glb 管线不吃，跳过。
3. **压缩**：`node scripts/compress-models.mjs <子目录>`
   （Draco 网格 + 贴图缩 1k WebP，原地替换；只在更小时替换；典型 45MB→4MB）。
   只压这个子目录，别全量压（慢）。
4. **入目录**：往 `furniture.ts` 加条目，`fit:"contain"` + 真实 cm 尺寸 + 合适 category
   （新分类先按 §2 加两处）。
5. **校验**：`npx tsc --noEmit` → `npx eslint <改动文件>` → 路径存在性脚本 →
   `npx next build` → **浏览器渲染肉眼看朝向/比例/悬空**，逐轮修 rotation/yOffset/尺寸。

> 缺素材时：按 `docs/素材采购清单.md` 的格式列出（名称/建议数量/搜索关键词），
> 交用户下载（Sketchfab 筛 CC / Poly Haven 全 CC0）。用户下载→我入库是既定分工。

## 4. 房间摆家具 / 片场模板

### 直接摆（改某个房间的 placedItems）
局部中心坐标 cm，(0,0)=西北角，x→东，z→南，rotation 度。

### 项目模板 `src/lib/projectTemplates.ts`
`PROJECT_TEMPLATES: ProjectTemplate[]`。一个模板一次设全：
```ts
{ id, name, nameEn, emoji, description, areaSqm, palette,
  exterior: Partial<ExteriorSettings>,
  floorLayouts: FloorplanLayout[],   // 每层的房间布局
  yardPlan,
  styleTemplateId,                    // 铺基础材质+家具（ALL_TEMPLATES 里的 id）
  furnitureOverrides?: Array<Partial<Record<RoomType, TemplatePlacedItem[]>>> }
```
- **`furnitureOverrides`**：每层一个条目，**逐房间整体替换** placedItems。
  非住宅片场（咖啡馆/办公室…）的家具风格模板推不出来，**必须显式声明**；
  缺省的房间仍走 styleTemplate 默认（如卫浴）。
- `TemplatePlacedItem = { furnitureId, x, z, rotation?, scaleW?, scaleD? }`（同上坐标系）。
- 应用顺序（`store.applyProjectTemplate`）：exterior → 房间布局 → styleTemplate 家具
  → **furnitureOverrides 逐房间覆盖**。

### ★垂直摆放（血泪坑）：台面件/吊挂件必须给 elevationY / mountCeiling
`placedItems`/`TemplatePlacedItem` 除 x,z 外还有**垂直**字段，漏了小件全掉地板上：
- **台面小件**（咖啡杯/马克杯/花瓶/咖啡机/收银）→ 给 `elevationY:<台面高cm>`。
  正下方若是 `FLAT_TOP_CARRIERS` 类别（`dining_table/desk/sideboard/nightstand/
  bookshelf/kitchen_cabinet/storage/dresser/tv_unit/bathroom_vanity`）会**自动吸附**贴顶面
  （elevationY 只要落在台顶 ±25cm 内即精确贴合）；**`counter` 类别不是承托面**，
  台面件要**直接给柜台高**（咖啡柜台 110），不吸附、按此高度悬置。
- **吊挂件**（吊灯/吊挂绿萝）→ 给 `mountCeiling:true`（顶贴天花垂下，忽略 elevationY）。
  不给的话吊灯/绿萝会**站在地板上**（绿萝变矮草丛、吊灯变落地怪柱）。
- 常见台面高：cafe-rustic 74 / cafe-marble 55 / 咖啡柜台 110 / 窗边吧台 ~105 / 书桌 75。
- 桌上放 2 件时把 x 各偏 ±12cm 免叠。
- **坑**：`store.applyProjectTemplate` 的 `furnitureOverrides` 落库映射曾**漏透传**
  elevationY/mountCeiling/scaleH（2026-07 修复，store.ts ~2097）——若这些字段又「不生效」，
  先查该映射有没有拷贝这几个字段。
- **坑（吊挂/竖向件调大了还是小）**：`fit:"contain"` 按**最受限轴**等比缩放。若模型
  native 的**最长轴不是你想要的竖直轴**（如吊挂绿萝 native 18.76×20.57×39.86，最长是
  「深度」而非高度→藤蔓水平铺开），contain 会被短轴卡住缩小，且缩后真实高 ≠ 声明高，
  mountCeiling 锚点还留空档→又小又飘。**改 `fit:"fill"`**：非均匀填满声明盒子，真实尺寸
  =声明值、锚点对齐；有机体（植物/织物）轻微拉伸不违和。**先看 `[GltfFurniture]` 的
  native 日志判断长轴朝向**，别盲目加大声明尺寸。

### 真实空间的动线要点（调研沉淀，摆之前默念）
- **咖啡馆**：点单柜台沿**一面长墙一字排开**（柜台→柜台→甜品展示柜），back bar 贴墙
  摆罐/杯/咖啡器具；南玻璃**窗边高脚位**（吧台+吧凳，中间留门）；中部+靠墙**密集桌位**
  （2 人小圆桌，每桌两椅 + 桌面卡布奇诺/小花瓶）；一面**书架墙**；**吊灯成排**压柜台/桌上方；
  门口 A 字黑板/欢迎牌。**别把柜台+设备全堆一角**（会挤成一坨、其余空）。
- 非住宅片场的「厨房」当**后场备货**furnish（操作台+货架），别用住宅橱柜；
  「卫生间」当**小 WC**（坐便+立柱盆+镜），别塞住宅整套卫浴。

## 5. 验证与踩坑

- `window.__store`（仅 dev）：`window.__store.getState()` 读/`setState()` 写，
  快速核对 placedItems 坐标分布，不必等渲染。
- `exterior.debugExposeScene = true` → 场景发布到 `window.__SCENE`，可拿
  `__SCENE.__r3f.root.getState()` 的 `{gl,camera,controls}` 编程截图。
- **截图必须 readPixels**：canvas `preserveDrawingBuffer:false`，`toDataURL` 读到的是
  陈旧缓冲；用 `gl.render()` + `ctx.readPixels()` + 上下翻转才拿到当前帧。
- **预览 harness 偶发把视口压扁成 ~516px 竖条**，宽幅内景截不全——此时以
  `window.__store` 数据层校验兜底，或让用户在真浏览器里看。
- 加载慢/白屏是重型 3D 的固有成本（three.js chunk + 场景构建），非 bug；
  `SceneVeil` 有 12s 兜底防卡死。
