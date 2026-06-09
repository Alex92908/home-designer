// ─── 图生 3D BYOK 密钥 ──────────────────────────────────────────────────────
//
// 与大模型密钥 [[aiKeys]] 分开存储。按「凭证类型」（hf / fal）存，而非按后端 ——
// 这样 TRELLIS + Hunyuan 共用同一份 HF token，用户只填一次。后端注册表见
// [[model3dProviders]]。
//
// 密钥只存浏览器 localStorage，随请求传给本站代理 /api/model-3d，绝不落服务端、
// 不被回显。另记一个「当前选中的后端」，下次出图直接沿用上次选的那家。

import {
  Model3dCredential,
  Model3dProviderId,
  DEFAULT_MODEL3D_PROVIDER,
} from "./model3dProviders";

const KEYS_STORAGE     = "home-designer-3d-keys";
const PROVIDER_STORAGE = "home-designer-3d-provider";

type CredMap = Partial<Record<Model3dCredential, string>>;

function readMap(): CredMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEYS_STORAGE);
    return raw ? (JSON.parse(raw) as CredMap) : {};
  } catch {
    return {};
  }
}

/** 取某类凭证的 BYOK 密钥（无则空串） */
export function getModel3dKey(cred: Model3dCredential): string {
  return readMap()[cred]?.trim() ?? "";
}

/** 写入 / 更新某类凭证（空串视为清除） */
export function setModel3dKey(cred: Model3dCredential, key: string): void {
  if (typeof window === "undefined") return;
  const map = readMap();
  const trimmed = key.trim();
  if (trimmed) map[cred] = trimmed;
  else delete map[cred];
  window.localStorage.setItem(KEYS_STORAGE, JSON.stringify(map));
}

/** 当前选中的 3D 后端（默认 TRELLIS 2.0） */
export function getSelected3dProvider(): Model3dProviderId {
  if (typeof window === "undefined") return DEFAULT_MODEL3D_PROVIDER;
  const v = window.localStorage.getItem(PROVIDER_STORAGE);
  return (v as Model3dProviderId) || DEFAULT_MODEL3D_PROVIDER;
}

/** 记住用户选的后端 */
export function setSelected3dProvider(id: Model3dProviderId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROVIDER_STORAGE, id);
}
