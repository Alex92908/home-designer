/**
 * comfyWorkflow.ts
 * Generates ComfyUI API workflow JSON for ControlNet depth + img2img pipelines.
 * Used both for in-app auto-render (API routes) and for downloadable JSON files.
 */

import type { GeneratedPrompt } from "./roomPrompt";

export interface ControlNetWorkflowOptions {
  model?: string;
  controlnetModel?: string;
  depthModel?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  controlnetStrength?: number;
}

export interface Img2ImgWorkflowOptions {
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  denoise?: number;
}

export interface Txt2ImgWorkflowOptions {
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
}

/**
 * Multi-view ControlNet workflow.
 * Takes N screenshots from different angles, extracts a depth map from each,
 * then chains them as stacked ControlNet conditions into ONE generation.
 * More views → better spatial accuracy for furniture placement and room structure.
 */
export function generateMultiViewControlNetWorkflow(
  imageNames: string[],   // 2-4 uploaded screenshot filenames
  prompt: GeneratedPrompt,
  opts: ControlNetWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model           = "RealVisXL_V5.0_fp16.safetensors",
    controlnetModel = "diffusion_pytorch_model.safetensors",
    depthModel      = "depth_anything_v2_vits.pth",
    width           = 1024,
    height          = 1024,
    steps           = 35,
    cfg             = 6.5,
  } = opts;

  // Strength per view: distribute evenly so total influence stays ~0.85
  const perViewStrength = imageNames.length === 1 ? 0.85
    : imageNames.length === 2 ? 0.65
    : imageNames.length === 3 ? 0.55
    : 0.45;

  const nodes: Record<string, unknown> = {};

  // ── Shared nodes ─────────────────────────────────────────
  nodes["1"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } };
  nodes["2"] = { class_type: "CLIPTextEncode",         inputs: { text: prompt.positive, clip: ["1", 1] } };
  nodes["3"] = { class_type: "CLIPTextEncode",         inputs: { text: prompt.negative, clip: ["1", 1] } };
  nodes["4"] = { class_type: "ControlNetLoader",       inputs: { control_net_name: controlnetModel } };
  nodes["5"] = { class_type: "EmptyLatentImage",       inputs: { batch_size: 1, height, width } };

  // ── Per-view nodes (base id 10 + i*3) ────────────────────
  // For each view: LoadImage → DepthPreprocessor → ControlNetApplyAdvanced (chained)
  let lastApplyId = "";
  for (let i = 0; i < imageNames.length; i++) {
    const loadId  = String(10 + i * 3);   // 10, 13, 16, 19
    const depthId = String(11 + i * 3);   // 11, 14, 17, 20
    const applyId = String(12 + i * 3);   // 12, 15, 18, 21

    nodes[loadId] = {
      class_type: "LoadImage",
      inputs: { image: imageNames[i], upload: "image" },
    };
    nodes[depthId] = {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: { image: [loadId, 0], ckpt_name: depthModel, resolution: 1024 },
    };
    nodes[applyId] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      i === 0 ? ["2", 0] : [lastApplyId, 0],
        negative:      i === 0 ? ["3", 0] : [lastApplyId, 1],
        control_net:   ["4", 0],
        image:         [depthId, 0],
        strength:      perViewStrength,
        start_percent: 0,
        end_percent:   0.85,
      },
    };
    lastApplyId = applyId;
  }

  // ── Final sampling nodes ──────────────────────────────────
  nodes["50"] = {
    class_type: "KSampler",
    inputs: {
      seed:         prompt.seed,
      steps,
      cfg,
      sampler_name: "dpmpp_2m",
      scheduler:    "karras",
      denoise:      1.0,
      model:        ["1", 0],
      positive:     [lastApplyId, 0],
      negative:     [lastApplyId, 1],
      latent_image: ["5", 0],
    },
  };
  nodes["51"] = { class_type: "VAEDecode", inputs: { samples: ["50", 0], vae: ["1", 2] } };
  nodes["52"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: `multiview_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
      images: ["51", 0],
    },
  };

  return nodes;
}

/**
 * ControlNet Depth workflow.
 * - Extracts depth map from input screenshot via DepthAnythingV2
 * - Uses depth map to guide spatial structure in txt2img generation
 * - Requires: comfyui_controlnet_aux plugin, ControlNet SDXL depth model
 */
export function generateControlNetWorkflow(
  imageName: string,
  prompt: GeneratedPrompt,
  opts: ControlNetWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model              = "RealVisXL_V5.0_fp16.safetensors",
    controlnetModel    = "diffusion_pytorch_model.safetensors",
    depthModel         = "depth_anything_v2_vits.pth",
    width              = 1024,
    height             = 1024,
    steps              = 35,
    cfg                = 6.5,
    controlnetStrength = 0.85,
  } = opts;

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: imageName, upload: "image" },
    },
    "3": {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: {
        image:     ["2", 0],
        ckpt_name: depthModel,
        resolution: 1024,
      },
    },
    "4": {
      class_type: "PreviewImage",
      inputs: { images: ["3", 0] },
    },
    "5": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: controlnetModel },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.positive, clip: ["1", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.negative, clip: ["1", 1] },
    },
    "8": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["6", 0],
        negative:      ["7", 0],
        control_net:   ["5", 0],
        image:         ["3", 0],
        strength:      controlnetStrength,
        start_percent: 0,
        end_percent:   0.85,
      },
    },
    "9": {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: 1, height, width },
    },
    "10": {
      class_type: "KSampler",
      inputs: {
        seed:         prompt.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler:    "karras",
        denoise:      1.0,
        model:        ["1", 0],
        positive:     ["8", 0],
        negative:     ["8", 1],
        latent_image: ["9", 0],
      },
    },
    "11": {
      class_type: "VAEDecode",
      inputs: { samples: ["10", 0], vae: ["1", 2] },
    },
    "12": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `controlnet_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
        images: ["11", 0],
      },
    },
  };
}

/**
 * txt2img workflow — pure text-to-image, no input image required.
 * Higher steps + slightly lower CFG for richer creative output.
 */
export function generateTxt2ImgWorkflow(
  prompt: GeneratedPrompt,
  opts: Txt2ImgWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model  = "RealVisXL_V5.0_fp16.safetensors",
    width  = 1024,
    height = 1024,
    steps  = 35,
    cfg    = 6.5,
  } = opts;

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.positive, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.negative, clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: 1, height, width },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed:         prompt.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler:    "karras",
        denoise:      1.0,
        model:        ["1", 0],
        positive:     ["2", 0],
        negative:     ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `txt2img_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
        images: ["6", 0],
      },
    },
  };
}

/**
 * Multi-ControlNet + IPAdapter chain workflow.
 * Same depth/canny/normal control as multi-ControlNet, PLUS optional reference image
 * injected via IPAdapter to force visual consistency across renders.
 *
 * Use case: sequential multi-angle rendering where each new angle references the
 * previous render to keep materials, colors, and furniture style consistent.
 *
 * If referenceImageName is undefined → behaves like multi-ControlNet (first frame).
 * If referenceImageName is provided  → adds IPAdapter style/content conditioning.
 *
 * Requires: comfyui_controlnet_aux, ComfyUI_IPAdapter_plus,
 *           CLIP-ViT-H + ip-adapter-plus_sdxl_vit-h models.
 */
export interface IPAdapterChainOptions extends MultiControlNetWorkflowOptions {
  ipaWeight?: number;         // 0.5–0.8 good range
  ipaWeightType?: string;     // "linear" balanced, "style and composition" stronger style bias
  ipaPreset?: string;         // IPAdapterUnifiedLoader preset
  /** Fraction of sampling steps IPAdapter stays active. 1.0 = full run (max style
   *  consistency, can override depth). 0.6–0.7 = style anchor in early steps only,
   *  then ControlNet reclaims geometry for the rest — "strict geometry" mode. */
  ipaEndAt?: number;
}

export function generateIPAdapterChainWorkflow(
  imageName: string,
  referenceImageNames: string[],   // 0 = no ref, 1 = single-ref, 2-5 = multi-ref combined
  prompt: GeneratedPrompt,
  opts: IPAdapterChainOptions = {}
): Record<string, unknown> {
  const base = generateMultiControlNetWorkflow(imageName, prompt, opts) as Record<string, Record<string, unknown>>;

  // No reference → plain multi-ControlNet
  if (referenceImageNames.length === 0) return base;

  const ipaPreset = opts.ipaPreset ?? "PLUS (high strength)";

  // Common: load IPAdapter + CLIP vision (node 21)
  base["21"] = {
    class_type: "IPAdapterUnifiedLoader",
    inputs: { model: ["1", 0], preset: ipaPreset },
  };

  // ─── Single reference: IPAdapterAdvanced (geometry-similar views) ───
  if (referenceImageNames.length === 1) {
    const ipaWeight     = opts.ipaWeight     ?? 0.9;
    const ipaWeightType = opts.ipaWeightType ?? "style and composition";
    const ipaEndAt      = opts.ipaEndAt      ?? 1.0;

    base["20"] = {
      class_type: "LoadImage",
      inputs: { image: referenceImageNames[0], upload: "image" },
    };
    base["22"] = {
      class_type: "IPAdapterAdvanced",
      inputs: {
        model:          ["21", 0],
        ipadapter:      ["21", 1],
        image:          ["20", 0],
        weight:         ipaWeight,
        weight_type:    ipaWeightType,
        combine_embeds: "concat",
        start_at:       0.0,
        end_at:         ipaEndAt,
        embeds_scaling: "V only",
      },
    };
    (base["15"].inputs as Record<string, unknown>).model = ["22", 0];
  }
  // ─── Multi-reference: encode each → norm-average → style-only apply ───
  // Used when current view is geometrically dissimilar (e.g. aerial)
  // and per-frame composition match is impossible — we only want style anchor.
  else {
    const refs          = referenceImageNames.slice(0, 5);   // CombineEmbeds caps at 5
    const ipaWeight     = opts.ipaWeight     ?? 0.6;
    const ipaWeightType = opts.ipaWeightType ?? "style transfer";
    const ipaEndAt      = opts.ipaEndAt      ?? 1.0;

    // 30+i: LoadImage   |   40+i: IPAdapterEncoder
    refs.forEach((name, i) => {
      base[String(30 + i)] = {
        class_type: "LoadImage",
        inputs: { image: name, upload: "image" },
      };
      base[String(40 + i)] = {
        class_type: "IPAdapterEncoder",
        inputs: {
          ipadapter: ["21", 1],
          image:     [String(30 + i), 0],
          weight:    1.0,
        },
      };
    });

    // 50: combine all embeddings via norm average → unified style fingerprint
    const combineInputs: Record<string, unknown> = {
      embed1: ["40", 0],
      method: "norm average",
    };
    for (let i = 1; i < refs.length; i++) {
      combineInputs[`embed${i + 1}`] = [String(40 + i), 0];
    }
    base["50"] = { class_type: "IPAdapterCombineEmbeds", inputs: combineInputs };

    // 51: apply combined embedding to model (style only, no composition lock)
    base["51"] = {
      class_type: "IPAdapterEmbeds",
      inputs: {
        model:          ["21", 0],
        ipadapter:      ["21", 1],
        pos_embed:      ["50", 0],
        weight:         ipaWeight,
        weight_type:    ipaWeightType,
        start_at:       0.0,
        end_at:         ipaEndAt,
        embeds_scaling: "V only",
      },
    };
    (base["15"].inputs as Record<string, unknown>).model = ["51", 0];
  }

  // Distinguish chain outputs from regular renders
  (base["17"].inputs as Record<string, unknown>).filename_prefix =
    `ipachain_${prompt.roomType.replace(/[\s/]+/g, "_")}`;

  return base;
}

/**
 * Multi-ControlNet workflow: Depth + Canny + Normal from the same screenshot.
 * Three complementary signals in one pass:
 *   - Depth  → overall spatial structure (near/far)
 *   - Canny  → furniture & wall edge sharpness
 *   - Normal → surface orientation → better material rendering
 *
 * Requires comfyui_controlnet_aux for preprocessors.
 * Use same or different ControlNet model files per condition.
 */
export interface MultiControlNetWorkflowOptions {
  model?: string;
  depthControlnetModel?: string;
  cannyControlnetModel?: string;
  normalControlnetModel?: string;
  depthModel?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  depthStrength?: number;
  cannyStrength?: number;
  normalStrength?: number;
}

export function generateMultiControlNetWorkflow(
  imageName: string,
  prompt: GeneratedPrompt,
  opts: MultiControlNetWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model                = "RealVisXL_V5.0_fp16.safetensors",
    depthControlnetModel = "diffusion_pytorch_model.safetensors",
    cannyControlnetModel = "diffusion_pytorch_model.safetensors",
    normalControlnetModel= "diffusion_pytorch_model.safetensors",
    depthModel           = "depth_anything_v2_vits.pth",
    width                = 1024,
    height               = 1024,
    steps                = 35,
    cfg                  = 6.5,
    // ── Tuned 2026-04 for flat wall items (artwork, track lights, picture frames) ──
    // Depth slightly reduced (0.75 → 0.70) to let Canny override for thin features
    // that DepthAnythingV2 flattens against the wall plane.
    depthStrength        = 0.70,
    // Canny boosted (0.30 → 0.50) + lower thresholds (100/200 → 60/160) + longer
    // end_percent (0.75 → 0.85) so edge hints persist into mid-generation rather
    // than fading once denoising starts filling in.
    cannyStrength        = 0.50,
    normalStrength       = 0.25,
  } = opts;

  return {
    // ── Backbone ─────────────────────────────────────────────
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },

    // ── Input image ──────────────────────────────────────────
    "2": { class_type: "LoadImage", inputs: { image: imageName, upload: "image" } },

    // ── Preprocessors ────────────────────────────────────────
    "3": {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: { image: ["2", 0], ckpt_name: depthModel, resolution: 1024 },
    },
    "4": {
      // Lower thresholds → detect faint/thin edges: track light rails, picture
      // frames, shelf outlines — the items DepthAnythingV2 collapses into walls.
      class_type: "CannyEdgePreprocessor",
      inputs: { image: ["2", 0], low_threshold: 60, high_threshold: 160, resolution: 1024 },
    },
    "5": {
      class_type: "BAE-NormalMapPreprocessor",
      inputs: { image: ["2", 0], resolution: 1024 },
    },

    // ── ControlNet loaders ───────────────────────────────────
    "6": { class_type: "ControlNetLoader", inputs: { control_net_name: depthControlnetModel } },
    "7": { class_type: "ControlNetLoader", inputs: { control_net_name: cannyControlnetModel } },
    "8": { class_type: "ControlNetLoader", inputs: { control_net_name: normalControlnetModel } },

    // ── Text conditioning ────────────────────────────────────
    "9":  { class_type: "CLIPTextEncode", inputs: { text: prompt.positive, clip: ["1", 1] } },
    "10": { class_type: "CLIPTextEncode", inputs: { text: prompt.negative, clip: ["1", 1] } },

    // ── Latent ───────────────────────────────────────────────
    "11": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height, width } },

    // ── Chained ControlNet applications ─────────────────────
    "12": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["9",  0],
        negative:      ["10", 0],
        control_net:   ["6",  0],
        image:         ["3",  0],   // depth
        strength:      depthStrength,
        start_percent: 0,
        end_percent:   1.0,
      },
    },
    "13": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["12", 0],
        negative:      ["12", 1],
        control_net:   ["7",  0],
        image:         ["4",  0],   // canny
        strength:      cannyStrength,
        start_percent: 0,
        end_percent:   0.85,   // persist edge guidance longer — preserves thin items
      },
    },
    "14": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["13", 0],
        negative:      ["13", 1],
        control_net:   ["8",  0],
        image:         ["5",  0],   // normal
        strength:      normalStrength,
        start_percent: 0,
        end_percent:   0.75,
      },
    },

    // ── Sampling ─────────────────────────────────────────────
    "15": {
      class_type: "KSampler",
      inputs: {
        seed:         prompt.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler:    "karras",
        denoise:      1.0,
        model:        ["1",  0],
        positive:     ["14", 0],
        negative:     ["14", 1],
        latent_image: ["11", 0],
      },
    },
    "16": { class_type: "VAEDecode",  inputs: { samples: ["15", 0], vae: ["1", 2] } },
    "17": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `multi_controlnet_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
        images: ["16", 0],
      },
    },
  };
}

/**
 * img2img workflow (no ControlNet).
 * - Encodes the input screenshot into latent space via VAE
 * - KSampler with denoise ~0.6 blends AI material repainting with original structure
 * - Lighter, faster, no ControlNet plugin required
 */
export function generateImg2ImgWorkflow(
  imageName: string,
  prompt: GeneratedPrompt,
  opts: Img2ImgWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model   = "RealVisXL_V5.0_fp16.safetensors",
    width   = 1024,
    height  = 1024,
    steps   = 28,
    cfg     = 7.0,
    denoise = 0.65,
  } = opts;

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: imageName, upload: "image" },
    },
    "3": {
      class_type: "ImageScale",
      inputs: {
        image:          ["2", 0],
        width,
        height,
        upscale_method: "lanczos",
        crop:           "disabled",
      },
    },
    "4": {
      class_type: "VAEEncode",
      inputs: { pixels: ["3", 0], vae: ["1", 2] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.positive, clip: ["1", 1] },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt.negative, clip: ["1", 1] },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed:         prompt.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler:    "karras",
        denoise,
        model:        ["1", 0],
        positive:     ["5", 0],
        negative:     ["6", 0],
        latent_image: ["4", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["1", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `img2img_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
        images: ["8", 0],
      },
    },
  };
}
