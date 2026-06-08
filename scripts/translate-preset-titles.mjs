// 把 public/workflow-presets/*.json 里 ComfyUI 节点的中文 `title` 批量译成英文，
// 让用户把工作流导进 ComfyUI 打开时看到的也是英文标签。
//
// 安全策略：
//   - 递归遍历，只改对象里 key === "title" 且值命中词典的字符串；
//   - 不动节点 id / type / inputs，不动 widgets_values（运行时会被注入的 prompt 覆盖）；
//   - 词典是「精确匹配」，未收录的标题原样保留并在结尾告警，绝不瞎猜替换。
//
// 复现：node scripts/translate-preset-titles.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "workflow-presets");

// 中文节点标题 → 英文（覆盖全部 103 个去重标题）
const TITLE_EN = {
  "输入文字": "Input Text",
  "上传图片": "Upload Image",
  "结果图": "Result",
  "图片比例": "Image Ratio",
  "图片大小": "Image Size",
  "数量": "Count",
  "3图像对比（右键保存）": "3 Image Compare (Right-click to Save)",
  "1上传图片": "1 Upload Image",
  "右键保存": "Right-click to Save",
  "2文字描述": "2 Text Description",
  "尺寸": "Size",
  "右键保存图片": "Right-click to Save Image",
  "上传图片2": "Upload Image 2",
  "香蕉多图编辑2": "Banana Multi-Image Edit 2",
  "最终结果（右键保存）": "Final Result (Right-click to Save)",
  "改图提示词": "Edit Prompt",
  "尺寸调整": "Resize",
  "图2（风格参考）": "Image 2 (Style Reference)",
  "图1（毛坯）": "Image 1 (Bare Shell)",
  "保存": "Save",
  "香蕉根据参考图产品设计": "Banana Product Design from Reference",
  "香蕉文生图": "Banana Text-to-Image",
  "香蕉单图编辑2": "Banana Single-Image Edit 2",
  "角度调整": "Angle Adjustment",
  "精修幅度": "Refine Strength",
  "文字描述": "Text Description",
  "提示词输入（中英文均可）": "Prompt Input (Chinese or English)",
  "平面图出彩屏方案": "Floor Plan to Color Scheme",
  "尺寸调整和数量（宽高）": "Resize & Count (Width/Height)",
  "右键图片保存": "Right-click to Save Image",
  "flux2文生图": "flux2 Text-to-Image",
  "高清放大工作流": "HD Upscale",
  "香蕉超多图编辑": "Banana Many-Image Edit",
  "香蕉白膜渲染": "Banana White Model Render",
  "香蕉毛坯出图": "Banana Bare Shell Render",
  "香蕉根据参考图延申设计": "Banana Design Extension from Reference",
  "香蕉产品设计文生图": "Banana Product Design (Text-to-Image)",
  "香蕉产品模仿精修": "Banana Product Mimic Refine",
  "香蕉-平面图优化工作流": "Banana · Floor Plan Enhance",
  "香蕉-360全景图": "Banana · 360 Panorama",
  "采样": "Sampling",
  "遮罩复位": "Mask Reset",
  "过程预览": "Process Preview",
  "输出": "Output",
  "输入": "Input",
  "贴图制作": "Texture Creation",
  "角度调整工作流": "Angle Adjustment",
  "线稿出效果图风格参考工作流": "Line Art to Render (Style Reference)",
  "线稿出效果图工作流": "Line Art to Render",
  "立面刨面结构图": "Elevation & Section Diagram",
  "白模型出效果图风格参考工作流": "White Model to Render (Style Reference)",
  "生成张数": "Number of Images",
  "生成几张": "Number of Images",
  "生图结果": "Generated Result",
  "洗图工作流": "Image Cleanup",
  "毛坯出效果图（参考风格）": "Bare Shell to Render (Style Reference)",
  "毛坯出效果图风格参考工作流": "Bare Shell to Render (Style Reference)",
  "毛坯出效果图工作流": "Bare Shell to Render",
  "模型加载": "Model Loader",
  "模型": "Model",
  "文本编码": "Text Encode",
  "放大倍数 2是4k，4是8K": "Upscale Factor (2=4K, 4=8K)",
  "接缝": "Seam",
  "指定修改多图版本flux2": "Targeted Edit · Multi Image (flux2)",
  "指定修改单图版本flux2": "Targeted Edit · Single Image (flux2)",
  "平面图出效果图（多图版）": "Floor Plan to Render (Multi Image)",
  "平面图出效果图": "Floor Plan to Render",
  "局部重绘手动指定物体": "Inpaint (Manual Object)",
  "局部重绘手动指定": "Inpaint (Manual Region)",
  "局部重绘双图版": "Inpaint (Dual Image)",
  "导出": "Export",
  "多角度白膜出效果图工作流": "White Model to Render · Multi Angle",
  "图片最长边调整": "Longest-Side Resize",
  "图片一键生成带贴图灯光3D模型": "Image to Textured & Lit 3D Model",
  "图5": "Image 5",
  "图4": "Image 4",
  "图3": "Image 3",
  "图2上传替换物品": "Image 2 · Upload Replacement Object",
  "图2": "Image 2",
  "图1上传原图": "Image 1 · Upload Source",
  "图1": "Image 1",
  "参考图": "Reference Image",
  "单角度调整工作流": "Angle Adjustment · Single",
  "单角度白膜出效果图工作流": "White Model to Render · Single Angle",
  "单体建模": "Single-Object Modeling",
  "加载模型": "Load Model",
  "二图": "Image Two",
  "上传指定图片图2": "Upload Specified Image · Image 2",
  "上传图片3": "Upload Image 3",
  "上传原图（右键编辑遮罩）图1": "Upload Source (Right-click to Edit Mask) · Image 1",
  "上传原图": "Upload Source Image",
  "flux2产品精修": "flux2 Product Refine",
  "TPP放大": "TPP Upscale",
  "Kontext修图": "Kontext Retouch",
  "FLUX2-Klein（这部分不要动）": "FLUX2-Klein (Do Not Modify)",
  "FLUX2 KLEIN 文生图": "FLUX2 KLEIN Text-to-Image",
  "4.1局部重绘双图版": "4.1 Inpaint (Dual Image)",
  "360全景图（仅云端）": "360 Panorama (Cloud Only)",
  "3.输入文字": "3. Input Text",
  "2输入文字，（想改生成输入什么）": "2 Input Text (describe what to change)",
  "2输入文字": "2 Input Text",
  "1上传原图(右键编辑遮罩)": "1 Upload Source (Right-click to Edit Mask)",
  "1上传原图": "1 Upload Source",
};

const hasCJK = (s) => /[一-鿿]/.test(s);
const unknown = new Set();
let changed = 0;

/** 递归：只翻 key==="title" 的字符串值 */
function walk(node) {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "title" && typeof v === "string" && hasCJK(v)) {
        if (TITLE_EN[v]) { node[k] = TITLE_EN[v]; changed++; }
        else unknown.add(v);
      } else {
        walk(v);
      }
    }
  }
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const path = join(DIR, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const before = changed;
  walk(json);
  if (changed > before) writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
}

console.log(`✅ translated ${changed} node titles`);
if (unknown.size) {
  console.log(`⚠️  ${unknown.size} title(s) NOT in dictionary (left unchanged):`);
  for (const u of unknown) console.log("   -", u);
}
