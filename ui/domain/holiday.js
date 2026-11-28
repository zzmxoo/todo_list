/* Tiny·待办事项 —— 节假日规则（纯函数） */
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

  // 节日底色按「节日大小」分成两个色系，而不是每个节日一种颜色。
  // 大节日统一柔和暖色（桃色 #F6C172），小节日用低饱和竹青。
  // 只以 24% 叠在玻璃背景上，靠明度微差 + 加粗文字色区分，
  // 避免大面积高亮色块抢走左侧待办清单的视觉焦点。
  const GROUPS = {
    // 大节日：柔和桃色，暖色系
    warm: {
      tint: "246, 193, 114",
      members: ["春节", "国庆节", "元旦", "劳动节"],
    },
    // 小节日/节气：低饱和竹青，偏冷
    cool: {
      tint: "150, 200, 185",
      members: ["清明节", "端午节", "中秋节"],
    },
  };

  // 叠色透明度（与 styles.css 中 .cal-cell.holiday 保持一致）
  const TINT_ALPHA = 0.24;

  // 节日格叠色所在的底层 = 日历卡的玻璃背景。
  // 取 --glass-hi 与深色桌面合成后的近似值，用于计算渲染结果。
  const TINT_SURFACE = "48, 39, 105";

  const NAME_TO_GROUP = (() => {
    const map = new Map();
    for (const [group, cfg] of Object.entries(GROUPS)) {
      for (const name of cfg.members) map.set(name, group);
    }
    return map;
  })();

  /** 去掉合并名（如"国庆节、中秋节"）只取首个节日。 */
  function primaryName(name) {
    return String(name || "").split(/[、,，]/)[0].trim();
  }

  /** 节日所属色系；未知节日归入 cool（低饱和竹青，最不抢眼）。 */
  function groupOf(name) {
    return NAME_TO_GROUP.get(primaryName(name)) || "cool";
  }

  /** 取节日底色 "r, g, b"。 */
  function holidayTint(name) {
    return GROUPS[groupOf(name)].tint;
  }

  /** 取节日格的底色。不再垫不透明底，统一叠在玻璃背景上。 */
  function holidayBase() {
    return TINT_SURFACE;
  }

  /** 返回节日配色表 { 节日名 -> 色系 }，供测试与调试使用。 */
  function tintGroups() {
    const out = {};
    for (const [group, cfg] of Object.entries(GROUPS)) {
      for (const name of cfg.members) out[name] = group;
    }
    return out;
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
   * 判断节日格实际渲染出来是否过暗（不可读）。
   * 注意：不再判"是否偏冷"——冷色分组（清明/端午的竹青）是有意为之。
   */
  function isRenderedTintTooDim(name) {
    const rendered = composite(holidayTint(name), holidayBase(name), TINT_ALPHA);
    if (!rendered) return true;
    return relativeLuminance(rendered) < 0.02;
  }

  /** 渲染后的色相。 */
  function renderedHue(name) {
    const rendered = composite(holidayTint(name), holidayBase(name), TINT_ALPHA);
    return rendered ? hueOf(rendered) : 0;
  }

  /** 渲染后的饱和度（0-1），用于校验整体是低饱和配色。 */
  function renderedSaturation(name) {
    const rendered = composite(holidayTint(name), holidayBase(name), TINT_ALPHA);
    if (!rendered) return 1;
    const [r, g, b] = rendered.map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
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
    groupOf,
    tintGroups,
    isRenderedTintTooDim,
    renderedHue,
    renderedSaturation,
    renderedTintDistance,
    composite,
    GROUPS,
    TINT_ALPHA,
  };
});
