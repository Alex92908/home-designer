/**
 * watermark — 给导出/下载的图片右下角盖品牌水印「筑雅 ZHUYA · zhuyahome.com」。
 * 每张被用户分享出去的图都成了引流入口。纯浏览器端 canvas，CJK 正常渲染。
 *
 * 用 Blob 进出：调用方先 fetch 成 blob（blob URL 同源，不会污染 canvas、
 * toBlob 不会因跨域抛错）。
 */

const BRAND_TEXT = "筑雅 ZHUYA · zhuyahome.com";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 在 canvas 右下角画品牌水印（半透明深色胶囊 + 白字）。 */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pad = Math.max(10, Math.round(w * 0.018));
  const fontSize = Math.max(13, Math.round(w * 0.021));
  ctx.font = `600 ${fontSize}px -apple-system, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(BRAND_TEXT).width;
  const boxPadX = fontSize * 0.7;
  const boxPadY = fontSize * 0.5;
  const boxW = tw + boxPadX * 2;
  const boxH = fontSize + boxPadY * 2;
  const x = w - boxW - pad;
  const y = h - boxH - pad;
  ctx.save();
  ctx.fillStyle = "rgba(15,17,23,0.5)";
  roundRect(ctx, x, y, boxW, boxH, boxH / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(BRAND_TEXT, x + boxPadX, y + boxH / 2 + 1);
  ctx.restore();
}

/** 给一张图片 blob 盖水印，返回新的 PNG blob。失败时回退原 blob。 */
export async function watermarkBlob(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), "image/png"),
    );
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
