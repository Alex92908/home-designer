/**
 * comfyWorkflow.ts
 * Generates ComfyUI API workflow JSON for ControlNet depth + img2img pipelines.
 * Used both for in-app auto-render (API routes) and for downloadable JSON files.
 */

import type { GeneratedPrompt } from "./roomPrompt";

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
 * Dual ControlNet workflow — Depth + Canny from the same screenshot.
 *
 * Research-backed optimal weights (2024):
 *   Depth  → 0.80, end_percent 1.0  — locks spatial structure (near/far, volumes)
 *   Canny  → 0.50, end_percent 0.75 — sharpens architectural edges (mullions, slats, tiles)
 *
 * This replaces the old single-depth workflow. The Canny pass captures the
 * wood-soffit slat rhythm, travertine tile joints, and pool coping lines we
 * added to the 3D scene — exactly the detail needed for photorealistic renders.
 *
 * Requires: comfyui_controlnet_aux (DepthAnythingV2Preprocessor + CannyEdgePreprocessor),
 *           two ControlNet model files (can be the same file for both channels).
 */
export interface ControlNetWorkflowOptions {
  model?: string;
  /** ControlNet model for the depth channel (SDXL depth model) */
  depthControlnetModel?: string;
  /** ControlNet model for the canny channel (SDXL canny/lineart model) */
  cannyControlnetModel?: string;
  /** Kept for back-compat; maps to depthControlnetModel if depthControlnetModel not set */
  controlnetModel?: string;
  depthModel?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  depthStrength?: number;
  cannyStrength?: number;
}

export function generateControlNetWorkflow(
  imageName: string,
  prompt: GeneratedPrompt,
  opts: ControlNetWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model                = "RealVisXL_V5.0_fp16.safetensors",
    depthControlnetModel = opts.controlnetModel ?? "diffusion_pytorch_model.safetensors",
    cannyControlnetModel = opts.controlnetModel ?? "diffusion_pytorch_model.safetensors",
    depthModel           = "depth_anything_v2_vits.pth",
    width                = 1024,
    height               = 1024,
    steps                = 35,
    cfg                  = 6.5,
    depthStrength        = 0.80,
    cannyStrength        = 0.50,
  } = opts;

  return {
    // ── Backbone ──────────────────────────────────────────────────────────
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },

    // ── Input image ───────────────────────────────────────────────────────
    "2": { class_type: "LoadImage", inputs: { image: imageName, upload: "image" } },

    // ── Preprocessors — both from the same source image ───────────────────
    "3": {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: { image: ["2", 0], ckpt_name: depthModel, resolution: 1024 },
    },
    "4": {
      // Canny thresholds tuned for architectural schematic lines:
      // low=80 catches soffit slat edges; high=180 keeps mullion/tile joints sharp
      class_type: "CannyEdgePreprocessor",
      inputs: { image: ["2", 0], low_threshold: 80, high_threshold: 180, resolution: 1024 },
    },

    // ── ControlNet model loaders ──────────────────────────────────────────
    "5": { class_type: "ControlNetLoader", inputs: { control_net_name: depthControlnetModel } },
    "6": { class_type: "ControlNetLoader", inputs: { control_net_name: cannyControlnetModel } },

    // ── Text conditioning ─────────────────────────────────────────────────
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt.positive, clip: ["1", 1] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: prompt.negative,  clip: ["1", 1] } },

    // ── Latent canvas ─────────────────────────────────────────────────────
    "9": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height, width } },

    // ── ControlNet apply — chained: depth first, canny on top ─────────────
    "10": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["7", 0],
        negative:      ["8", 0],
        control_net:   ["5", 0],
        image:         ["3", 0],   // depth map
        strength:      depthStrength,
        start_percent: 0,
        end_percent:   1.0,        // depth guides the full pass
      },
    },
    "11": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive:      ["10", 0],
        negative:      ["10", 1],
        control_net:   ["6", 0],
        image:         ["4", 0],   // canny edge map
        strength:      cannyStrength,
        start_percent: 0,
        end_percent:   0.75,       // edge detail only needed in early–mid diffusion
      },
    },

    // ── Sampling ──────────────────────────────────────────────────────────
    "12": {
      class_type: "KSampler",
      inputs: {
        seed:         prompt.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler:    "karras",
        denoise:      1.0,
        model:        ["1",  0],
        positive:     ["11", 0],
        negative:     ["11", 1],
        latent_image: ["9",  0],
      },
    },
    "13": { class_type: "VAEDecode",  inputs: { samples: ["12", 0], vae: ["1", 2] } },
    "14": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `controlnet_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
        images: ["13", 0],
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
        end_at:         1.0,
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
        end_at:         1.0,
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
    depthStrength        = 0.80,   // ↑ was 0.75 — stronger spatial lock
    cannyStrength        = 0.50,   // ↑ was 0.30 — match single-CN canny weight
    normalStrength       = 0.20,   // ↓ was 0.25 — normals less reliable on schematic 3D
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
      class_type: "CannyEdgePreprocessor",
      inputs: { image: ["2", 0], low_threshold: 100, high_threshold: 200, resolution: 1024 },
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
        end_percent:   0.75,
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

// ─── HiResFix — 4K upscale ───────────────────────────────────────────────────
/**
 * 4K HiResFix workflow: generate at 1024×1024 then upscale 4× with
 * ESRGAN + a second KSampler pass (denoise=0.40) that adds photographic
 * micro-detail at the higher resolution.
 *
 * Total output: 4096×4096 — on par with the reference photo in the brief.
 *
 * Requires: comfyui-esrgan (4x_ESRGAN_RealSRGAN.pth in models/upscale_models/)
 * The upscale model name is configurable via opts.upscaleModel.
 *
 * Chain:
 *   1→5   : Backbone + text + latent (same as controlnet workflow)
 *   6→8   : ControlNet depth+canny (reuse same nodes as generateControlNetWorkflow)
 *   20    : KSampler #1 — base 1024 generation
 *   21    : VAEDecode → 1024 image
 *   22    : ImageUpscaleWithModel → 4096 image (ESRGAN 4×)
 *   23    : VAEEncode → 4096 latent
 *   24    : KSampler #2 — detail pass (denoise=0.40, fewer steps)
 *   25    : VAEDecode → 4096 final
 *   26    : SaveImage at 4K
 */
export interface HiResWorkflowOptions extends ControlNetWorkflowOptions {
  upscaleModel?: string;
  hiResSteps?:   number;
  hiResDenoise?: number;
}

export function generateHiResWorkflow(
  imageName: string,
  prompt: GeneratedPrompt,
  opts: HiResWorkflowOptions = {}
): Record<string, unknown> {
  const {
    model                = "RealVisXL_V5.0_fp16.safetensors",
    depthControlnetModel = opts.controlnetModel ?? "diffusion_pytorch_model.safetensors",
    cannyControlnetModel = opts.controlnetModel ?? "diffusion_pytorch_model.safetensors",
    depthModel           = "depth_anything_v2_vits.pth",
    width                = 1024,
    height               = 1024,
    steps                = 35,
    cfg                  = 6.5,
    depthStrength        = 0.80,
    cannyStrength        = 0.50,
    upscaleModel         = "4x_ESRGAN_RealSRGAN.pth",
    hiResSteps           = 20,
    hiResDenoise         = 0.40,
  } = opts;

  return {
    // ── Backbone ──────────────────────────────────────────────────────────────
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },

    // ── Input image (3D scene screenshot) ─────────────────────────────────────
    "2": { class_type: "LoadImage", inputs: { image: imageName, upload: "image" } },

    // ── Preprocessors ─────────────────────────────────────────────────────────
    "3": { class_type: "DepthAnythingV2Preprocessor",
      inputs: { image: ["2", 0], ckpt_name: depthModel, resolution: 1024 } },
    "4": { class_type: "CannyEdgePreprocessor",
      inputs: { image: ["2", 0], low_threshold: 80, high_threshold: 180, resolution: 1024 } },

    // ── ControlNet loaders ────────────────────────────────────────────────────
    "5": { class_type: "ControlNetLoader", inputs: { control_net_name: depthControlnetModel } },
    "6": { class_type: "ControlNetLoader", inputs: { control_net_name: cannyControlnetModel } },

    // ── Text conditioning ─────────────────────────────────────────────────────
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt.positive, clip: ["1", 1] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: prompt.negative,  clip: ["1", 1] } },

    // ── Latent canvas (1024) ─────────────────────────────────────────────────
    "9": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height, width } },

    // ── ControlNet chain ──────────────────────────────────────────────────────
    "10": { class_type: "ControlNetApplyAdvanced", inputs: {
      positive: ["7", 0], negative: ["8", 0],
      control_net: ["5", 0], image: ["3", 0],
      strength: depthStrength, start_percent: 0, end_percent: 1.0,
    }},
    "11": { class_type: "ControlNetApplyAdvanced", inputs: {
      positive: ["10", 0], negative: ["10", 1],
      control_net: ["6", 0], image: ["4", 0],
      strength: cannyStrength, start_percent: 0, end_percent: 0.75,
    }},

    // ── KSampler #1 — base 1024×1024 generation ───────────────────────────────
    "20": { class_type: "KSampler", inputs: {
      seed: prompt.seed, steps, cfg,
      sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1.0,
      model: ["1", 0], positive: ["11", 0], negative: ["11", 1],
      latent_image: ["9", 0],
    }},

    // ── Decode 1024 → pixel space ─────────────────────────────────────────────
    "21": { class_type: "VAEDecode", inputs: { samples: ["20", 0], vae: ["1", 2] } },

    // ── ESRGAN 4× upscale → 4096 pixel image ─────────────────────────────────
    "22": { class_type: "UpscaleModelLoader",     inputs: { model_name: upscaleModel } },
    "23": { class_type: "ImageUpscaleWithModel",  inputs: { upscale_model: ["22", 0], image: ["21", 0] } },

    // ── Encode back to latent for detail pass ─────────────────────────────────
    "24": { class_type: "VAEEncode", inputs: { pixels: ["23", 0], vae: ["1", 2] } },

    // ── KSampler #2 — HiResFix detail at 4096 (low denoise = preserve structure) ──
    "25": { class_type: "KSampler", inputs: {
      seed: (prompt.seed + 1) % (2 ** 31), steps: hiResSteps, cfg,
      sampler_name: "dpmpp_2m", scheduler: "karras", denoise: hiResDenoise,
      model: ["1", 0], positive: ["11", 0], negative: ["11", 1],
      latent_image: ["24", 0],
    }},

    // ── Decode + save at 4K ───────────────────────────────────────────────────
    "26": { class_type: "VAEDecode",  inputs: { samples: ["25", 0], vae: ["1", 2] } },
    "27": { class_type: "SaveImage",  inputs: {
      filename_prefix: `hires4k_${prompt.roomType.replace(/[\s/]+/g, "_")}`,
      images: ["26", 0],
    }},
  };
}
