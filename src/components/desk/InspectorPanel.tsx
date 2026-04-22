"use client";

/**
 * InspectorPanel — right side: environment picker + selected-item controls.
 * Keeps the footprint small; can grow as more per-item tuning is needed.
 */

import { useDeskStore, type EnvPreset } from "@/lib/desk/store";
import { getCatalogItem } from "@/lib/desk/catalog";

const ENV_PRESETS: { id: EnvPreset; label: string; swatch: string }[] = [
  { id: "studio",    label: "工作室",   swatch: "#e9e9ed" },
  { id: "apartment", label: "暖光室内", swatch: "#d9c6a8" },
  { id: "sunset",    label: "落日",     swatch: "#e8823f" },
  { id: "dawn",      label: "黎明",     swatch: "#8da7c7" },
  { id: "warehouse", label: "仓库",     swatch: "#4a4a50" },
  { id: "city",      label: "赛博夜",   swatch: "#6a3ef0" },
];

export default function InspectorPanel() {
  const env        = useDeskStore(s => s.env);
  const setEnv     = useDeskStore(s => s.setEnv);
  const selectedId = useDeskStore(s => s.selectedId);
  const items      = useDeskStore(s => s.items);
  const moveItem   = useDeskStore(s => s.moveItem);
  const rotateItem = useDeskStore(s => s.rotateItem);
  const removeItem = useDeskStore(s => s.removeItem);

  const selected = items.find(i => i.id === selectedId);
  const cat      = selected ? getCatalogItem(selected.catalogId) : null;

  return (
    <aside
      className="flex flex-col h-full border-l border-gray-800 bg-[#0f0f12] text-gray-200"
      style={{ width: 260 }}
    >
      {/* Environment */}
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
          环境光
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {ENV_PRESETS.map(e => {
            const active = env === e.id;
            return (
              <button
                key={e.id}
                onClick={() => setEnv(e.id)}
                className="flex flex-col items-center gap-1 py-1.5 rounded-lg border transition-colors"
                style={{
                  borderColor: active ? "#6366f1" : "#1f1f24",
                  background:  active ? "rgba(99,102,241,0.12)" : "#141418",
                }}
              >
                <span
                  className="w-7 h-7 rounded-full border border-gray-700"
                  style={{ background: e.swatch }}
                />
                <span className="text-[9.5px]"
                  style={{ color: active ? "#a5b4fc" : "#9ca3af" }}>
                  {e.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selection */}
      <div className="flex-1 overflow-y-auto">
        {!selected || !cat ? (
          <div className="px-4 py-6 text-center">
            <div className="text-[32px] opacity-20 mb-2">◈</div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              点击场景中的物体<br />即可调整位置、旋转
            </p>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                已选中
              </p>
              <p className="text-[13px] font-semibold text-gray-100">{cat.name}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {cat.size[0]}×{cat.size[1]}×{cat.size[2]}cm
              </p>
            </div>

            {/* X / Z position sliders */}
            {(["X 位置", "Z 位置"] as const).map((label, axis) => {
              // axis 0 → X, axis 1 → Z (Y is auto-placed)
              const axisIdx = axis === 0 ? 0 : 2;
              const val = selected.position[axisIdx];
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                    <span>{label}</span>
                    <span>{val.toFixed(2)} m</span>
                  </div>
                  <input
                    type="range"
                    min={-1.5}
                    max={1.5}
                    step={0.01}
                    value={val}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      const next = [...selected.position] as [number, number, number];
                      next[axisIdx] = v;
                      moveItem(selected.id, next);
                    }}
                    className="w-full accent-indigo-500"
                  />
                </div>
              );
            })}

            {/* Y position (height) — useful for adjusting monitor above desk etc */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Y 高度</span>
                <span>{selected.position[1].toFixed(2)} m</span>
              </div>
              <input
                type="range"
                min={0}
                max={2.4}
                step={0.01}
                value={selected.position[1]}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  const next = [...selected.position] as [number, number, number];
                  next[1] = v;
                  moveItem(selected.id, next);
                }}
                className="w-full accent-indigo-500"
              />
            </div>

            {/* Rotation */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>旋转</span>
                <span>{((selected.rotY * 180) / Math.PI).toFixed(0)}°</span>
              </div>
              <input
                type="range"
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                value={selected.rotY}
                onChange={e => rotateItem(selected.id, parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>

            <button
              onClick={() => removeItem(selected.id)}
              className="w-full py-2 rounded-lg text-[11px] font-medium text-red-400 border border-red-900/40 hover:bg-red-500/10 transition-colors"
            >
              🗑 删除
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
