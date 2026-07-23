# 云横咖啡片场（set-cafe）· 设计→落地 问题与踩坑记录

> 记录 2026-07 搭建咖啡馆片场样板间（大堂 / 露天座位区 / 后场 / 男女卫生间）
> 过程中遇到的问题、根因、修复，以及跨电脑接手时的注意事项。
> 全部工作在 **`studio-mvp`** 分支，已推 `origin/studio-mvp`（tip `cf75835`）。

---

## 0. 换电脑 / 重开环境 —— 先看这段（最容易踩）

1. **分支别切走。** 本 worktree 默认分支是 `claude/gracious-cannon-4c0b26`，
   但咖啡馆的活儿全在 **`studio-mvp`**（两者差 1500+ 文件）。
   - 接手第一步：`git checkout studio-mvp`，确认 `git branch --show-current` = `studio-mvp`。
   - 症状：如果 worktree 停在别的分支、dev server 还开着，新旧 `.next` 缓存混在一起 →
     报 `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`
     （Geist 字体解析错）。**这不是字体 bug，是缓存/分支不一致。**
   - 修复：`git checkout studio-mvp` → `rm -rf .next` → 重启 `npm run dev` → `curl -s -o /dev/null -w '%{http_code}' localhost:3000` 应为 200。

2. **字体：本仓已改用系统字体栈**（`layout.tsx` 无 `next/font/google`，只留注释说明）。
   Next 16 默认 Turbopack 解析 `next/font/google`（Geist）有 bug。
   **别把 `Geist()` 引回来**，否则 dev 直接炸。`globals.css` 里 `var(--font-geist-sans)`
   只是无害兜底变量。

3. **本仓不是你熟的 Next.js**（`AGENTS.md`）：改 Next 代码前读
   `node_modules/next/dist/docs/`，留意 breaking changes。

---

## 1. 多边形房间（L型/凸字型）三视图一致性 —— 最大的坑

「编辑轮廓」把房间拉成非矩形后，各视图对多边形的支持并不一致，逐个补齐：

| 问题 | 根因 | 修复 | commit |
|---|---|---|---|
| 外观图不包壳（凸出部分露空、没墙没地板没顶） | `FloorPlanExterior` 全按 `roomLayout+roomDimensions` 的矩形 AABB 算外壳，从不读 `roomShapes` | 新增 `effRect(layout,dims,shape)`=多边形世界包围盒（不小于原矩形），喂给 7 处 footprint 派生点（planOffset/wallSegments/computeExteriorWalls 调用/baseClusters/…）。矩形房间返回原值零影响 | 1d10189 |
| 「编辑轮廓」拖出**负坐标** → 单房间平面图左侧被切、家具错位 | 半数视图假设房间局部坐标 ≥0；`syncDimsAndLayout` 故意不平移多边形/layout（避免历史门跳墙 bug） | `store.normalizeRoomShape`：退出编辑时把多边形平移回正象限 + `roomLayout` 反向补偿 + **家具/门窗偏移同步平移**（N/S 墙 +dx、W/E 墙 +dz，edgeIndex 沿边偏移不动）；两处「完成」按钮自动调用 | 1d10189 |
| 室内（PolygonShell）门/窗位置与外观图**错位** | 外观图 `pos` 从墙**西/北端**量；PolygonShell 从**多边形边的起点顶点**量，边方向反着跑（CCW）时镜像偏移 | PolygonShell 放置处按边的 dx/dz 符号判断，反向时 `startAlongEdge = edgeLen-(pos+len)`，与外观图统一 | 4c1e954 |
| 外观图看不到**外墙装饰**（壁画/店招/门牌） | `FloorPlanExterior` 从不渲染 `RoomState.exteriorDecor` | FPE 新增装饰层，复用效果图同一 `ExteriorDecorItem` 组件；壁画/店招/标识三视图一致 | 4c1e954 |

**⚠️ 已知遗留（未做）**：外观图的多边形是「包围盒兜底」——**凹角不抠形**，
真正往外单独凸一块只会渲成矩形框。要精确抠凹形需把整套幕墙/门窗/墙体改成沿多边形边渲染
（大改，代码里标为 Option A）。当前咖啡馆布局各房间填满矩形，外观是干净矩形，够用。

**概念澄清（用户多次困惑）**：单个**房间**是凸字形 ≠ **整栋楼**是凸字形。
房间凸字的缺口被相邻房间填满时，楼的外轮廓仍是矩形，外观图画矩形是对的。
要楼体真凸出，得让某房间伸到其它房间之外、旁边留空。

---

## 2. 家具比例 / 锚定 / 朝向 —— 反复踩

- **`fit:"contain"` 被最窄轴卡住**：模型等比缩放按最受限轴定比例。宽度调小后
  高度滑块**拉了没用**（双盆岩板浴室柜就这么中招）。解法：`model3d.fit:"fill"`（三轴独立、
  所见即所得）。有机体/柜体轻微拉伸不违和。
- **`fit:"fill"` 一体件别加 Y 旋转**：rotation 触发 swapXZ 交换填充目标轴，把模型**压扁**
  （太阳伞桌椅 `outdoor-patio-set`、咖啡推车 `counter-coffee-cart` 中招）。保持 `rotation:0`。
- **`kitchen_sink` 类自动锚定台面高**（`COUNTER_H - fh*0.35`）：单独落地会**悬浮/比例异常**，
  必须放在柜台/备餐台上。
- **换轴模型（躺着/侧着/细棍）**：竖直轴错→`model3d.preRotX:-90`；水平朝向错（宽面在深度轴、
  contain 被极窄宽度轴卡成细棍）→`model3d.rotation:±90`（借 GltfFurniture 的 swapXZ）。
  **先看 `[GltfFurniture]` 的 native 三轴日志再判断。**
- **自带凳/座的一体件**：`model3d.dropMeshNames` 在加载时按 mesh 名剔除
  （直线吧台 `re_ho_*`=Hocker 凳，剔 `Object_4,Object_18`）。

---

## 3. 垂直摆放（台面件/挂画/吊挂）

- 台面小件给 `elevationY≈台面高`（rustic 74 / 咖啡柜台 110 / 后吧台面 112 / 前岛 118）；
  正下方是 `FLAT_TOP_CARRIERS` 类别会自动吸附贴顶；`counter` 类**不是**承托面，直接给柜台高。
- 吊灯/吊挂绿萝给 `mountCeiling:true`。
- **挂画 `elevationY` 曾写死无效**：`FloorPlanExterior` 里挂画 y 曾硬编码 `墙高×0.52`，
  离地高度滑块对挂画不生效 → 改成「设了 elevationY 用它当挂画中心高，未设才回退默认画廊高」。
- **坑**：`applyProjectTemplate` 的 `furnitureOverrides` 落库映射曾漏透传
  `elevationY/mountCeiling/scaleH/label`（store.ts ~2097）——若这些字段「不生效」先查这里。

---

## 4. 门 / 立面（幕墙 vs 实墙）

- **`french_double` 在本渲染器是整扇单铰**（160cm 一整片甩到一边）。要两扇对开用 **`glass_swing`**
  （各绕外侧边反向对开）；推拉用 `glass_slide`。
- **立面按房间性质分配（铁律）**：卫生间/厨房库房=**实墙**（`concrete`），临街大堂=**玻璃幕墙**
  （`glass`），走廊露天=四墙隐藏。别让隐私/后场房间是玻璃。
- 店招走**外墙装饰**（`sign-cafe-wall`，`RoomState.exteriorDecor`）当**单一数据源**——
  效果图/外观图共用渲染，别再用走廊里的家具灯箱（会在单房间视图缺失、位置难对）。

---

## 5. 模板机制扩展（`projectTemplates` / `floorplanLayouts` / `store`）

为把上面的东西固化进 `set-cafe`，给模板系统加了能力（原来声明了也不生效）：

- `LayoutTemplateRoom` 新增：
  - `shape`（多边形轮廓，`RoomShape`）
  - `wallsHidden`（开放式/骑楼隐藏墙）
  - `exteriorStyle`（`glass`/`concrete`/`auto`）
  - `doors`（显式门，如临街加宽双开）
  - `wallDecor`（外墙装饰=店招/壁画/标识 → 写进 `RoomState.exteriorDecor`）
- `store.applyProjectTemplate`：新增 step 3.5，在 **styleTemplate 之后**应用
  `exteriorStyle/doors/wallDecor`（不被默认门窗覆盖）；房间布局阶段应用 `shape/wallsHidden`。
- `ExteriorWallDecorItem` 新增 `label`（店招可改字）。

**新增目录项**：`partition-stall`（卫生间隔断板，无模型按色盒渲染）、
`sign-cafe-wall`（外墙店招灯箱，label 可改）、`decor-bin-black`（黑桶，`model3d.recolor` 染黑——
注意 recolor 只吃 catalog 层，单件 `placed.color` 不影响 GLB）。

---

## 6. set-cafe 现状（cf75835）· 四空间家具数

| 房间 | 件数 | 内容要点 |
|---|---|---|
| 大堂 living（凸字形 1179×592，13 点多边形） | 118 | 北墙三层服务区（后吧展示墙×2 + 高挂菜单×3 + 后工作台咖啡设备 + 前岛木吧台收银+甜品柜 L 线，中留吧员通道）；5 张四人桌 + 桌面盆花咖啡；6 幅挂画；南墙 160cm `glass_swing` 大门 + 门楣店招；东北洗手走廊双盆岩板柜 |
| 走廊 hallway（1200×180，四墙隐藏=骑楼露台） | 11 | 4 组太阳伞桌椅 + 咖啡推车 + 菜单黑板 + 欢迎牌 + 黑桶 + 橡皮树×3 |
| 厨房 kitchen（280×260，实墙后场） | 9 | 冷藏区（单门冰箱+饮料柜+嵌台面双槽水槽）+ 备餐台 + 西墙干货架×2 + 门口垃圾桶 |
| 女厕 bathroom（95×150，门朝走廊+「女」标识） | 2 | 坐便 + 垃圾桶 |
| 男厕 bathroom2（80×150，门朝走廊+「男」标识） | 2 | 坐便 + 垃圾桶 |

搭之前先读 `.claude/skills/zhuya-scene-authoring/`（坐标系、垂直摆放、换轴、模板落库映射）。

---

## 7. 提交索引（`origin/studio-mvp`）

- `5bcf861` 直线吧台剔第二簇自带凳
- `f0bfd87` 客厅 5 四人桌 + 走廊露台按实景固化
- `1d10189` 多边形修复：外观图包壳(effRect) + 轮廓编辑负坐标规范化
- `a209329` 模板支持房间多边形 + 隐藏墙
- `4c1e954` 后场/卫生间成型 + 多边形三视图一致 + 店招体系
- `db89982`/`8fa22c4` 按用户手调同步
- `cf75835` 服务区三层重构（后吧展示墙+工作台+前岛收银线）
