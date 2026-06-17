/**
 * 一次性脚本：把下载的「Japanese squat toilet」(936dcb6b) 收拾成可用的家具件。
 * 原模型 = 蹲便坑本体(mesh0, 5.7w 面) + 两块铺满 18MB 瓷砖贴图的大地面/墙
 * (mesh1/mesh2)。后两者既臃肿又导致包围盒被撑大。这里：
 *   1. 只保留坑本体，删掉两块瓷砖面 + 它们的材质/贴图；
 *   2. 按坑的世界包围盒，新建一块薄底座(footprint×1.5、高=坑高×0.28)，
 *      让坑「镶嵌」在底座中央、坑口与底座面齐平；
 *   3. dedup + weld + prune + draco 压缩，输出 squat_toilet.glb。
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, draco } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const DIR = "public/models/toilet/squat_toilet";
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });

const doc = await io.read(`${DIR}/squat_toilet.gltf`);
const root = doc.getRoot();

// ── 1) 找坑本体（材质 Material.001 / 名字含 Cube.076），其余 mesh 视作瓷砖面删除
const keepMeshName = "Cube.076";
let panMesh = null;
for (const mesh of root.listMeshes()) {
  if ((mesh.getName() || "").includes(keepMeshName)) panMesh = mesh;
}
if (!panMesh) throw new Error("找不到坑本体 mesh");

// 删掉所有「不是坑本体」的网格节点
for (const node of root.listNodes()) {
  const m = node.getMesh();
  if (m && m !== panMesh) {
    node.setMesh(null);
    node.dispose();
  }
}

// ── 2) 量坑的世界包围盒（遍历节点累计变换）──
function mulVec(m, v) {
  return [
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14],
  ];
}
const lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
for (const node of root.listNodes()) {
  if (node.getMesh() !== panMesh) continue;
  const wm = node.getWorldMatrix();
  for (const prim of panMesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const min = pos.getMinNormalized([]), max = pos.getMaxNormalized([]);
    // getMin/Max 给的是归一化前的；用原始 min/max
    const mn = pos.getMin([]), mx = pos.getMax([]);
    for (let cx=0;cx<2;cx++) for (let cy=0;cy<2;cy++) for (let cz=0;cz<2;cz++){
      const w = mulVec(wm, [cx?mx[0]:mn[0], cy?mx[1]:mn[1], cz?mx[2]:mn[2]]);
      for (let k=0;k<3;k++){ lo[k]=Math.min(lo[k],w[k]); hi[k]=Math.max(hi[k],w[k]); }
    }
  }
}
const sz = [hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]];
const ctr = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2];
console.log("坑世界尺寸:", sz.map(v=>v.toFixed(2)).join("×"));

// ── 3) 新建薄底座：footprint = 坑 XZ × 1.5，高 = 坑高 × 0.28，顶面与坑口齐平 ──
const padW = sz[0]*1.5, padD = sz[2]*1.5, padH = sz[1]*0.28;
const padTopY = hi[1];               // 与坑口齐平
const cx = ctr[0], cz = ctr[2];
const x0 = cx-padW/2, x1 = cx+padW/2, y0 = padTopY-padH, y1 = padTopY, z0 = cz-padD/2, z1 = cz+padD/2;

// 8 顶点的盒子（每面独立法线，24 顶点/36 索引）
const faces = [
  // [normal, 4 corners ccw]
  [[0,1,0],[[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]]], // top
  [[0,-1,0],[[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]]],// bottom
  [[0,0,1],[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]], // +z
  [[0,0,-1],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]],// -z
  [[1,0,0],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]], // +x
  [[-1,0,0],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]],// -x
];
const pos=[], nor=[], idx=[];
let vi=0;
for (const [n, c] of faces) {
  for (const p of c){ pos.push(...p); nor.push(...n); }
  idx.push(vi,vi+1,vi+2, vi,vi+2,vi+3); vi+=4;
}
const buf = root.listBuffers()[0];
const aPos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buf);
const aNor = doc.createAccessor().setType("VEC3").setArray(new Float32Array(nor)).setBuffer(buf);
const aIdx = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buf);
const padMat = doc.createMaterial("PadTile")
  .setBaseColorFactor([0.86,0.86,0.84,1]).setRoughnessFactor(0.55).setMetallicFactor(0.0);
const padPrim = doc.createPrimitive().setAttribute("POSITION",aPos).setAttribute("NORMAL",aNor).setIndices(aIdx).setMaterial(padMat);
const padMesh = doc.createMesh("SquatPad").addPrimitive(padPrim);
const padNode = doc.createNode("SquatPadNode").setMesh(padMesh);
root.listScenes()[0].addChild(padNode);

// ── 4) 清理 + 压缩 ──
await doc.transform(prune(), dedup(), weld(), draco());
await io.write(`${DIR}/squat_toilet.glb`, doc);
console.log("✓ 输出 squat_toilet.glb（坑本体 + 薄底座，已 draco）");
