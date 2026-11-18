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

  return { buildHolidayMap };
});
