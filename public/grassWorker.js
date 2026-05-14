/**
 * Web Worker: generates the procedural grass texture off the main thread.
 * Uses OffscreenCanvas so the 512×512 canvas 2D work doesn't block React.
 * The finished ImageBitmap is transferred (zero-copy) back to the main thread.
 */
self.onmessage = function () {
  const RES = 512;
  const canvas = new OffscreenCanvas(RES, RES);
  const ctx = canvas.getContext("2d");

  // Base fill
  ctx.fillStyle = "#3B5E1E";
  ctx.fillRect(0, 0, RES, RES);

  // Organic patches
  for (let i = 0; i < 160; i++) {
    const x  = Math.random() * RES;
    const y  = Math.random() * RES;
    const rx = 12 + Math.random() * 55;
    const ry = rx * (0.55 + Math.random() * 0.9);
    const rot = Math.random() * Math.PI;
    const isLight = Math.random() > 0.42;
    const alpha   = 0.07 + Math.random() * 0.11;
    const col = isLight ? `rgba(78,118,28,${alpha})` : `rgba(18,42,5,${alpha})`;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Per-pixel noise
  const imgData = ctx.getImageData(0, 0, RES, RES);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n * 0.35));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.75));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.20));
  }
  ctx.putImageData(imgData, 0, 0);

  canvas.convertToBlob({ type: "image/png" }).then(blob => {
    createImageBitmap(blob).then(bitmap => {
      self.postMessage({ bitmap }, [bitmap]);
    });
  });
};
