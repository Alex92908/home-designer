"use client";

/**
 * CatalogPanel — left-side picker for adding items to the scene.
 * Grouped by category, one click to drop into the scene.
 */

import { useState } from "react";
import { CATEGORY_META, DESK_CATALOG, getByCategory, type DeskCategory } from "@/lib/desk/catalog";
import { useDeskStore, STARTER_PRESETS } from "@/lib/desk/store";

export default function CatalogPanel() {
  const addItem    = useDeskStore(s => s.addItem);
  const clearAll   = useDeskStore(s => s.clearAll);
  const loadPreset = useDeskStore(s => s.loadPreset);
  const setEnv     = useDeskStore(s => s.setEnv);
  const itemCount  = useDeskStore(s => s.items.length);

  const [openCat, setOpenCat] = useState<DeskCategory | null>("desk");

  return (
    <aside
      className="flex flex-col h-full border-r border-gray-800 bg-[#0f0f12] text-gray-200"
      style={{ width: 280 }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold tracking-wide">桌搭</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">所见即所得 · {itemCount} 件</p>
        </div>
        <button
          onClick={clearAll}
          disabled={itemCount === 0}
          className="text-[10px] text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-500"
        >
          清空
        </button>
      </div>

      {/* Starter presets */}
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">
          快速开始
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {STARTER_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => { setEnv(p.env); loadPreset(p.items); }}
              className="text-left px-3 py-2 rounded-lg text-[11.5px] bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-indigo-500/50 transition-colors"
            >
              <span className="text-indigo-400">●</span>
              <span className="ml-2 text-gray-200">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category browser */}
      <div className="flex-1 overflow-y-auto">
        {(Object.keys(CATEGORY_META) as DeskCategory[])
          .sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order)
          .map(cat => {
            const meta  = CATEGORY_META[cat];
            const items = getByCategory(cat);
            const open  = openCat === cat;
            return (
              <div key={cat} className="border-b border-gray-800/60">
                <button
                  onClick={() => setOpenCat(open ? null : cat)}
                  className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-900/60 transition-colors text-left"
                >
                  <span className="text-gray-500 w-4">{meta.icon}</span>
                  <span className="text-[12px] font-medium text-gray-300 flex-1">
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-gray-600">{items.length}</span>
                  <span className="text-[10px] text-gray-600 w-3">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open && (
                  <div className="pb-2 grid grid-cols-2 gap-1.5 px-3">
                    {items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => addItem(item.id)}
                        className="text-left px-2.5 py-2 rounded-md bg-gray-900 hover:bg-indigo-500/20 border border-gray-800 hover:border-indigo-500/50 transition-colors"
                      >
                        <div className="text-[10.5px] font-medium text-gray-200 leading-tight">
                          {item.name}
                        </div>
                        <div className="text-[9px] text-gray-500 mt-0.5">
                          {item.size[0]}×{item.size[1]}×{item.size[2]}cm
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Footer stat */}
      <div className="px-4 py-2.5 border-t border-gray-800 text-[10px] text-gray-600">
        {DESK_CATALOG.length} 件精选 · 更多持续扩展
      </div>
    </aside>
  );
}
