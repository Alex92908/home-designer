#!/usr/bin/env python3
"""
Download Hunyuan3D-2 model weights for ComfyUI.

Usage:
    python scripts/download-hunyuan3d.py

Models downloaded (~6.4 GB total):
  - Hunyuan3D-2 diffusion model  (tencent/Hunyuan3D-2)
  - Hunyuan3D-2 VAE              (tencent/Hunyuan3D-2)
  - SigCLIP vision encoder       (Comfy-Org/sigclip_vision_384)

镜像说明（国内无需翻墙）：
  默认使用 hf-mirror.com 镜像，速度快且稳定。
  如果在海外或已开启代理，可在脚本顶部将 MIRROR 改为 "huggingface.co"。

After download, restart ComfyUI and use the "hunyuan3d" mode in /api/comfyui-3d.
"""

import os
import sys
import urllib.request
from pathlib import Path

COMFYUI = Path.home() / "Documents" / "ComfyUI"

# ── 国内镜像（无需翻墙）──────────────────────────────────────────────
# hf-mirror.com 是 HuggingFace 的国内加速镜像，直接替换域名即可
# 如需使用官方源（需翻墙），改为 "huggingface.co"
MIRROR = "hf-mirror.com"

def hf(repo: str, path: str) -> str:
    """把 HuggingFace 路径转为镜像 URL"""
    return f"https://{MIRROR}/{repo}/resolve/main/{path}"

MODELS = [
    # ── Hunyuan3D-2 diffusion (shape generation backbone)
    {
        "url": hf("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0/model.safetensors"),
        "dest": COMFYUI / "models" / "diffusion_models" / "hunyuan3d-dit-v2-0.safetensors",
        "size_gb": 5.0,
        "desc": "Hunyuan3D-2 DIT 扩散模型（主体）",
    },
    # ── Hunyuan3D-2 VAE (shape decoder)
    {
        "url": hf("tencent/Hunyuan3D-2", "hunyuan3d-vae-v2-0/model.fp16.safetensors"),
        "dest": COMFYUI / "models" / "vae" / "hunyuan3d-vae-v2-0.safetensors",
        "size_gb": 0.5,
        "desc": "Hunyuan3D-2 VAE 解码器",
    },
    # ── SigCLIP vision encoder (image features → Hunyuan3D conditioning)
    {
        "url": hf("Comfy-Org/sigclip_vision_384", "sigclip_vision_patch14_384.safetensors"),
        "dest": COMFYUI / "models" / "clip_vision" / "sigclip_vision_patch14_384.safetensors",
        "size_gb": 0.9,
        "desc": "SigCLIP 视觉编码器（384px）",
    },
]

def download(url: str, dest: Path, desc: str, size_gb: float):
    if dest.exists():
        print(f"  ✓ Already exists: {dest.name}")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  ↓ Downloading {desc} (~{size_gb:.1f} GB)…")
    print(f"    {url}")

    def progress(block, block_size, total):
        if total > 0:
            pct = min(100, block * block_size * 100 // total)
            done = "█" * (pct // 5)
            empty = "░" * (20 - len(done))
            print(f"\r    [{done}{empty}] {pct}%", end="", flush=True)

    tmp = dest.with_suffix(".tmp")
    try:
        urllib.request.urlretrieve(url, tmp, progress)
        print()
        tmp.rename(dest)
        print(f"  ✓ Saved to {dest}")
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"\n  ✗ Failed: {e}")
        raise

def main():
    print("=" * 60)
    print("  Hunyuan3D-2 模型下载（ComfyUI）")
    print(f"  下载源: {MIRROR}")
    print(f"  ComfyUI 路径: {COMFYUI}")
    print("=" * 60)

    if not COMFYUI.exists():
        print(f"\n✗ ComfyUI not found at {COMFYUI}")
        print("  Edit COMFYUI path at the top of this script")
        sys.exit(1)

    total_gb = sum(m["size_gb"] for m in MODELS
                   if not (COMFYUI / m["dest"]).exists()
                       if not Path(str(m["dest"])).exists())
    print(f"\nTotal to download: ~{total_gb:.1f} GB\n")

    for m in MODELS:
        download(m["url"], Path(str(m["dest"])), m["desc"], m["size_gb"])

    print("\n" + "=" * 60)
    print("  All models ready!")
    print("  Restart ComfyUI, then use mode='hunyuan3d' in the app.")
    print("=" * 60)

if __name__ == "__main__":
    main()
