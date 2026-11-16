# 导演台新场景 · 3D 资产说明 (Scene Assets)

- **日期：** 2026-11-16
- **范围：** 12 个新片场（set-villa-suburban / set-school / set-hospital /
  set-qinhan / set-weijin / set-yuan / set-banpo / set-hemudu /
  set-rural-republican / set-versailles / set-washitsu / set-hanok）

## 结论先行：零外部下载，全部程序化 + 复用现有目录

本次 12 个场景的时代家具**没有下载任何外部 3D 模型**。原因：

1. 程序化是既定第一优先级（可靠、零许可风险、离线可用、体积零增长）；
2. Sketchfab / NVIDIA 开源资产对这批器物（汉榻/案/几、胡床、蒙古包、
   干栏屋、半地穴屋、博古架、榻榻米/床の間、温突地板）没有尺寸、风格、
   许可证三者都合用的现成模型；逐个谈许可证与格式转换的成本远高于
   程序化建模，且会引入二进制体积与来源维护负担；
3. 其余家具全部复用仓库已有 587 件目录（GLB 模型已在仓库内）。

因此本文件无“外部模型许可证 + 来源 URL”条目——不是遗漏，是本次
刻意为零。如未来某件确实需要外部模型，再按“CC0 / CC-BY / MIT /
NVIDIA 开源许可才可用，许可证 + 来源 URL 随模型登记”的规则补登记。

参考图包见 `docs/scene-references.md`（图片均为链接引用，不入库；
只有明确标注公有领域 / CC0 的文件才可下载进仓库）。

## 程序化家具一览（46 件，id 以 `proc-` 开头）

几何：`src/lib/proceduralFurniture.ts`（纯 three.js，无 JSX，可被
node harness 直接验证）；目录登记：`src/lib/furniture.ts`（无
`model3d`，走程序化分支）；渲染分流：`src/components/RoomCanvas.tsx`
`FurnitureMesh` 顶部按 `proc-` 前缀分流到
`src/components/ProceduralFurnitureMesh.tsx`。

| id | 名称 | 用在 | 类别（只为复用承托面/爬升语义） |
|---|---|---|---|
| proc-han-ta | 汉榻（低足榻，足 17–19cm） | 秦汉、魏晋（加高）、元宫殿 | bed |
| proc-han-an | 汉案（低案，12–14cm） | 秦汉、魏晋 | dining_table（承托面） |
| proc-han-ji | 汉几（凭几） | 秦汉、魏晋、民国农村（当小桌复用） | coffee_table（承托面） |
| proc-boshanlu | 博山炉 | 秦汉 | decor |
| proc-lacquer-bowl | 漆碗（黑胎朱口） | 秦汉、魏晋、河姆渡（当漆木碗） | decor |
| proc-huchuang | 胡床（折叠凳） | 魏晋 | dining_chair |
| proc-wood-stool | 木凳 | 魏晋、元、民国农村、别墅茶室/酒窖 | dining_chair |
| proc-celadon-vase | 越窑青瓷瓶 | 魏晋 | decor |
| proc-buddha-statue | 铜佛像（坐姿） | 魏晋（佛龛内置另有小佛） | decor |
| proc-shrine-niche | 佛龛 | 魏晋、元 | storage |
| proc-cross | 十字架 | 元（与佛龛共存） | decor |
| proc-yurt | 蒙古包（斡耳朵，圆毡帐+中柱+天窗圈） | 元 | outdoor_structure |
| proc-bluewhite-vase | 青花瓷瓶（元，高端器物） | 元宫殿 | decor |
| proc-banpo-pot | 半坡彩陶罐 | 半坡 | decor |
| proc-banpo-firepit | 半坡火塘（唯一光源） | 半坡 | decor |
| proc-earth-platform | 土台 | 半坡 | storage |
| proc-banpo-house | 半坡半地穴屋 | 半坡 | outdoor_structure |
| proc-hemudu-pot | 河姆渡黑陶釜 | 河姆渡 | decor |
| proc-hemudu-stilt | 河姆渡干栏长屋（23m） | 河姆渡 | outdoor_structure |
| proc-kang | 火炕 | 民国农村 | bed |
| proc-oil-lamp | 豆油灯 | 民国农村 | decor |
| proc-kerosene-lamp | 煤油灯（1920s+） | 民国农村 | decor |
| proc-wood-chest | 木箱 | 民国农村、元、韩屋 | storage |
| proc-millet-sheaf | 粟束（小米） | 半坡 | decor |
| proc-rice-sheaf | 稻束 | 河姆渡 | decor |
| proc-bogujia | 博古架（多宝格） | 别墅茶室 | bookshelf（承托面） |
| proc-school-desk | 课桌椅 | 学校 | desk |
| proc-blackboard | 黑板 | 学校（前/后黑板） | decor |
| proc-school-broom | 扫帚 | 学校 | decor |
| proc-hospital-bed | 病床（护栏+可调床头） | 医院 | bed |
| proc-iv-stand | 输液架 | 医院 | decor |
| proc-med-strip | 床头设备带（呼叫按钮） | 医院 | decor |
| proc-camp-chair | 陪护折叠椅 | 医院 | dining_chair |
| proc-thermos | 保温壶 | 医院 | decor |
| proc-basin | 脸盆 | 医院、韩屋厨房 | decor |
| proc-mirror-wall | 镜墙 | 凡尔赛 | decor |
| proc-chandelier-crystal | 水晶吊灯 | 凡尔赛 | lamp |
| proc-gilt-chair | 鎏金扶手椅 | 凡尔赛 | dining_chair |
| proc-tatami | 榻榻米（一帖 180×90cm） | 和室、茶室 | rug |
| proc-tokonoma | 床の間 | 和室 | decor |
| proc-shoji | 障子拉门 | 和室、韩屋（当纸门） | decor |
| proc-floor-cushion | 坐垫 | 和室、韩屋 | decor |
| proc-futon | 被褥（折叠） | 和室茶室 | bed |
| proc-ondol-table | 韩屋小桌 | 韩屋 | coffee_table（承托面） |
| proc-ondol-floor | 温突地板 | 韩屋温突房 | rug |
| proc-hanok-stove | 韩屋灶口 | 韩屋厨房 | kitchen_cabinet（承托面） |

## 被程序化件取代的旧 stand-in（上一批 6 场景留下的）

上一批场景为赶工用了下列拼搭，本次新场景不再用它们；**旧 10 个场景
本身本次未动**（任务范围只含新 12 场景），以下只说明“新场景里
谁取代了谁”，供以后回填旧场景时参考：

- 案 = 胡桃长柜（tvunit-walnut）→ `proc-han-an`（真 12–14cm 低案）
- 交椅/圈椅 = 单人扶手椅（sofa-armchair）→ `proc-huchuang` /
  `proc-wood-stool`（魏晋）；明代厅堂的交椅/圈椅仍是旧拼搭，未动
- 架子床 = 原木床（bed-wood-nordic）→ `proc-han-ta`（低足榻）
- 神龛 = 边柜 + 供品（sideboard-walnut + 瓶/果盘）→ `proc-shrine-niche`
- 火炕 = 榻榻米矮床横放（bed-tatami）→ `proc-kang`（真砖砌炕体）
- 博古架：旧场景无；别墅茶室直接用 `proc-bogujia`，不用开放式置物架拼搭

## 未能表示的件（省略或用中性替代，已在模板注释中说明）

- 学校：标语、课程表、黑板报——无对应 3D 文字件，未做（不在模板里）。
- 魏晋：麈尾/羽扇/如意（手持小件，片场尺度下不可见）——未做。
- 河姆渡：骨耜、双鸟朝阳象牙雕、猪纹钵——未做（只有黑陶釜 + 漆碗）。
- 秦汉：漆器纹样只做到黑胎朱口，未做具体纹饰。
- 凡尔赛：镜厅只做 5 面镜墙 + 南墙 3 窗示意“窗镜成对”，未复刻 17 对；
  天顶画未做（无对应画件）。
- 和室：榻榻米颜色与障子透光以文字描述 + 程序化近似为准（参考包缺口）。

## 时代锁自查（每场景模板注释中亦有说明）

- 秦汉：无椅凳高桌、无青花/玻璃/紫砂、无辣椒土豆玉米；不建阿房宫。
- 魏晋：不摆满明式高家具；正式场合席地而坐。
- 元：蒙古包内无床、无雕花大床、无博古架；无明式素面黄花梨。
- 半坡：无家具、无稻、无砖瓦金属瓷器；不与河姆渡混用。
- 河姆渡：无粟、无半地穴屋；不与半坡混用。
- 民国农村：无电灯、无留声机/电话/电风扇、无冰箱。
- 凡尔赛：无现代卫生间/马桶/浴缸。
- 和室：床の間不放物不坐人、不穿鞋上榻榻米、不做固定西式床。
- 韩屋：院子留空（模板里就是 `[]`）、不用中式假山石。
