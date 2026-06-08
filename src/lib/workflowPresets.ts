// 4月21日-配套素材 全部工作流预设目录
// 每条 = 元数据；原始 ComfyUI 工作流 JSON 在 public/workflow-presets/<id>.json（UI 图格式）。
// 导入时按 cloud 决定后端（cloud→RunningHub 需 workflowId；local→本地 ComfyUI 用 JSON）。
//
// 名称同时登记中文（name）与英文（nameEn），分类同理（category 为中文键，英文标签见
// PRESET_CATEGORY_EN）。UI 按当前 locale 用 presetName / presetCategoryLabel 取值，
// 避免在组件里散落中英判断。

import type { Locale } from "./i18n";

export interface WorkflowPreset {
  id: string;
  name: string;          // 中文名（也用作 VIEW_TARGET 等处的匹配键）
  nameEn: string;        // 英文名
  category: string;      // 中文分类键
  cloud: boolean;        // true=RunningHub 云端 Gemini/BananaPro；false=本地 ComfyUI(Flux2 等)
  needsImage: boolean;
  promptNodeId: string;
  promptField: string;   // 注入提示词的字段名：CR Prompt Text=prompt，CLIPTextEncode/CR Text=text
  imageNodeId: string;
  jsonPath: string;      // public 下的相对路径，导入时 fetch 取原始 JSON
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  { id: "wf_001", name: "flux2文生图", nameEn: "flux2 Text-to-Image", category: "01文生图", cloud: false, needsImage: false, promptNodeId: "99", promptField: "text", imageNodeId: "", jsonPath: "/workflow-presets/wf_001.json" },
  { id: "wf_002", name: "flux2文生图（低显卡）", nameEn: "flux2 Text-to-Image (Low VRAM)", category: "01文生图", cloud: false, needsImage: false, promptNodeId: "99", promptField: "text", imageNodeId: "", jsonPath: "/workflow-presets/wf_002.json" },
  { id: "wf_003", name: "线稿出效果图工作流", nameEn: "Line Art to Render", category: "02线稿出图", cloud: false, needsImage: true, promptNodeId: "52", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_003.json" },
  { id: "wf_004", name: "线稿出效果图风格参考工作流", nameEn: "Line Art to Render (Style Reference)", category: "02线稿出图", cloud: false, needsImage: true, promptNodeId: "100", promptField: "text", imageNodeId: "99", jsonPath: "/workflow-presets/wf_004.json" },
  { id: "wf_005", name: "放大工作流", nameEn: "Upscale", category: "修复放大", cloud: false, needsImage: true, promptNodeId: "249", promptField: "text", imageNodeId: "17", jsonPath: "/workflow-presets/wf_005.json" },
  { id: "wf_006", name: "洗图工作流", nameEn: "Image Cleanup", category: "修复放大", cloud: false, needsImage: true, promptNodeId: "294", promptField: "text", imageNodeId: "283", jsonPath: "/workflow-presets/wf_006.json" },
  { id: "wf_007", name: "单体建模", nameEn: "Single-Object Modeling", category: "单体建模", cloud: false, needsImage: true, promptNodeId: "", promptField: "text", imageNodeId: "23", jsonPath: "/workflow-presets/wf_007.json" },
  { id: "wf_008", name: "建模", nameEn: "Modeling", category: "单体建模", cloud: false, needsImage: true, promptNodeId: "", promptField: "text", imageNodeId: "13", jsonPath: "/workflow-presets/wf_008.json" },
  { id: "wf_009", name: "贴图制作", nameEn: "Texture Creation", category: "单体建模", cloud: false, needsImage: false, promptNodeId: "25", promptField: "text", imageNodeId: "", jsonPath: "/workflow-presets/wf_009.json" },
  { id: "wf_010", name: "局部重绘手动指定", nameEn: "Inpaint (Manual Region)", category: "改图重绘", cloud: false, needsImage: true, promptNodeId: "214", promptField: "text", imageNodeId: "321", jsonPath: "/workflow-presets/wf_010.json" },
  { id: "wf_011", name: "局部重绘手动指定物体", nameEn: "Inpaint (Manual Object)", category: "改图重绘", cloud: false, needsImage: true, promptNodeId: "301", promptField: "text", imageNodeId: "321", jsonPath: "/workflow-presets/wf_011.json" },
  { id: "wf_012", name: "指定修改单图版本flux2", nameEn: "Targeted Edit · Single Image (flux2)", category: "改图重绘", cloud: false, needsImage: true, promptNodeId: "117", promptField: "text", imageNodeId: "76", jsonPath: "/workflow-presets/wf_012.json" },
  { id: "wf_013", name: "指定修改多图版本flux2", nameEn: "Targeted Edit · Multi Image (flux2)", category: "改图重绘", cloud: false, needsImage: true, promptNodeId: "68", promptField: "text", imageNodeId: "116", jsonPath: "/workflow-presets/wf_013.json" },
  { id: "wf_014", name: "毛坯出效果图工作流", nameEn: "Bare Shell to Render", category: "毛坯出图", cloud: false, needsImage: true, promptNodeId: "48", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_014.json" },
  { id: "wf_015", name: "毛坯出效果图风格参考工作流", nameEn: "Bare Shell to Render (Style Reference)", category: "毛坯出图", cloud: false, needsImage: true, promptNodeId: "100", promptField: "text", imageNodeId: "99", jsonPath: "/workflow-presets/wf_015.json" },
  { id: "wf_016", name: "单角度白膜出效果图工作流", nameEn: "White Model to Render · Single Angle", category: "白膜出效果图", cloud: false, needsImage: true, promptNodeId: "52", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_016.json" },
  { id: "wf_017", name: "多角度白膜出效果图工作流", nameEn: "White Model to Render · Multi Angle", category: "白膜出效果图", cloud: false, needsImage: true, promptNodeId: "52", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_017.json" },
  { id: "wf_018", name: "白模型出效果图风格参考工作流", nameEn: "White Model to Render (Style Reference)", category: "白膜出效果图", cloud: false, needsImage: true, promptNodeId: "121", promptField: "text", imageNodeId: "99", jsonPath: "/workflow-presets/wf_018.json" },
  { id: "wf_019", name: "单角度调整工作流", nameEn: "Angle Adjustment · Single", category: "角度调整工作流", cloud: false, needsImage: true, promptNodeId: "23", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_019.json" },
  { id: "wf_020", name: "角度调整工作流", nameEn: "Angle Adjustment", category: "角度调整工作流", cloud: false, needsImage: true, promptNodeId: "23", promptField: "text", imageNodeId: "30", jsonPath: "/workflow-presets/wf_020.json" },
  { id: "wf_021", name: "360全景图（仅云端）", nameEn: "360 Panorama (Cloud Only)", category: "香蕉BananaPro", cloud: false, needsImage: true, promptNodeId: "100", promptField: "text", imageNodeId: "46", jsonPath: "/workflow-presets/wf_021.json" },
  { id: "wf_022", name: "香蕉-360全景图", nameEn: "Banana · 360 Panorama", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "61", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_022.json" },
  { id: "wf_023", name: "Kontext修图", nameEn: "Kontext Retouch", category: "香蕉BananaPro", cloud: false, needsImage: true, promptNodeId: "333", promptField: "text", imageNodeId: "319", jsonPath: "/workflow-presets/wf_023.json" },
  { id: "wf_024", name: "flux2产品精修", nameEn: "flux2 Product Refine", category: "香蕉BananaPro", cloud: false, needsImage: true, promptNodeId: "294", promptField: "text", imageNodeId: "283", jsonPath: "/workflow-presets/wf_024.json" },
  { id: "wf_025", name: "香蕉产品模仿精修", nameEn: "Banana Product Mimic Refine", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "32", jsonPath: "/workflow-presets/wf_025.json" },
  { id: "wf_026", name: "香蕉产品设计文生图", nameEn: "Banana Product Design (Text-to-Image)", category: "香蕉BananaPro", cloud: true, needsImage: false, promptNodeId: "18", promptField: "prompt", imageNodeId: "", jsonPath: "/workflow-presets/wf_026.json" },
  { id: "wf_027", name: "香蕉根据参考图产品设计", nameEn: "Banana Product Design from Reference", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_027.json" },
  { id: "wf_028", name: "香蕉文生图", nameEn: "Banana Text-to-Image", category: "香蕉BananaPro", cloud: true, needsImage: false, promptNodeId: "18", promptField: "prompt", imageNodeId: "", jsonPath: "/workflow-presets/wf_028.json" },
  { id: "wf_029", name: "香蕉根据参考图延申设计", nameEn: "Banana Design Extension from Reference", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_029.json" },
  { id: "wf_030", name: "香蕉-平面图优化工作流", nameEn: "Banana · Floor Plan Enhance", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_030.json" },
  { id: "wf_031", name: "平面图出效果图", nameEn: "Floor Plan to Render", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "44", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_031.json" },
  { id: "wf_032", name: "平面图出效果图（多图版）", nameEn: "Floor Plan to Render (Multi Image)", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_032.json" },
  { id: "wf_033", name: "平面图出彩屏方案", nameEn: "Floor Plan to Color Scheme", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_033.json" },
  { id: "wf_034", name: "立面刨面结构图", nameEn: "Elevation & Section Diagram", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_034.json" },
  { id: "wf_035", name: "外立面出效果图", nameEn: "Facade to Render", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_035.json" },
  { id: "wf_036", name: "彩屏工作流", nameEn: "Color Scheme", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_036.json" },
  { id: "wf_037", name: "香蕉-柜体设计", nameEn: "Banana · Cabinet Design", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_037.json" },
  { id: "wf_038", name: "香蕉白膜渲染", nameEn: "Banana White Model Render", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_038.json" },
  { id: "wf_039", name: "香蕉单图编辑2", nameEn: "Banana Single-Image Edit 2", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "32", jsonPath: "/workflow-presets/wf_039.json" },
  { id: "wf_040", name: "香蕉多图编辑2", nameEn: "Banana Multi-Image Edit 2", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_040.json" },
  { id: "wf_041", name: "香蕉单图编辑2", nameEn: "Banana Single-Image Edit 2", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "32", jsonPath: "/workflow-presets/wf_041.json" },
  { id: "wf_042", name: "香蕉多图编辑2", nameEn: "Banana Multi-Image Edit 2", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_042.json" },
  { id: "wf_043", name: "香蕉文生图", nameEn: "Banana Text-to-Image", category: "香蕉BananaPro", cloud: true, needsImage: false, promptNodeId: "18", promptField: "prompt", imageNodeId: "", jsonPath: "/workflow-presets/wf_043.json" },
  { id: "wf_044", name: "毛坯出效果图（参考风格）", nameEn: "Bare Shell to Render (Style Reference)", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "3", jsonPath: "/workflow-presets/wf_044.json" },
  { id: "wf_045", name: "香蕉毛坯出图", nameEn: "Banana Bare Shell Render", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "18", promptField: "prompt", imageNodeId: "32", jsonPath: "/workflow-presets/wf_045.json" },
  { id: "wf_046", name: "香蕉超多图编辑", nameEn: "Banana Many-Image Edit", category: "香蕉BananaPro", cloud: true, needsImage: true, promptNodeId: "40", promptField: "prompt", imageNodeId: "34", jsonPath: "/workflow-presets/wf_046.json" },
];

// 分类中文键 → 英文标签
export const PRESET_CATEGORY_EN: Record<string, string> = {
  "01文生图": "01 Text-to-Image",
  "02线稿出图": "02 Line Art to Render",
  "修复放大": "Fix & Upscale",
  "单体建模": "3D Modeling",
  "改图重绘": "Edit & Inpaint",
  "毛坯出图": "Bare Shell to Render",
  "白膜出效果图": "White Model to Render",
  "角度调整工作流": "Angle Adjustment",
  "香蕉BananaPro": "Banana BananaPro",
};

export const PRESET_CATEGORIES: string[] = ["01文生图", "02线稿出图", "修复放大", "单体建模", "改图重绘", "毛坯出图", "白膜出效果图", "角度调整工作流", "香蕉BananaPro"];

/** 按 locale 取预设显示名 */
export function presetName(p: WorkflowPreset, locale: Locale): string {
  return locale === "en" ? p.nameEn : p.name;
}

/** 按 locale 取分类显示名（英文缺省回退中文键） */
export function presetCategoryLabel(category: string, locale: Locale): string {
  return locale === "en" ? (PRESET_CATEGORY_EN[category] ?? category) : category;
}
