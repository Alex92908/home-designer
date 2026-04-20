# ControlNet + img2img 写实渲染方案

> 目标：用 Three.js 3D截图作为骨架，通过 ControlNet 深度图控制空间结构，SD img2img 重绘真实材质，实现接近酷家乐质量的效果图。

---

## 整体流程

```
Three.js 3D场景
      ↓
① 导出截图（RGB）+ 深度图（Depth Buffer）
      ↓
② ComfyUI：img2img + ControlNet Depth
      ↓
③ 输出写实效果图
```

---

## 第一步：Three.js 导出深度图

在 `src/components/RoomCanvas.tsx` 和 `HouseCanvas.tsx` 中添加深度图导出功能。

### 原理
Three.js 的 WebGLRenderer 内置深度缓冲（depth buffer），可以直接读取并导出为灰度图。距离相机近的像素偏白，远的偏黑。

### 关键代码（约30行）

```typescript
// 在 Canvas 上添加 preserveDrawingBuffer: true（已完成）
// 新增一个导出深度图的函数

function exportDepthMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const width  = renderer.domElement.width;
  const height = renderer.domElement.height;

  // 创建深度材质
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.depthPacking = THREE.RGBADepthPacking;

  // 覆盖所有物体材质为深度材质
  scene.overrideMaterial = depthMaterial;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;

  // 读取像素
  const buffer = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(
    renderer.getRenderTarget()!,
    0, 0, width, height, buffer
  );

  // 归一化到 0-255 灰度图
  // ... 导出为 PNG dataURL

  // 恢复正常渲染
  renderer.render(scene, camera);
}
```

### 注意
- 深度值需要做**线性化处理**（透视相机的深度是非线性的）
- 导出前需要将深度图**归一化**到 0-1 范围，否则 ControlNet 读不准
- 建议分辨率与截图一致（1024×1024）

---

## 第二步：准备 ComfyUI 环境

### 安装 ComfyUI-Manager（管理插件）

```bash
cd /Users/alexmbp/Documents/ComfyUI/custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager.git
# 重启 ComfyUI 后在界面里安装 ControlNet 节点
```

### 下载 ControlNet 深度模型

```bash
# SDXL 版本（配合 RealVisXL 使用）
hf download diffusers/controlnet-depth-sdxl-1.0 \
  diffusion_pytorch_model.fp16.safetensors \
  --local-dir /Users/alexmbp/Documents/ComfyUI/models/controlnet

# 或 SD1.5 版本（更轻量，速度更快）
wget -O /Users/alexmbp/Documents/ComfyUI/models/controlnet/control_v11f1p_sd15_depth.pth \
  "https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1p_sd15_depth.pth"
```

---

## 第三步：ComfyUI 工作流设计

### 节点结构

```
[LoadImage: Three.js截图] ──→ [VAEEncode] ──────────────→ [KSampler] → [VAEDecode] → [SaveImage]
                                                               ↑
[LoadImage: 深度图] ──→ [ControlNetApply] ─────────────────────┤
                              ↑                                │
                    [ControlNetLoader]            [CLIPTextEncode: 正向提示词]
                                                               │
                                                 [CLIPTextEncode: 反向提示词]
```

### 关键参数

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| denoise strength | 0.55 ~ 0.70 | 低=保原图，高=重绘多 |
| ControlNet strength | 0.8 ~ 1.0 | 深度图控制强度 |
| CFG Scale | 7 ~ 8 | 提示词遵循程度 |
| Steps | 25 ~ 30 | 推理步数 |
| Sampler | DPM++ 2M Karras | 写实效果最佳 |

---

## 第四步：代码改动清单

### home-designer 项目需要修改的文件

**`src/components/RoomCanvas.tsx`**
- [ ] 添加 `exportDepthMap()` 函数
- [ ] 在 `AiRenderModal` 触发时同时导出 RGB截图 + 深度图

**`src/components/HouseCanvas.tsx`**
- [ ] 同上，支持外观视图的深度图导出

**`src/components/AiRenderModal.tsx`**
- [ ] 增加"深度图辅助"开关
- [ ] 启用后同时上传 RGB + 深度图到 `/api/render`

**`src/app/api/render/route.ts`**
- [ ] 支持接收深度图参数
- [ ] 调用本地 ComfyUI API（`http://localhost:8188/prompt`）而不是 DALL-E

**`src/lib/roomPrompt.ts`**
- [ ] 生成 img2img + ControlNet 的 ComfyUI workflow JSON
- [ ] 替换现有的纯 txt2img workflow

### 新增文件

**`src/app/api/comfyui/route.ts`**
- ComfyUI 本地 API 代理
- 提交 workflow、轮询进度、返回图片

---

## 第五步：ComfyUI API 调用方式

ComfyUI 提供 REST API，默认运行在 `http://localhost:8188`。

```typescript
// 提交任务
const res = await fetch('http://localhost:8188/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: workflowJson, client_id: 'home-designer' }),
});
const { prompt_id } = await res.json();

// 轮询进度
const ws = new WebSocket('ws://localhost:8188/ws?clientId=home-designer');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'executing' && data.data.node === null) {
    // 完成，从 /history/{prompt_id} 取图片
  }
};

// 获取结果图片
const history = await fetch(`http://localhost:8188/history/${prompt_id}`);
const { outputs } = await history.json();
// outputs[nodeId].images[0].filename → 图片文件名
// 图片在 ComfyUI/output/ 目录
```

---

## 与现有方案的对比

| | 当前方案（txt2img） | 新方案（img2img + ControlNet） |
|--|--|--|
| 空间来源 | AI 想象 | Three.js 实际3D模型 |
| 家具位置 | 随机摆放 | 与平面图一致 |
| 实现难度 | 已完成 ✅ | 中等（约2-3天） |
| 依赖 | 无额外依赖 | ComfyUI 本地运行 |
| 出图质量 | 中 | 高 |
| 费用 | 免费（或 OpenAI API） | 完全免费本地运行 |

---

## 参考资源

- [ComfyUI 官方文档](https://github.com/comfyanonymous/ComfyUI)
- [ControlNet 论文](https://arxiv.org/abs/2302.05543)
- [RealVisXL HuggingFace](https://huggingface.co/SG161222/RealVisXL_V5.0)
- [ComfyUI API 示例](https://github.com/comfyanonymous/ComfyUI/tree/master/script_examples)
- [ControlNet SDXL 模型](https://huggingface.co/diffusers/controlnet-depth-sdxl-1.0)
