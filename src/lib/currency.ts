// Fixed exchange rate CNY → USD
const CNY_TO_USD = 1 / 7.2;

/**
 * Format a CNY price for display.
 * EN locale: converts to USD and shows $
 * ZH locale: keeps CNY and shows ¥
 */
export function formatPrice(cny: number, locale: string): string {
  if (locale === "en") {
    const usd = cny * CNY_TO_USD;
    // Round nicely: < $10 → 1 decimal, else integer
    const rounded = usd < 10 ? Math.round(usd * 10) / 10 : Math.round(usd);
    return `$${rounded.toLocaleString("en-US")}`;
  }
  return `¥${cny.toLocaleString("zh-CN")}`;
}

/**
 * Format a CNY per-unit price (e.g. ¥35/㎡ → $5/sq ft or $5/㎡)
 */
export function formatUnitPrice(cny: number, locale: string): string {
  if (locale === "en") {
    const usd = cny * CNY_TO_USD;
    const rounded = usd < 10 ? Math.round(usd * 10) / 10 : Math.round(usd);
    return `$${rounded.toLocaleString("en-US")}`;
  }
  return `¥${cny.toLocaleString("zh-CN")}`;
}
