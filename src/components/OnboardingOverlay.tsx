"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const STORAGE_KEY = "home-designer-v2-onboarded";

const STEP_ICONS = ["🎨", "📐", "🏠"];

export default function OnboardingOverlay() {
  const t = useT();
  const STEPS = [
    { icon: STEP_ICONS[0], title: t.onboarding.step1Title, desc: t.onboarding.step1Desc },
    { icon: STEP_ICONS[1], title: t.onboarding.step2Title, desc: t.onboarding.step2Desc },
    { icon: STEP_ICONS[2], title: t.onboarding.step3Title, desc: t.onboarding.step3Desc },
  ];
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) setVisible(true);
    } catch {
      // localStorage unavailable
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  }

  function goTo(next: number) {
    if (animating) return;
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
    }, 120);
  }

  if (!visible) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className="relative bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl mx-0 sm:mx-4 flex flex-col items-center overflow-hidden"
        style={{
          width: "min(420px, 100%)",
          padding: "40px 32px 32px",
          transition: "opacity 0.12s",
          opacity: animating ? 0 : 1,
        }}
      >
        {/* Skip button */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {t.onboarding.skip}
        </button>

        {/* Step count */}
        <p className="text-[11px] text-gray-400 mb-4 font-medium tracking-wider uppercase">
          {t.onboarding.stepCount(step + 1, STEPS.length)}
        </p>

        {/* Icon */}
        <div
          className="text-6xl mb-5 select-none"
          style={{ filter: "drop-shadow(0 4px 12px rgba(99,102,241,0.25))" }}
        >
          {s.icon}
        </div>

        {/* Step dots */}
        <div className="flex gap-2 mb-6">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                background: i === step ? "#6366f1" : "#e5e7eb",
              }}
            />
          ))}
        </div>

        {/* Content */}
        <h2 className="text-xl font-bold text-gray-800 mb-3 text-center">
          {s.title}
        </h2>
        <p className="text-sm text-gray-500 text-center leading-relaxed mb-8 whitespace-pre-line">
          {s.desc}
        </p>

        {/* Buttons */}
        <div className="flex gap-3 w-full">
          {step > 0 && (
            <button
              onClick={() => goTo(step - 1)}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              {t.onboarding.prev}
            </button>
          )}
          <button
            onClick={isLast ? dismiss : () => goTo(step + 1)}
            className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #6366f1, #818cf8)" }}
          >
            {isLast ? t.onboarding.start : t.onboarding.next}
          </button>
        </div>
      </div>
    </div>
  );
}
