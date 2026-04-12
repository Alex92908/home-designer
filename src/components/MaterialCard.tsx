"use client";
// Legacy component - now superseded by inline MatCard in LeftPanel.tsx
// Kept for compatibility but not actively used.

import { MaterialItem } from "@/lib/types";
import { useDesignerStore } from "@/lib/store";

export default function MaterialCard({ item }: { item: MaterialItem }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.rooms[activeRoom].materials);
  const isSelected = roomMaterials[item.category]?.id === item.id;

  return (
    <button
      onClick={() => setMaterial(item)}
      className={`
        relative flex flex-col gap-1 p-2 rounded-xl border-2 text-left
        transition-all duration-200 hover:scale-105 hover:shadow-md
        ${isSelected
          ? "border-blue-500 bg-blue-50 shadow-blue-200 shadow-md"
          : "border-transparent bg-white/60 hover:border-gray-200"
        }
      `}
    >
      <div className="w-full h-10 rounded-lg" style={{ background: item.texture ?? item.color }} />
      <span className="text-xs font-semibold text-gray-800 leading-tight line-clamp-1">{item.name}</span>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-gray-400">{item.brand}</span>
        <span className="text-[10px] font-bold text-blue-600">¥{item.price.toLocaleString()}</span>
      </div>
      <span className="text-[9px] text-gray-400">{item.unit}</span>
      {isSelected && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
          <span className="text-white text-[9px]">✓</span>
        </div>
      )}
    </button>
  );
}
