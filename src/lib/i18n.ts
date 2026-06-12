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

/** Non-hook localized room-type display name.
 *  Reuses the central locale `roomNames` table (covers every RoomType in
 *  both locales) so non-React callers don't duplicate their own maps.
 *  Falls back to the Chinese table, then the raw key. */
export function getLocalizedRoomName(type: string, locale: Locale): string {
  const table = LOCALES[locale].roomNames as Record<string, string>;
  const zhTable = LOCALES.zh.roomNames as Record<string, string>;
  return table[type] ?? zhTable[type] ?? type;
}

/** 自定义房间名按语言取：英文界面优先 nameEn，没填回落中文名。
 *  meta 为空返回 undefined，让调用方继续走 roomNames/ROOM_DEFS 兜底链。 */
export function customRoomDisplayName(
  meta: { name: string; nameEn?: string } | undefined,
  locale: Locale,
): string | undefined {
  if (!meta) return undefined;
  return locale === "en" && meta.nameEn ? meta.nameEn : meta.name;
}
