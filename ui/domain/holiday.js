/* 桌面待办 —— 节假日规则（纯函数） */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HolidayDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 把各年份的放假安排合并成 日期 -> 节日名，调休（off=false）不显示
  function buildHolidayMap(holidays) {
    const map = new Map();
    if (!holidays || typeof holidays !== "object") return map;
    for (const cfg of Object.values(holidays)) {
      if (!cfg || !Array.isArray(cfg.days)) continue;
      for (const day of cfg.days) {
        if (day && day.off && day.date) map.set(day.date, day.name || "节假日");
      }
    }
    return map;
  }

  // 节日底色。注意：这些值只以约 24% 叠在固定暖底上呈现，
  // 因此需要拉开发色相与明度差，否则渲染出来会全都一样。
  // 清明节是唯一例外，保留清冷的竹青以贴合节气氛围。
  const TINT = {
    元旦: "255, 176, 196",   // 粉
    春节: "228, 64, 64",     // 深朱红
    清明节: "122, 200, 168", // 竹青（冷色豁免）
    劳动节: "255, 128, 24",  // 橙
    端午节: "248, 190, 44",  // 金
    中秋节: "255, 238, 196", // 浅金
    国庆节: "240, 108, 70",  // 橙红
  };

  // 节日格固定的暖底，避免 --hd 被用户选的冷色玻璃背景稀释成蓝紫。
  const TINT_BASE = "58, 34, 30";
  // 清明节用更冷的底色，保留清冷氛围。
  const TINT_BASE_QINGMING = "28, 48, 42";
  // 叠色透明度
  const TINT_ALPHA = 0.24;

  /** 取节日底色 "r, g, b"；未匹配到节日时回退到中性暖色。 */
  function holidayTint(name) {
    // 数据源对早年使用合并名（如"国庆节、中秋节"），先按分隔符取首个匹配
    const first = String(name || "").split(/[、,，]/)[0].trim();
    return TINT[first] || "236, 170, 120";
  }

  /** 取节日格的暖底色。 */
  function holidayBase(name) {
    const first = String(name || "").split(/[、,，]/)[0].trim();
    return first === "清明节" ? TINT_BASE_QINGMING : TINT_BASE;
  }

  function parseRgb(rgbText) {
    const parts = String(rgbText || "").split(",").map((n) => Number(n.trim()));
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
  }

  /** CSS 叠色合成：fore 以 alpha 覆盖在 base 上。 */
  function composite(foreText, baseText, alpha) {
    const f = parseRgb(foreText);
    const b = parseRgb(baseText);
    if (!f || !b) return null;
    return f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  }

  /** WCAG 相对亮度（0–1）。 */
  function relativeLuminance(rgb) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  /** RGB -> 色相（0–360）。 */
  function hueOf(rgb) {
    const [r, g, b] = rgb.map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return h < 0 ? h + 360 : h;
  }

  /**
   * 判断节日格实际渲染出来是否偏冷或过暗。
   * 关键：判的是叠色合成后的颜色，不是常量本身。
   * 暖区定义为色相 ≤ 70° 或 ≥ 330°（红/橙/黄/粉），其余视为冷色。
   */
  function isRenderedTintColdOrDim(name) {
    const rendered = composite(holidayTint(name), holidayBase(name), TINT_ALPHA);
    if (!rendered) return true;
    const hue = hueOf(rendered);
    const warm = hue <= 70 || hue >= 330;
    const dim = relativeLuminance(rendered) < 0.03;
    return !warm || dim;
  }

  /** 两个节日渲染后的颜色差异（RGB 欧氏距离，用于判断是否可区分）。 */
  function renderedTintDistance(a, b) {
    const ca = composite(holidayTint(a), holidayBase(a), TINT_ALPHA);
    const cb = composite(holidayTint(b), holidayBase(b), TINT_ALPHA);
    if (!ca || !cb) return 0;
    return Math.sqrt(ca.reduce((sum, v, i) => sum + (v - cb[i]) ** 2, 0));
  }

  return {
    buildHolidayMap,
    holidayTint,
    holidayBase,
    isRenderedTintColdOrDim,
    renderedTintDistance,
    composite,
    TINT,
    TINT_ALPHA,
  };
});
