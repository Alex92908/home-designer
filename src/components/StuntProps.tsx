/**
 * StuntProps —— 特技道具的程序化几何（不引新模型文件）。
 *
 * 固定道具（树/车/火车/马/摩托/直升机/墙/平台/山坡/桥/绳索）由
 * StuntPropMesh 按 kind 画；飞行载具（剑/扫帚/飞板）随人走，
 * 由 FlyingVehicleMesh 挂在演员脚下（飞行时才出现）；吊威亚的钢丝
 * 同样挂在演员身上（一条向上的细线）。
 */
import type { StuntProp, StuntPropKind } from "@/lib/stuntProps";

/** 静态特技道具（放在场景里不动） */
export function StuntPropMesh({ prop }: { prop: StuntProp }) {
  const rotY = prop.rotation ?? 0;
  const s = prop.scale ?? 1;
  return (
    <group position={[prop.x, 0, prop.z]} rotation={[0, rotY, 0]} scale={[s, s, s]}>
      {prop.kind === "tree" && (
        <group>
          <mesh position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.3, 2.2, 8]} />
            <meshStandardMaterial color="#7a5230" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.7, 0]} castShadow>
            <sphereGeometry args={[1.25, 12, 10]} />
            <meshStandardMaterial color="#4a7c3a" roughness={0.9} />
          </mesh>
          <mesh position={[0.7, 2.2, 0.3]} castShadow>
            <sphereGeometry args={[0.85, 12, 10]} />
            <meshStandardMaterial color="#5a8c46" roughness={0.9} />
          </mesh>
          <mesh position={[-0.6, 2.3, -0.3]} castShadow>
            <sphereGeometry args={[0.8, 12, 10]} />
            <meshStandardMaterial color="#3f6d31" roughness={0.9} />
          </mesh>
        </group>
      )}
      {prop.kind === "car" && (
        <group>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[4.2, 0.7, 1.8]} />
            <meshStandardMaterial color="#5b7fa6" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[-0.3, 1.2, 0]} castShadow>
            <boxGeometry args={[2.2, 0.6, 1.6]} />
            <meshStandardMaterial color="#3e5a78" roughness={0.4} metalness={0.3} />
          </mesh>
          {[[-1.4, 0.75], [1.4, 0.75], [-1.4, -0.75], [1.4, -0.75]].map(([wx, wz], i) => (
            <mesh key={i} position={[wx, 0.35, wz]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.35, 0.35, 0.25, 12]} />
              <meshStandardMaterial color="#22252a" roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}
      {prop.kind === "train" && (
        <group>
          <mesh position={[0, 1.6, 0]} castShadow>
            <boxGeometry args={[10, 2.6, 2.8]} />
            <meshStandardMaterial color="#7a4a3a" roughness={0.7} />
          </mesh>
          <mesh position={[0, 2.95, 0]} castShadow>
            <boxGeometry args={[9.6, 0.25, 2.4]} />
            <meshStandardMaterial color="#5d3a2e" roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.9, 1.42]}>
            <boxGeometry args={[9.2, 0.7, 0.05]} />
            <meshStandardMaterial color="#9fc4d8" roughness={0.3} metalness={0.4} />
          </mesh>
          <mesh position={[0, 1.9, -1.42]}>
            <boxGeometry args={[9.2, 0.7, 0.05]} />
            <meshStandardMaterial color="#9fc4d8" roughness={0.3} metalness={0.4} />
          </mesh>
        </group>
      )}
      {prop.kind === "horse" && (
        <group>
          <mesh position={[0, 1.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.42, 1.3, 4, 10]} />
            <meshStandardMaterial color="#8a5a34" roughness={0.85} />
          </mesh>
          <mesh position={[1.0, 1.6, 0]} rotation={[0, 0, -0.6]} castShadow>
            <boxGeometry args={[0.35, 0.9, 0.35]} />
            <meshStandardMaterial color="#8a5a34" roughness={0.85} />
          </mesh>
          <mesh position={[1.35, 1.95, 0]} castShadow>
            <boxGeometry args={[0.55, 0.3, 0.28]} />
            <meshStandardMaterial color="#7a4e2c" roughness={0.85} />
          </mesh>
          {[[0.7, 0.25], [0.7, -0.25], [-0.7, 0.25], [-0.7, -0.25]].map(([lx, lz], i) => (
            <mesh key={i} position={[lx, 0.45, lz]} castShadow>
              <cylinderGeometry args={[0.09, 0.09, 0.9, 8]} />
              <meshStandardMaterial color="#6e4426" roughness={0.85} />
            </mesh>
          ))}
        </group>
      )}
      {prop.kind === "motorcycle" && (
        <group>
          <mesh position={[0, 0.7, 0]} castShadow>
            <boxGeometry args={[1.8, 0.45, 0.45]} />
            <meshStandardMaterial color="#b03a3a" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0.55, 0.95, 0]} castShadow>
            <boxGeometry args={[0.5, 0.35, 0.4]} />
            <meshStandardMaterial color="#33383f" roughness={0.6} />
          </mesh>
          {[[-0.75, 0], [0.75, 0]].map(([wx, wz], i) => (
            <mesh key={i} position={[wx, 0.35, wz]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.35, 0.35, 0.15, 14]} />
              <meshStandardMaterial color="#22252a" roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0.85, 1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
            <meshStandardMaterial color="#888" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      )}
      {prop.kind === "helicopter" && (
        <group>
          <mesh position={[0, 1.7, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.8, 2.2, 4, 12]} />
            <meshStandardMaterial color="#4a6b8a" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[-2.6, 1.9, 0]} rotation={[0, 0, 0.15]} castShadow>
            <boxGeometry args={[2.6, 0.35, 0.35]} />
            <meshStandardMaterial color="#4a6b8a" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <boxGeometry args={[5.5, 0.06, 0.3]} />
            <meshStandardMaterial color="#33383f" roughness={0.5} />
          </mesh>
          {[[-0.7, 0.6], [0.7, 0.6], [-0.7, -0.6], [0.7, -0.6]].map(([sx, sz], i) => (
            <mesh key={i} position={[sx, 0.15, sz]}>
              <boxGeometry args={[0.08, 0.3, 0.08]} />
              <meshStandardMaterial color="#33383f" roughness={0.6} />
            </mesh>
          ))}
        </group>
      )}
      {prop.kind === "wall" && (
        <mesh position={[0, 1.1, 0]} castShadow>
          <boxGeometry args={[6, 2.2, 0.4]} />
          <meshStandardMaterial color="#b8a88a" roughness={0.9} />
        </mesh>
      )}
      {prop.kind === "platform" && (
        <mesh position={[0, 1.5, 0]} castShadow>
          <boxGeometry args={[5, 3, 4]} />
          <meshStandardMaterial color="#9a8f7a" roughness={0.9} />
        </mesh>
      )}
      {prop.kind === "slope" && (
        <group>
          <mesh position={[0, 1.25, 0]} rotation={[0, 0, -0.395]} castShadow>
            <boxGeometry args={[6.5, 0.3, 4]} />
            <meshStandardMaterial color="#8a7a5a" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[6.5, 0.3, 4]} />
            <meshStandardMaterial color="#6e6046" roughness={0.95} />
          </mesh>
        </group>
      )}
      {prop.kind === "bridge" && (
        <group>
          <mesh position={[0, 1.85, 0]} castShadow>
            <boxGeometry args={[8, 0.3, 2]} />
            <meshStandardMaterial color="#8a6a4a" roughness={0.85} />
          </mesh>
          {[0.95, -0.95].map((rz, i) => (
            <mesh key={i} position={[0, 2.4, rz]} castShadow>
              <boxGeometry args={[8, 0.8, 0.1]} />
              <meshStandardMaterial color="#6e5238" roughness={0.85} />
            </mesh>
          ))}
          {[[-3, 0], [3, 0]].map(([sx, sz], i) => (
            <mesh key={i} position={[sx, 0.85, sz]} castShadow>
              <boxGeometry args={[0.5, 1.7, 1.8]} />
              <meshStandardMaterial color="#7a7a7a" roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}
      {prop.kind === "rope" && (
        <group>
          <mesh position={[0, 1.75, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 3.5, 6]} />
            <meshStandardMaterial color="#c8b88a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 3.55, 0]} castShadow>
            <boxGeometry args={[0.4, 0.15, 0.4]} />
            <meshStandardMaterial color="#555" roughness={0.7} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** 飞行载具（挂在演员脚下，随人走）：剑 / 扫帚 / 飞板 */
export function FlyingVehicleMesh({ kind }: { kind: StuntPropKind }) {
  if (kind === "sword") {
    return (
      <group position={[0, 0.02, 0.05]}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[1.15, 0.035, 0.12]} />
          <meshStandardMaterial color="#c8d4e0" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.05, 0.05, 0.32]} />
          <meshStandardMaterial color="#b08a3a" roughness={0.5} metalness={0.5} />
        </mesh>
      </group>
    );
  }
  if (kind === "broom") {
    return (
      <group position={[0, 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh>
          <cylinderGeometry args={[0.035, 0.035, 1.3, 8]} />
          <meshStandardMaterial color="#7a5230" roughness={0.9} />
        </mesh>
        <mesh position={[0.75, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.16, 0.45, 8]} />
          <meshStandardMaterial color="#c8a83a" roughness={0.95} />
        </mesh>
      </group>
    );
  }
  if (kind === "flyboard") {
    return (
      <group position={[0, 0.02, 0]}>
        <mesh>
          <boxGeometry args={[1.0, 0.07, 0.6]} />
          <meshStandardMaterial color="#3a4a5a" roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.9, 0.02, 0.5]} />
          <meshStandardMaterial color="#2dd4bf" roughness={0.3} metalness={0.2} emissive="#0a4a42" />
        </mesh>
      </group>
    );
  }
  return null;
}

/** 吊威亚的钢丝（挂在演员头顶向上） */
export function WireMesh() {
  return (
    <mesh position={[0, 2.2, 0]}>
      <cylinderGeometry args={[0.012, 0.012, 3.2, 6]} />
      <meshStandardMaterial color="#888" roughness={0.4} metalness={0.7} />
    </mesh>
  );
}
