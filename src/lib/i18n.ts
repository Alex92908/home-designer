"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { zh } from "../locales/zh";
import { en } from "../locales/en";
import type { Translations } from "../locales/zh";
import { getFurnitureNameEn, getMaterialNameEn } from "../locales/itemNames";

export type Locale = "zh" | "en";

const LOCALES: Record<Locale, Translations> = { zh, en };

interface LocaleStore {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: "zh",
      setLocale: (locale) => set({ locale }),
    }),
    { name: "hd-locale" }
  )
);

export function useT(): Translations {
  const locale = useLocaleStore((s) => s.locale);
  return LOCALES[locale];
}

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

/** Get localized name for a furniture item */
export function useFurnitureName(id: string, fallback: string): string {
  const locale = useLocale();
  if (locale === "en") return getFurnitureNameEn(id) ?? fallback;
  return fallback;
}

/** Get localized name for a material item */
export function useMaterialName(id: string, fallback: string): string {
  const locale = useLocale();
  if (locale === "en") return getMaterialNameEn(id) ?? fallback;
  return fallback;
}

/** Non-hook version for use outside React components */
export function getLocalizedFurnitureName(id: string, fallback: string, locale: Locale): string {
  if (locale === "en") return getFurnitureNameEn(id) ?? fallback;
  return fallback;
}

export function getLocalizedMaterialName(id: string, fallback: string, locale: Locale): string {
  if (locale === "en") return getMaterialNameEn(id) ?? fallback;
  return fallback;
}
