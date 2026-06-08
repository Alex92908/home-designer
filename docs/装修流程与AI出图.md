# 装修流程与 AI 出图说明

本文档说明本项目「一条龙」装修流程的各站路径，以及接入的 AI 出图管线（基于
ComfyUI / RunningHub 云端，素材包共 46 个工作流）。

> 设计原则：**不锁死任何服务商**。出图后端抽象成通用 provider（本地 ComfyUI /
> RunningHub 云 / 自建 ComfyUI HTTP），工作流可自由增删；密钥只存浏览器本地
> （BYOK），经本站 `/api/airender` 代理转发，不落服务端。

---

## 一、主干「一条龙」路径

```
图纸/参考图 → 平面图(2d) → 效果图(3d) → 全屋布局(all) → 全局3D(global3d) → 外观(exterior) → 院子(yard2d)
```

| 阶段 | 应用视图(ViewMode) | 干什么 | AI 出图入口（⚡ 默认工作流） |
|---|---|---|---|
| 图纸生成 | —（导入参考图 / 蓝图底图） | 导入参考图、蓝图描底 | 文生图 / 线稿出图 |
| 全屋布局 | `all` 全局 | 俯视全屋摆放 | **⚡ 一键全屋彩平图**（平面图出彩屏方案） |
| 平面图 | `2d` 平面图 | 排房间、墙、窗 | **⚡ 一键平面图→效果图**（平面图出效果图） |
| 效果图 | `3d` 效果图 | 单房间精装、家具 | **⚡ 一键效果图渲染**（香蕉白膜渲染） |
| 全局 3D | `global3d` | 整栋立体预览 | **⚡ 一键全局3D渲染**（香蕉白膜渲染） |
| 院子 | `yard2d` 院子图 | 院子分区、景观 | **⚡ 一键院子→效果图**（彩屏工作流） |
| 外观 | `exterior` 外观 | 外立面、漫游 | **⚡ 一键外观→效果图**（外立面出效果图） |

---

## 二、AI 出图的三种触发方式

1. **视图内一键直达**（最快）：主画布右下角 ⚡ 按钮，随当前视图自动选工作流 →
   截图 → 出图 → 弹结果图。**六站全覆盖**（每站都有默认推荐工作流）。

   | 视图 | 按钮 | 默认工作流（云端） |
   |---|---|---|
   | `all` 全局 | ⚡ 一键全屋彩平图 | `平面图出彩屏方案` |
   | `2d` 平面图 | ⚡ 一键平面图→效果图 | `平面图出效果图` |
   | `3d` 效果图 | ⚡ 一键效果图渲染 | `香蕉白膜渲染` |
   | `global3d` 全局3D | ⚡ 一键全局3D渲染 | `香蕉白膜渲染` |
   | `yard2d` 院子图 | ⚡ 一键院子→效果图 | `彩屏工作流` |
   | `exterior` 外观 | ⚡ 一键外观→效果图 | `外立面出效果图` |

   第一次点会自动把该工作流导入到设置列表（之后复用，可在设置里微调）。

2. **🎨 AI 出图下拉**（外观面板内）：列出你已配置的全部工作流，手动挑任意一条跑。

3. **⚙️ 设置面板**：管理「工作流 / 素材包 / 后端」，是所有工作流的总开关。

---

## 三、素材包全部工作流（46 个）

按分类（来自 `4月21日-配套素材`，已打包进 `public/workflow-presets/`）：

| 分类 | 用途 | 代表工作流 | 云/本地 |
|---|---|---|---|
| 文生图 | 文字 → 出图 | `香蕉文生图` / `flux2文生图` | 云 / 本地 |
| 线稿出图 | 线稿/CAD → 室内效果 | `线稿出效果图工作流` | 本地 |
| 平面图系 | 平面图 → 效果/彩屏/立面刨面/优化 | `平面图出效果图`、`立面刨面结构图` | 云 |
| 毛坯出图 | 毛坯实拍 → 精装效果 | `毛坯出效果图工作流` | 本地/云 |
| 白膜出效果图 / 白膜渲染 | 白模 → 真实渲染 | `香蕉白膜渲染`、`单角度白膜出效果图` | 云/本地 |
| 户外外立面 | 外立面 + 院子效果图 | `外立面出效果图`、`彩屏工作流` | 云 |
| 改图重绘 / 编辑 | 局部重绘、指定修改 | `香蕉单图编辑2`、`局部重绘手动指定` | 云/本地 |
| 修复放大 | 放大、洗图 | `放大工作流`、`洗图工作流` | 本地 |
| 角度调整 | 换视角 | `角度调整工作流` | 本地 |
| 360 全景 | 全景图 | `香蕉-360全景图` | 云 |
| 产品/柜体/展板设计 | 软装、定制柜、展陈 | `香蕉-柜体设计`、`香蕉产品模仿精修` | 云/本地 |
| 单体建模 | 3D 建模/贴图 | `建模`、`贴图制作` | 本地 |

统计：**云端 23 + 本地 23**。

---

## 四、两类后端（通用，可自由增删）

| 后端类型(kind) | 默认地址 | 鉴权 | 说明 |
|---|---|---|---|
| `comfyui-local` 本地 ComfyUI | `http://localhost:8188` | 无 | 最直接，需本地装好模型 |
| `comfyui-http` 自建/第三方 ComfyUI | 自填 baseUrl | 可选 key | 任意远程 ComfyUI |
| `runninghub` RunningHub 云 | `https://www.runninghub.ai` | API Key | 云端 Gemini/香蕉，无需本地模型 |

- **云端工作流**：用 `workflowId`（在 runninghub.ai 导入对应 JSON 后获得）。
- **本地工作流**：用内嵌的 ComfyUI 工作流 JSON。素材包是「UI 图」格式，提交时
  代理会用目标 ComfyUI 的 `/object_info` **即时转成「API」格式**，无需手动转换。

---

## 五、典型一条龙操作（云端最快上手）

1. ⚙️ → **后端**：填 RunningHub API Key。
2. ⚙️ → **素材包**：「全部导入」；对要用的云端工作流点「复制JSON」→ 到
   runninghub.ai 导入 → 把拿到的 `workflowId` 回填到「工作流」标签对应那条。
3. **平面图**视图点 ⚡ → 平面效果图；切 **3D** 点 ⚡ → 室内效果图；切 **外观**
   点 ⚡ → 外立面+院子效果图。
4. 需要细化时用 🎨 下拉挑「改图重绘 / 放大 / 换角度」继续精修。

> 本地路线：⚙️→后端用本地 ComfyUI（开着 `localhost:8188`），素材包里本地工作流
> 导入后直接可跑（前提：本地已装对应模型，如 flux-2-klein 等）。

---

## 六、代码结构（文件地图）

| 文件 | 职责 |
|---|---|
| `src/lib/aiRenderConfig.ts` | 后端/工作流配置（localStorage）+ 预设→工作流 helper |
| `src/lib/workflowPresets.ts` | 46 个素材包工作流元数据目录（自动生成） |
| `public/workflow-presets/*.json` | 各工作流原始 ComfyUI JSON（按需 fetch） |
| `src/lib/comfyGraphConvert.ts` | ComfyUI「UI 图」→「API prompt」转换（用 object_info） |
| `src/lib/useAiRender.ts` | 客户端编排：上传→提交→轮询→取图 |
| `src/app/api/airender/route.ts` | 通用出图代理（分派 ComfyUI / RunningHub） |
| `src/components/AiRenderSettingsModal.tsx` | 设置面板（工作流/素材包/后端三标签） |
| `src/components/CloudRenderButton.tsx` | 🎨 AI 出图下拉（外观面板内） |
| `src/components/QuickRenderButton.tsx` | 视图内 ⚡ 一键直达（主画布右下角） |

数据流：

```
视图 ⚡/🎨 → useAiRender → POST /api/airender
   ├─ comfyui：/upload/image → (UI→API 转换) → /prompt → /history 轮询 → /view 取图
   └─ runninghub：/task/openapi/upload → create → status → outputs
```

---

## 七、排错

| 现象 | 原因 / 处理 |
|---|---|
| `missing_api_key` | RunningHub 后端没填 API Key（⚙️→后端） |
| 工作流缺 `workflowId` | 云端工作流要先去 runninghub.ai 导入 JSON 拿 ID |
| `object_info_failed` | 本地 ComfyUI 没启动 / baseUrl 不对 |
| `convert_failed`（缺节点定义） | 目标 ComfyUI 未安装该工作流用到的自定义节点 |
| 出图一直 RUNNING 超时 | 云端排队中，稍后重试；或检查模型是否就位 |

> 密钥与配置仅存浏览器 `localStorage`（键 `home-designer-airender`），换设备需重填。
