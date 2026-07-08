# 控制包 → 本地 Wan/ComfyUI 对接指南（M4-A dogfood）

> 目标：把 🎬「出短片」导出的控制包，喂进你自己的 ComfyUI（5090 + Wan），
> 验证「浏览器 previz → AI 成片」全链路。零 API 费用。
>
> 注意：ComfyUI/Wan 生态节点名随版本变化快，本指南写**工作流形状**而非
> 具体节点连线；具体模板请以 ComfyUI 官方自带的 Wan 模板为准
> （Load Template → Video 类目），把下面的输入映射进去即可。

## 控制包里有什么

一次「拍摄全部」（N 镜 × 选中风格）产出：

| 文件 | 用途 |
|---|---|
| `zhuya_<批次>_01-orbit.mp4` | 实景参考视频（相机轨迹的最强描述） |
| `zhuya_<批次>_01-orbit_first.png` / `_last.png` | 首/尾帧（I2V / 首尾帧模式输入） |
| `..._01-orbit_clay.mp4` + 首尾帧 | 白模灰盒版（只锁空间构图运动） |
| `..._01-orbit_depth.mp4` + 首尾帧 | 深度序列（近白远黑，结构控制输入） |
| `zhuya_<批次>_storyboard.json` | 每镜元数据：预设/时长/提示词/文件映射 + 场景尺寸 + 演员走位 |

录制固定 30fps；时长按每镜设置（2-15s）。

## 三条由浅入深的用法

### 用法一：Wan I2V（图生视频）——最快出第一支片

只用 `_first.png` + 每镜提示词（storyboard.json 里的 `prompt`）：

```
LoadImage(01-orbit_first.png)
  → Wan 2.2 I2V 官方模板（ComfyUI 自带）
  → prompt = storyboard.json 里该镜的 prompt
    （建议附加相机描述，如「camera slowly orbits the villa」——
     预设名即运动语义：orbit=环绕 / dolly-in=推近 / crane-up=升起）
  → 时长/帧数对齐该镜 duration（如 4s × 16fps 模型帧率 = 65 帧档）
```

局限：I2V 只有首帧 + 文字，相机轨迹靠 prompt 碰运气——这正是后面
两条用法存在的理由，也是对照组（你能直观看到控制的价值差）。

### 用法二：首尾帧模式——锁住起止构图

用 `_first.png` + `_last.png` 喂支持首尾帧（FLF / start-end frame）的
工作流（Wan 有 FLF2V 变体；云端即梦/Kling 也是此模式）。
中间运动由模型脑补，但起止机位被钉死，多镜拼接时空间感稳得多。

### 用法三：VACE 深度控制——完整复刻相机轨迹（核心玩法）

用 `_depth.mp4`（或 `_clay.mp4` 过 depth 预处理器）做结构控制：

```
LoadVideo(01-orbit_depth.mp4) → 拆帧
  → Wan VACE（depth control）官方/社区模板
  → 参考图 = _first.png（或你想要的风格图）
  → prompt = 该镜 prompt
```

要点：
- 我们的深度是**近白远黑**（MiDaS 习惯）。若你的 VACE 工作流期望反向，
  加一个 Invert Image 节点即可。
- 帧数对齐：30fps × duration 秒 = 总帧数；VACE 输入帧数超模型上限时
  用抽帧节点降到模型帧率（如每 2 帧取 1 → 15fps）。
- 演员走位的方块人在深度/白模里都在——生成时在 prompt 里描述这个人
  是谁（"a man in casual wear walking towards the pool"），模型会把
  胶囊人"上色"成真人。这就是走位进 previz 的意义。

### 模型文件提醒（据你 ComfyUI 现状）

- 你已有：Wan 2.2 I2V 双模型、umt5_xxl 文本编码器、wan_2.1_vae
- 跑 VACE 需补：`wan2.1_vace_14B`（或 wan2.2_fun_vace）主模型一个文件，
  编码器/VAE 直接复用已有的

## 验收标准（dogfood 成功的定义）

1. 用法一出片：任意一镜 I2V 能生成 → 链路通
2. 用法三出片：VACE 深度控制下，成片的**相机运动与我们的参考视频一致**
   （环绕就是环绕、推近就是推近）→ 核心价值成立
3. 两镜拼接：01 环绕 + 02 推近 拼在一起，场景一致性可接受 → 分镜成立

把三条的结果（尤其失败样例）带回来，直接决定 M4-B/M5 怎么做。

## 下一步（M4-A 产品化，验证后再做）

Dogfood 通过后，把这条链做进产品：「连接我的 ComfyUI」——
用户填自己 ComfyUI 地址（需 --enable-cors-header）+ 上传自己导出的
API 格式工作流模板（含 {{FIRST_FRAME}}/{{PROMPT}}/{{DEPTH_VIDEO}} 占位），
我们逐镜填参提交 /prompt、轮询 /history、成片回填分镜列表。
模板由用户提供而非我们硬编码——节点生态变化快，硬编码必坏。
