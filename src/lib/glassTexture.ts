// Glass interior canvas texture — shared singleton.
// Industry-standard architectural-visualization trick: bake the
// "warm interior visible through glass" look into a canvas texture so
// every glass panel reads as a lit room, without paying for transmission
// or rendering interior geometry through tinted glass.
import * as THREE from "three";

const GLASS_TEX_VERSION = 8;
let _glassTex: THREE.CanvasTexture | null = null;
let _glassTexVersion = 0;

export function getGlassInteriorTex(): THREE.CanvasTexture {
  if (_glassTex && _glassTexVersion === GLASS_TEX_VERSION) return _glassTex;
  if (_glassTex) { _glassTex.dispose(); _glassTex = null; }

  const W = 512, H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;

  // ① Cream ceiling → warm wall → walnut floor gradient (daylit room)
  const room = g.createLinearGradient(0, 0, 0, H);
  room.addColorStop(0.00, "#FDFAF5");
  room.addColorStop(0.10, "#F7F0E4");
  room.addColorStop(0.28, "#EDE2CE");
  room.addColorStop(0.50, "#E2D4BA");
  room.addColorStop(0.65, "#C8B898");
  room.addColorStop(0.78, "#907055");
  room.addColorStop(1.00, "#503018");
  g.fillStyle = room;
  g.fillRect(0, 0, W, H);

  // ② Recessed LED downlights — soft warm wash
  const glow1 = g.createRadialGradient(W / 2, H * 0.05, 5, W / 2, H * 0.05, W * 0.90);
  glow1.addColorStop(0,    "rgba(255,240,215,0.92)");
  glow1.addColorStop(0.22, "rgba(255,225,190,0.65)");
  glow1.addColorStop(0.55, "rgba(248,215,175,0.30)");
  glow1.addColorStop(1,    "rgba(240,210,170,0.00)");
  g.fillStyle = glow1;
  g.fillRect(0, 0, W, H * 0.72);

  // ③ Second ceiling fixture
  const glow2 = g.createRadialGradient(W * 0.62, H * 0.10, 3, W * 0.62, H * 0.10, W * 0.40);
  glow2.addColorStop(0,    "rgba(255,242,220,0.75)");
  glow2.addColorStop(0.40, "rgba(250,228,200,0.35)");
  glow2.addColorStop(1,    "rgba(245,220,190,0.00)");
  g.fillStyle = glow2;
  g.fillRect(0, 0, W, H * 0.55);

  // ④ Sheer ivory curtain drapes
  for (let cx = 18; cx < W - 12; cx += 28) {
    const primary = cx % 56 < 28;
    g.strokeStyle = `rgba(255,250,240,${primary ? 0.55 : 0.30})`;
    g.lineWidth = primary ? 8 : 4.5;
    g.beginPath();
    g.moveTo(cx, H * 0.12);
    for (let y = H * 0.12; y < H * 0.88; y += 8) {
      g.lineTo(cx + Math.sin(y * 0.10 + cx * 0.05) * 5, y);
    }
    g.stroke();
  }

  // ⑤ Furniture dark silhouette zone
  const furn = g.createLinearGradient(0, H * 0.62, 0, H);
  furn.addColorStop(0,    "rgba(60,40,20,0.00)");
  furn.addColorStop(0.12, "rgba(60,40,20,0.42)");
  furn.addColorStop(0.48, "rgba(48,30,14,0.68)");
  furn.addColorStop(1,    "rgba(36,22,10,0.85)");
  g.fillStyle = furn;
  g.fillRect(0, H * 0.62, W, H * 0.38);

  // ⑥ Warm table-top highlight strip
  const tbl = g.createLinearGradient(0, H * 0.68, 0, H * 0.75);
  tbl.addColorStop(0,   "rgba(220,180,100,0.00)");
  tbl.addColorStop(0.3, "rgba(220,180,100,0.55)");
  tbl.addColorStop(0.7, "rgba(220,180,100,0.55)");
  tbl.addColorStop(1,   "rgba(220,180,100,0.00)");
  g.fillStyle = tbl;
  g.fillRect(W * 0.08, H * 0.68, W * 0.84, H * 0.075);

  // ⑦ LED cove edge highlight
  const coveLight = g.createLinearGradient(0, 0, 0, H * 0.08);
  coveLight.addColorStop(0, "rgba(255,240,200,0.80)");
  coveLight.addColorStop(1, "rgba(255,235,195,0.00)");
  g.fillStyle = coveLight;
  g.fillRect(0, 0, W, H * 0.08);

  // ⑧ Diagonal daylight wash
  const spec = g.createLinearGradient(0, H * 0.05, W * 0.45, H * 0.55);
  spec.addColorStop(0,    "rgba(255,248,235,0.00)");
  spec.addColorStop(0.28, "rgba(255,248,235,0.22)");
  spec.addColorStop(0.52, "rgba(255,242,225,0.32)");
  spec.addColorStop(0.72, "rgba(255,238,215,0.12)");
  spec.addColorStop(1,    "rgba(255,235,210,0.00)");
  g.fillStyle = spec;
  g.fillRect(0, 0, W, H);

  _glassTex = new THREE.CanvasTexture(cv);
  _glassTex.needsUpdate = true;
  _glassTexVersion = GLASS_TEX_VERSION;
  return _glassTex;
}
