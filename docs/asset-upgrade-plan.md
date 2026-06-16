# 3D 资产升级清单（把丑的程序化件换成真实模型）

现状盘点（2026-06）：
- 家具 71 件，**43 件已是真实 GLB**，**32 件仍是程序化盒子**（=丑的重点）。
- 厨房/卫浴**核心件大都已 GLB**（橱柜/水槽/油烟机/冰箱/马桶/浴缸/单盆浴室柜/封闭淋浴 ✅）。
- 院子 prefab（泳池/社交岛/门廊/格栅/篱笆/停车/户外厨房/喷泉等）**全是手搓几何**。
- 外墙/立面是**程序化 ConcreteFacade + 盒子墙片**。

现有 GLB 管线 = **Poly Haven（CC0, PBR）** 风格，目录结构：
`public/models/<分类>/<模型名>/<模型名>.glb`，再在 `src/lib/furniture.ts` 该件上加
`model3d: { url: "/models/..." }`。已有 Draco 压缩脚本（`scripts/`）。

---

## 资源来源（全部免费可商用 / CC0，优先级从高到低）
1. **Poly Haven** — polyhaven.com/models ｜ CC0、PBR、质量高，**和现有件同源，首选**。有沙发/桌椅/灯/床/书桌/部分绿植。
2. **Poly Pizza** — poly.pizza ｜ CC0、海量、含绿植/小物/家具（偏 low-poly 但干净）。
3. **Quaternius** — quaternius.com ｜ CC0 整包（家具包、自然包）。
4. **Kenney** — kenney.nl/assets ｜ CC0，已用其 nature 包；有 Furniture Kit。
5. **Sketchfab** — 搜索时勾选 **Downloadable + CC0/CC-BY**；找特定件最强（泳池、廊架、特定绿植）。
6. **ambientCG** — ambientcg.com ｜ CC0 贴图（升级地毯/外墙/地面材质用）。
7. 兜底：用 App 自带 **AI 文生3D / 图生3D**（Meshy/Hunyuan）生成，再 `导入模型`。

> 替换流程：下载 .glb → 跑项目里的压缩脚本 → 放 `public/models/<cat>/<name>/<name>.glb`
> → 我帮你在 `furniture.ts` 把对应件加上 `model3d.url`（文件就位后我来接线）。
> 或：直接用 App 里「**导入模型**」拖进去（只读部署退 IndexedDB）。

---

## P0 · 营销 demo 里最显眼（优先换，泳池别墅录屏都会拍到）

### 客厅
- [ ] `tvunit-float-white` 悬浮电视柜（白）— Poly Haven「TV / media unit」
- [ ] `tvunit-black-stone` 黑岩板电视柜 — 同上
- [ ] `lamp-arc-gold` 北欧弓形落地灯 — Poly Haven「floor lamp / arc lamp」
- [ ] `lamp-industrial-black` 工业落地灯 — 同上
- [ ] `plant-monstera` 龟背竹 / `plant-rubber-tree` 橡皮树 / `plant-sansevieria` 虎皮兰 / `plant-balcony-pot` — Poly Haven「potted plant / monstera」或 Poly Pizza「plant」（绿植程序化最假，换 GLB 收益最大）
- [ ] `rug-nordic-geo` / `rug-modern-gray` / `rug-persian` — 地毯是平面，**换高清贴图即可**（ambientCG「rug / carpet」）

### 餐厅
- [ ] `dining-black-metal` 黑岩板餐桌 — Poly Haven「dining table」
- [ ] `chair-modern-gray` 现代餐椅 / `chair-industrial-black` 铁艺餐椅 — Poly Haven「dining chair」（默认 demo 摆了 6 把，最显眼）

### 卧室
- [ ] `bed-wood-nordic` 北欧原木床 / `bed-single-white` 单人床 — Poly Haven「bed」
- [ ] `dresser-nordic-white` 梳妆台 / `wardrobe-open-rack` 开放衣帽架 — Poly Haven / Poly Pizza

### 院子（外景，外观图必拍）
- [ ] `pool` 泳池 — Sketchfab CC0「swimming pool」；或保留手搓但升级水面材质+瓷砖贴图
- [ ] `social_island` 社交岛 / `outdoor_kitchen` 户外厨房 — Sketchfab CC0「outdoor kitchen / bbq island」
- [ ] `porte_cochere` 门廊 / `pergola_classic` 廊架 / `slat_wall` 木格栅 — Sketchfab CC0「pergola / wood slat screen」
- [ ] `fountain` 喷泉 — Poly Haven / Sketchfab「fountain」

### 外墙 / 立面
- [ ] ConcreteFacade 程序化立面 — **优先换贴图**（ambientCG「plaster / stucco / concrete wall」做外墙 PBR），几何保持但材质真实化收益最高。

## P1 · 次要（室内细节）
- [ ] `desk-nordic-oak` / `desk-standing` 书桌 — Poly Haven「desk」
- [ ] `chair-ergonomic` 人体工学椅 — Poly Haven「office chair」
- [ ] `closet-system-white` / `closet-island-white` 衣帽间系统 — Poly Haven / 手搓升级
- [ ] `vanity-double-marble` 双盆浴室柜 / `shower-walkin` 无框淋浴 — Poly Haven「vanity / shower」
- [ ] `sofa-japanese` 榻榻米沙发 / `sofa-modular-green` 模块沙发 — Poly Haven「sofa」

## 不用动（已 GLB / 本就是平面）
- 厨房核心：橱柜/水槽/油烟机/冰箱 ✅
- 卫浴核心：马桶/浴缸/单盆浴室柜/封闭淋浴 ✅
- 客厅：3 款沙发主力 / 茶几 / 书架 / 边柜 ✅
- 挂画 `artwork-*`：本就是贴图平面（画作），正常。

---

## 建议执行顺序
1. **先换绿植 + 餐桌椅 + 电视柜 + 落地灯**（室内最假、demo 必拍、Poly Haven 都有现成）。
2. **外墙 + 地毯换 PBR 贴图**（不用建模，改贴图，性价比极高）。
3. **院子泳池/廊架/户外厨房**找 Sketchfab CC0（外观图门面）。
4. 其余 P1 慢慢补。

> 你下载好任意一批 .glb 丢进 `public/models/` 后告诉我，我批量在 `furniture.ts` 接好 `model3d.url` + 验证渲染。也可以指定先做哪几件，我列出**精确的 Poly Haven 链接/搜索词**给你逐个下。
