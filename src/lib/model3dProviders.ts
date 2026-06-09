// ─── 图生 3D 后端注册表 ─────────────────────────────────────────────────────
//
// 与大模型注册表 [[aiProviders]] 分开：那边是 LLM 聊天补全（户型/外观解析、文生
// 设计），这里是「图片 → GLB」的重型 3D 推理。每个后端登记它需要哪种凭证
// （hf / fal），前端下拉与后端统一代理 /api/model-3d 共用这一份注册表 —— 加一个
// 后端只改这一处，不必散落特判。
//
// 密钥仍沿用项目 BYOK 口径：只存浏览器 localStorage（见 [[model3dKeys]]），随请求
// 转发给本站代理，绝不落服务端、不被回显。
//
// label 用品牌名（语言中性），中英描述放 blurb/hint 的 {zh,en}，组件按当前 locale
// 取用，避免在英文模式下泄漏中文。

export type Model3dProviderId = "trellis" | "trellis2" | "hunyuan";

/** 凭证类型 —— 多个后端可共用同一份 token（如 TRELLIS + Hunyuan 都用 HF token） */
export type Model3dCredential = "hf" | "fal";

interface Bilingual {
  zh: string;
  en: string;
}

export interface Model3dProvider {
  id: Model3dProviderId;
  label: string;               // 品牌名（语言中性，直接显示）
  credential: Model3dCredential;
  blurb: Bilingual;            // 卡片/下拉副标题
}

export const MODEL3D_PROVIDERS: Record<Model3dProviderId, Model3dProvider> = {
  trellis: {
    id: "trellis",
    label: "TRELLIS 1.0",
    credential: "hf",
    blurb: { zh: "微软 · HF Space · 免费额度", en: "Microsoft · HF Space · free quota" },
  },
  trellis2: {
    id: "trellis2",
    label: "TRELLIS 2.0",
    credential: "hf",
    blurb: { zh: "微软 · 1024 分辨率 · 更细贴图", en: "Microsoft · 1024 res · finer textures" },
  },
  hunyuan: {
    id: "hunyuan",
    label: "Hunyuan3D-2",
    credential: "hf",
    blurb: { zh: "腾讯 · HF Space · 免费额度", en: "Tencent · HF Space · free quota" },
  },
};

export const MODEL3D_PROVIDER_LIST: Model3dProvider[] = Object.values(MODEL3D_PROVIDERS);

export const DEFAULT_MODEL3D_PROVIDER: Model3dProviderId = "trellis2";

/** 凭证元信息 —— 申请提示 + 链接，按凭证类型登记一次，多后端共用 */
export const CREDENTIAL_META: Record<Model3dCredential, {
  label: string;
  hint: Bilingual;
  helpUrl: string;
}> = {
  hf: {
    label: "HuggingFace Token",
    hint: {
      zh: "在 HuggingFace「Settings → Access Tokens」创建（read 权限即可）。同一份 token 可同时用于 TRELLIS 与 Hunyuan。",
      en: "Create one under HuggingFace Settings → Access Tokens (read scope is enough). The same token works for both TRELLIS and Hunyuan.",
    },
    helpUrl: "https://huggingface.co/settings/tokens",
  },
  fal: {
    label: "fal.ai Key",
    hint: {
      zh: "在 fal.ai 控制台「API Keys」创建。",
      en: "Create one in the fal.ai dashboard under API Keys.",
    },
    helpUrl: "https://fal.ai/dashboard/keys",
  },
};

export function getModel3dProvider(id: string): Model3dProvider | undefined {
  return MODEL3D_PROVIDERS[id as Model3dProviderId];
}
