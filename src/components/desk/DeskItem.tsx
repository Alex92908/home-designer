"use client";

/**
 * DeskItem — renders a single placed item as a stylized 3D object.
 * Dispatches geometry by `category` and applies PBR material from the
 * catalog spec. This is the "procedural baseline" — when we wire real
 * glTF assets later, only this component needs updating.
 */

import { memo, useMemo } from "react";
import type { PlacedItem } from "@/lib/desk/store";
import type { CatalogItem } from "@/lib/desk/catalog";
import { getCatalogItem } from "@/lib/desk/catalog";
import { MATERIAL_MAP, type MaterialSpec } from "./materials";

/** Convert cm → m for Three.js world units */
const CM = (v: number) => v / 100;

interface Props {
  placed:     PlacedItem;
  selected:   boolean;
  onSelect:   (id: string) => void;
}

function makeMaterialProps(spec: MaterialSpec) {
  return {
    color:              spec.color,
    roughness:          spec.roughness,
    metalness:          spec.metalness,
    emissive:           spec.emissive,
    emissiveIntensity:  spec.emissiveIntensity,
  };
}

function makePhysicalProps(spec: MaterialSpec) {
  return {
    color:              spec.color,
    roughness:          spec.roughness,
    metalness:          spec.metalness,
    transmission:       spec.transmission,
    ior:                spec.ior,
    thickness:          spec.thickness,
    clearcoat:          spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    emissive:           spec.emissive,
    emissiveIntensity:  spec.emissiveIntensity,
  };
}

function Mat({ spec }: { spec: MaterialSpec }) {
  if (spec.kind === "physical") {
    return <meshPhysicalMaterial {...makePhysicalProps(spec)} />;
  }
  return <meshStandardMaterial {...makeMaterialProps(spec)} />;
}

// ────────────────────────────────────────────────────────
// Per-category geometry renderers
// ────────────────────────────────────────────────────────

function Desk({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const matSpec   = MATERIAL_MAP[cat.material];
  const accSpec   = MATERIAL_MAP[cat.accent ?? "metal-black"];
  const legT      = 0.035; // leg thickness (m)
  const topT      = 0.035; // top thickness (m)
  return (
    <group>
      {/* top */}
      <mesh castShadow receiveShadow position={[0, h - topT / 2, 0]}>
        <boxGeometry args={[w, topT, d]} />
        <Mat spec={matSpec} />
      </mesh>
      {/* 4 legs */}
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
        <mesh
          key={i}
          castShadow
          position={[sx * (w / 2 - legT), (h - topT) / 2, sz * (d / 2 - legT)]}
        >
          <boxGeometry args={[legT, h - topT, legT]} />
          <Mat spec={accSpec} />
        </mesh>
      ))}
    </group>
  );
}

function Monitor({ cat }: { cat: CatalogItem }) {
  const [w, , h] = cat.size.map(CM);
  const panelT   = 0.025;
  const standH   = 0.12;
  const baseR    = 0.11;
  const mat      = MATERIAL_MAP[cat.material];
  const acc      = MATERIAL_MAP[cat.accent ?? "plastic-black"];
  return (
    <group>
      {/* base */}
      <mesh castShadow position={[0, -h / 2 - standH + 0.015, 0]}>
        <cylinderGeometry args={[baseR, baseR, 0.03, 24]} />
        <Mat spec={acc} />
      </mesh>
      {/* stand */}
      <mesh castShadow position={[0, -h / 2 - standH / 2, 0]}>
        <boxGeometry args={[0.04, standH, 0.04]} />
        <Mat spec={acc} />
      </mesh>
      {/* bezel (slightly larger than screen, so screen glows out of it) */}
      <mesh castShadow position={[0, 0, -panelT / 2 - 0.002]}>
        <boxGeometry args={[w + 0.01, h + 0.01, 0.01]} />
        <Mat spec={acc} />
      </mesh>
      {/* screen panel */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[w, h, panelT]} />
        <Mat spec={mat} />
      </mesh>
    </group>
  );
}

function Chair({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "metal-black"];
  const seatH     = 0.48;   // seat height (m)
  const seatT     = 0.08;
  const backT     = 0.06;
  const backH     = h - seatH - 0.05;
  return (
    <group>
      {/* seat cushion */}
      <mesh castShadow position={[0, seatH + seatT / 2, 0]}>
        <boxGeometry args={[w, seatT, d]} />
        <Mat spec={mat} />
      </mesh>
      {/* backrest */}
      <mesh castShadow position={[0, seatH + seatT + backH / 2, -d / 2 + backT / 2]}>
        <boxGeometry args={[w * 0.85, backH, backT]} />
        <Mat spec={mat} />
      </mesh>
      {/* base column */}
      <mesh castShadow position={[0, seatH / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, seatH, 12]} />
        <Mat spec={acc} />
      </mesh>
      {/* 5-star base */}
      {[0, 1, 2, 3, 4].map(i => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh
            key={i}
            castShadow
            position={[Math.sin(angle) * 0.25, 0.04, Math.cos(angle) * 0.25]}
            rotation={[0, angle, 0]}
          >
            <boxGeometry args={[0.05, 0.04, 0.32]} />
            <Mat spec={acc} />
          </mesh>
        );
      })}
    </group>
  );
}

function Lamp({ cat }: { cat: CatalogItem }) {
  const [w, , h] = cat.size.map(CM);
  const mat      = MATERIAL_MAP[cat.material];
  const acc      = MATERIAL_MAP[cat.accent ?? "plastic-white"];
  // Accent is the bulb/strip (emissive); mat is the body
  const isBar    = cat.id === "lamp-rgb-bar";
  if (isBar) {
    return (
      <mesh castShadow>
        <boxGeometry args={[w, 0.03, 0.03]} />
        <Mat spec={mat} />
      </mesh>
    );
  }
  return (
    <group>
      {/* base */}
      <mesh castShadow position={[0, 0.02, 0]}>
        <cylinderGeometry args={[w / 2, w / 2 + 0.01, 0.04, 20]} />
        <Mat spec={mat} />
      </mesh>
      {/* stem */}
      <mesh castShadow position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.015, 0.015, h - 0.08, 12]} />
        <Mat spec={mat} />
      </mesh>
      {/* bulb / shade */}
      <mesh castShadow position={[0, h - 0.04, 0]}>
        <sphereGeometry args={[0.06, 20, 16]} />
        <Mat spec={acc} />
      </mesh>
    </group>
  );
}

function Keyboard({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "plastic-white"];
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <Mat spec={mat} />
      </mesh>
      {/* subtle keycap grid suggestion */}
      <mesh position={[0, h / 2 + 0.002, 0]}>
        <boxGeometry args={[w - 0.02, 0.003, d - 0.02]} />
        <Mat spec={acc} />
      </mesh>
    </group>
  );
}

function Mouse({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  return (
    <mesh castShadow receiveShadow scale={[w, h, d]}>
      {/* rounded by scaled sphere */}
      <sphereGeometry args={[0.5, 24, 16]} />
      <Mat spec={mat} />
    </mesh>
  );
}

function PC({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "glass"];
  // Mac Studio is a flat box, no side panel
  const isMac = cat.id === "pc-mac-studio";
  if (isMac) {
    return (
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <Mat spec={mat} />
      </mesh>
    );
  }
  return (
    <group>
      {/* chassis */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <Mat spec={mat} />
      </mesh>
      {/* glass side panel */}
      <mesh castShadow position={[w / 2 + 0.001, 0, 0]}>
        <boxGeometry args={[0.005, h - 0.06, d - 0.04]} />
        <Mat spec={acc} />
      </mesh>
    </group>
  );
}

function Decor({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? cat.material];

  if (cat.id === "decor-plant") {
    return (
      <group>
        {/* pot */}
        <mesh castShadow position={[0, h * 0.2, 0]}>
          <cylinderGeometry args={[w / 2 * 0.7, w / 2 * 0.55, h * 0.4, 16]} />
          <Mat spec={mat} />
        </mesh>
        {/* leaves */}
        {[0, 1, 2].map(i => (
          <mesh
            key={i}
            castShadow
            position={[Math.sin(i * 2.1) * 0.04, h * 0.5 + i * 0.06, Math.cos(i * 2.1) * 0.04]}
            rotation={[0.2 * i, i, 0]}
          >
            <sphereGeometry args={[w / 2 * 0.55, 12, 10]} />
            <meshStandardMaterial color="#3a6a3a" roughness={0.75} />
          </mesh>
        ))}
      </group>
    );
  }

  if (cat.id === "decor-book") {
    // Stack of 2 books, rotated slightly for visual interest
    return (
      <group>
        <mesh castShadow position={[0, h / 2, 0]} rotation={[0, 0.15, 0]}>
          <boxGeometry args={[w, h * 0.6, d]} />
          <Mat spec={mat} />
        </mesh>
        <mesh castShadow position={[0.01, h * 0.75 + 0.008, 0.005]} rotation={[0, -0.1, 0]}>
          <boxGeometry args={[w * 0.9, h * 0.35, d * 0.9]} />
          <Mat spec={acc} />
        </mesh>
      </group>
    );
  }

  if (cat.id === "decor-speaker") {
    return (
      <group>
        <mesh castShadow>
          <boxGeometry args={[w, h, d]} />
          <Mat spec={mat} />
        </mesh>
        <mesh position={[0, 0, d / 2 + 0.001]}>
          <circleGeometry args={[Math.min(w, h) * 0.35, 24]} />
          <Mat spec={acc} />
        </mesh>
      </group>
    );
  }

  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <Mat spec={mat} />
    </mesh>
  );
}

// ────────────────────────────────────────────────────────

const DeskItemInner = memo(function DeskItemInner({ placed, selected, onSelect }: Props) {
  const cat = useMemo(() => getCatalogItem(placed.catalogId), [placed.catalogId]);
  if (!cat) return null;

  // Selection highlight: a thin glowing ring under the item on the desk
  // surface. Positioned at the item's base in world Y.
  const selectionRing = selected ? (
    <mesh
      position={[0, -0.005, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.18, 0.22, 32]} />
      <meshBasicMaterial color="#6366f1" transparent opacity={0.8} />
    </mesh>
  ) : null;

  return (
    <group
      position={placed.position}
      rotation={[0, placed.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(placed.id); }}
    >
      {cat.category === "desk"     && <Desk cat={cat} />}
      {cat.category === "monitor"  && <Monitor cat={cat} />}
      {cat.category === "chair"    && <Chair cat={cat} />}
      {cat.category === "lamp"     && <Lamp cat={cat} />}
      {cat.category === "keyboard" && <Keyboard cat={cat} />}
      {cat.category === "mouse"    && <Mouse cat={cat} />}
      {cat.category === "pc"       && <PC cat={cat} />}
      {cat.category === "decor"    && <Decor cat={cat} />}
      {selectionRing}
    </group>
  );
});

export default DeskItemInner;
