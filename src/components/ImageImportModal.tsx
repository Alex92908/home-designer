"use client";

import { useCallback, useRef, useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { ExteriorSettings } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "upload" | "analyzing" | "review";

interface AnalysisResult {
  preset: string;
  roofStyle: ExteriorSettings["roofStyle"];
  roofColor: string;
  wallMaterial: ExteriorSettings["wallMaterial"];
  wallColor: string;
  accentColor: string;
  floors: number;
  yardPreset: ExteriorSettings["yardPreset"];
  showPerimeterFence: boolean;
  detectedFeatures: string[];
  promptAdditions: string;
  confidence: number;
  error?: string;
  fallback?: boolean;
}

export default function ImageImportModal({ open, onClose }: Props) {
  const setExterior             = useDesignerStore(s => s.setExterior);
  const setReferenceImageDataUrl = useDesignerStore(s => s.setReferenceImageDataUrl);
  const setPromptAdditions      = useDesignerStore(s => s.setPromptAdditions);

  const [phase,    setPhase]    = useState<Phase>("upload");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result,   setResult]   = useState<AnalysisResult | null>(null);
  const [toast,    setToast]    = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Editable fields (populated from analysis result)
  const [preset,             setPreset]             = useState("modern");
  const [roofStyle,          setRoofStyle]          = useState<ExteriorSettings["roofStyle"]>("flat");
  const [roofColor,          setRoofColor]          = useState("#2A2A2A");
  const [wallMaterial,       setWallMaterial]       = useState<ExteriorSettings["wallMaterial"]>("render");
  const [wallColor,          setWallColor]          = useState("#F4F2EE");
  const [accentColor,        setAccentColor]        = useState("#1A1A1A");
  const [floors,             setFloors]             = useState(2);
  const [yardPreset,         setYardPreset]         = useState<ExteriorSettings["yardPreset"]>("minimal");
  const [showPerimeterFence, setShowPerimeterFence] = useState(false);
  const [promptAdditionsVal, setPromptAdditionsVal] = useState("");
  const [detectedFeatures,   setDetectedFeatures]   = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setPhase("upload");
    setImageUrl(null);
    setResult(null);
    setAnalyzeError(null);
    setDragOver(false);
  }

  async function processFile(file: File) {
    if (!file.type.startsWith("image/")) return;

    // Convert to data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    setImageUrl(dataUrl);
    setPhase("analyzing");
    setAnalyzeError(null);

    // Call analysis API
    try {
      const res = await fetch("/api/analyze-exterior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json() as AnalysisResult;

      setResult(data);

      // Populate editable fields
      setPreset(data.preset ?? "modern");
      setRoofStyle(data.roofStyle ?? "flat");
      setRoofColor(data.roofColor ?? "#2A2A2A");
      setWallMaterial(data.wallMaterial ?? "render");
      setWallColor(data.wallColor ?? "#F4F2EE");
      setAccentColor(data.accentColor ?? "#1A1A1A");
      setFloors(data.floors ?? 2);
      setYardPreset(data.yardPreset ?? "minimal");
      setShowPerimeterFence(data.showPerimeterFence ?? false);
      setPromptAdditionsVal(data.promptAdditions ?? "");
      setDetectedFeatures(data.detectedFeatures ?? []);

      setPhase("review");
    } catch (err) {
      console.error("analyze-exterior failed:", err);
      setAnalyzeError("分析失败，请重试");
      setPhase("upload");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply() {
    if (!imageUrl) return;

    setExterior({
      preset,
      roofStyle,
      wallMaterial,
      wallColor,
      accentColor,
      roofColor,
      floors,
      yardPreset,
      showPerimeterFence,
    });
    setReferenceImageDataUrl(imageUrl);
    setPromptAdditions(promptAdditionsVal);

    // Show toast
    setToast(true);
    setTimeout(() => setToast(false), 2500);

    onClose();
    resetState();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget && phase !== "analyzing") { onClose(); resetState(); } }}
    >
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-2.5 rounded-full text-sm font-semibold text-white shadow-lg"
          style={{ background: "#4f46e5" }}>
          设计已更新 ✓
        </div>
      )}

      <div
        className="bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(720px, 100%)", maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">📷</span>
            <h2 className="text-sm font-bold text-gray-800">从参考图片导入设计风格</h2>
          </div>
          <button
            onClick={() => { onClose(); resetState(); }}
            disabled={phase === "analyzing"}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30"
          >✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* ── Phase: Upload ── */}
          {phase === "upload" && (
            <div className="flex flex-col gap-4">
              {analyzeError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  {analyzeError}
                </div>
              )}
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-16"
                style={{
                  borderColor: dragOver ? "#6366f1" : "#d1d5db",
                  background:  dragOver ? "#eef2ff" : "#fafafa",
                }}
              >
                <span className="text-4xl">🏠</span>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">拖放建筑照片到这里</p>
                  <p className="text-xs text-gray-400 mt-1">或点击选择文件 · 支持 JPG、PNG、WebP</p>
                </div>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                  style={{ background: "#6366f1" }}
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  选择图片
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-[10px] text-gray-400 text-center">
                上传建筑外观照片，AI 将自动识别风格、材质、配色方案
              </p>
            </div>
          )}

          {/* ── Phase: Analyzing ── */}
          {phase === "analyzing" && (
            <div className="flex flex-col items-center gap-6 py-8">
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="上传的图片"
                  className="w-48 h-36 object-cover rounded-xl shadow-md"
                />
              )}
              <div className="flex flex-col items-center gap-3">
                {/* Spinner */}
                <div
                  className="w-10 h-10 rounded-full border-4 animate-spin"
                  style={{ borderColor: "#e0e7ff", borderTopColor: "#6366f1" }}
                />
                <p className="text-sm font-semibold text-indigo-700">AI 正在分析建筑风格...</p>
                <p className="text-[10px] text-gray-400">识别风格 · 材质 · 配色 · 特征</p>
              </div>
            </div>
          )}

          {/* ── Phase: Review ── */}
          {phase === "review" && imageUrl && result && (
            <div className="flex flex-col gap-5">
              {result.fallback && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  分析服务暂时不可用，已使用默认参数，请手动调整。
                </div>
              )}

              <div className="flex gap-4">
                {/* Left: photo thumbnail */}
                <div className="shrink-0">
                  <img
                    src={imageUrl}
                    alt="参考图片"
                    className="w-44 h-36 object-cover rounded-xl shadow-md"
                  />
                  {result.confidence > 0 && (
                    <div className="mt-2 text-center">
                      <span className="text-[10px] text-gray-400">识别置信度 </span>
                      <span className="text-[10px] font-semibold" style={{ color: result.confidence > 0.7 ? "#059669" : "#d97706" }}>
                        {Math.round(result.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: editable fields */}
                <div className="flex-1 flex flex-col gap-3 min-w-0">

                  <div className="grid grid-cols-2 gap-3">
                    {/* 建筑风格 */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">建筑风格</span>
                      <select
                        value={preset}
                        onChange={e => setPreset(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-400"
                      >
                        <option value="modern">现代 Modern</option>
                        <option value="contemporary">当代 Contemporary</option>
                        <option value="mediterranean">地中海 Mediterranean</option>
                        <option value="industrial">工业 Industrial</option>
                        <option value="minimalist">极简 Minimalist</option>
                      </select>
                    </label>

                    {/* 屋顶类型 */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">屋顶类型</span>
                      <select
                        value={roofStyle}
                        onChange={e => setRoofStyle(e.target.value as ExteriorSettings["roofStyle"])}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-400"
                      >
                        <option value="flat">平屋顶 Flat</option>
                        <option value="gable">人字顶 Gable</option>
                        <option value="hip">四坡顶 Hip</option>
                        <option value="mansard">孟莎顶 Mansard</option>
                        <option value="chinese">中式屋顶 Chinese</option>
                      </select>
                    </label>

                    {/* 外墙材质 */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">外墙材质</span>
                      <select
                        value={wallMaterial}
                        onChange={e => setWallMaterial(e.target.value as ExteriorSettings["wallMaterial"])}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-400"
                      >
                        <option value="render">涂料 Render</option>
                        <option value="brick">砖墙 Brick</option>
                        <option value="stone">石材 Stone</option>
                        <option value="wood">木材 Wood</option>
                        <option value="concrete">混凝土 Concrete</option>
                      </select>
                    </label>

                    {/* 院落方案 */}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">院落方案</span>
                      <select
                        value={yardPreset}
                        onChange={e => setYardPreset(e.target.value as ExteriorSettings["yardPreset"])}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-400"
                      >
                        <option value="pool">泳池 Pool</option>
                        <option value="garden">花园 Garden</option>
                        <option value="minimal">简约 Minimal</option>
                        <option value="full">完整 Full</option>
                      </select>
                    </label>
                  </div>

                  {/* Colors row */}
                  <div className="flex gap-3">
                    <label className="flex flex-col gap-1 items-start">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">外墙颜色</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={wallColor}
                          onChange={e => setWallColor(e.target.value)}
                          className="w-8 h-7 rounded border border-gray-200 cursor-pointer p-0.5"
                        />
                        <span className="text-[10px] text-gray-400 font-mono">{wallColor}</span>
                      </div>
                    </label>

                    <label className="flex flex-col gap-1 items-start">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">点缀色</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={accentColor}
                          onChange={e => setAccentColor(e.target.value)}
                          className="w-8 h-7 rounded border border-gray-200 cursor-pointer p-0.5"
                        />
                        <span className="text-[10px] text-gray-400 font-mono">{accentColor}</span>
                      </div>
                    </label>

                    <label className="flex flex-col gap-1 items-start">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">屋顶颜色</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={roofColor}
                          onChange={e => setRoofColor(e.target.value)}
                          className="w-8 h-7 rounded border border-gray-200 cursor-pointer p-0.5"
                        />
                        <span className="text-[10px] text-gray-400 font-mono">{roofColor}</span>
                      </div>
                    </label>
                  </div>

                  {/* Floors + Fence row */}
                  <div className="flex gap-4 items-end">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">楼层数</span>
                      <input
                        type="number"
                        min={1}
                        max={3}
                        value={floors}
                        onChange={e => setFloors(Math.max(1, Math.min(3, Number(e.target.value))))}
                        className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400"
                      />
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                      <input
                        type="checkbox"
                        checked={showPerimeterFence}
                        onChange={e => setShowPerimeterFence(e.target.checked)}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <span className="text-xs text-gray-600">周界围栏</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Detected features */}
              {detectedFeatures.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">识别特征</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedFeatures.map((f, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2.5 py-1 rounded-full font-medium"
                        style={{ background: "#eef2ff", color: "#4f46e5" }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt additions */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">额外提示词</span>
                <textarea
                  value={promptAdditionsVal}
                  onChange={e => setPromptAdditionsVal(e.target.value)}
                  rows={2}
                  placeholder="额外的 SD 关键词，留空则不添加..."
                  className="text-xs border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-400"
                />
                <p className="text-[9px] text-gray-400">这些关键词将附加到 AI 渲染提示词中</p>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "review") && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
            <button
              onClick={() => { setPhase("upload"); setImageUrl(null); setResult(null); }}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all"
            >
              重新分析
            </button>
            <button
              onClick={handleApply}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition-all"
              style={{ background: "#6366f1" }}
            >
              应用到设计
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
