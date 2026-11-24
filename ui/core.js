/* 桌面待办 —— 可复用的纯函数（浏览器挂到 window.TodoCore，Node 下可 require） */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TodoCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOLAR_TERMS = [
    "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
    "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
    "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
  ];
  const SOLAR_TERM_INFO = [
    0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
    173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
    353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
  ];
  const SOLAR_TERM_BASE = Date.UTC(1900, 0, 6, 2, 5);
  const SOLAR_TERM_YEAR_MS = 31556925974.7;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function ymd(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  // 返回某天对应的节气名，不是节气当天则返回空字符串
  function solarTermOn(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    for (const index of [month * 2, month * 2 + 1]) {
      const at = new Date(
        SOLAR_TERM_BASE + SOLAR_TERM_YEAR_MS * (year - 1900) + SOLAR_TERM_INFO[index] * 60000
      );
      if (at.getUTCFullYear() === year && at.getUTCMonth() === month && at.getUTCDate() === day) {
        return SOLAR_TERMS[index];
      }
    }
    return "";
  }

  // 导出用时间格式：YYYY-MM-DD HH:mm
  function formatStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // 近 days 天已完成事项：每行「创建时间，完成时间，内容」，按完成时间升序
  function buildExportText(todos, nowMs, days) {
    const cutoff = nowMs - days * 86400000;
    const items = (todos || [])
      .filter((todo) => todo && todo.done && todo.done_at)
      .map((todo) => ({ todo, at: new Date(todo.done_at).getTime() }))
      .filter((item) => Number.isFinite(item.at) && item.at >= cutoff)
      .sort((a, b) => a.at - b.at);
    if (!items.length) return "";
    const lines = items.map(({ todo }) =>
      [formatStamp(todo.created), formatStamp(todo.done_at), todo.text].join("，")
    );
    return lines.join("\r\n") + "\r\n";
  }

  // 把跨月 / 跨周的事项区间裁到 [weekStart, weekEnd] 与 [monthStart, monthEnd] 的交集
  function clipSegment(startDay, endDay, weekStart, weekEnd, monthStart, monthEnd) {
    let from = startDay < weekStart ? weekStart : startDay;
    if (monthStart && from < monthStart) from = monthStart;
    let to = endDay > weekEnd ? weekEnd : endDay;
    if (monthEnd && to > monthEnd) to = monthEnd;
    if (to < from) return null;
    return { from, to };
  }

  // 同一周内重叠的事项逐行下排；offset 为滚轮滚动偏移，最多同时显示 maxBars 行
  function layoutBands(segments, maxBars, offset) {
    const laneEnds = [];
    const placed = [];
    for (const seg of segments) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= seg.col) lane += 1;
      laneEnds[lane] = seg.col + seg.span - 1;
      placed.push({ ...seg, lane });
    }
    const maxOffset = Math.max(0, laneEnds.length - maxBars);
    const start = Math.min(Math.max(0, Math.round(offset) || 0), maxOffset);
    const above = new Array(7).fill(0);
    const below = new Array(7).fill(0);
    for (const seg of placed) {
      const last = seg.col + seg.span - 1;
      if (seg.lane < start) {
        for (let c = seg.col; c <= last; c += 1) above[c] += 1;
      } else if (seg.lane >= start + maxBars) {
        for (let c = seg.col; c <= last; c += 1) below[c] += 1;
      }
    }
    return { placed, laneCount: laneEnds.length, offset: start, maxOffset, above, below };
  }

  // +n 徽标：统一贴在行尾（周日）格；数字取该周各天里上方 / 下方隐藏条数的最大值
  function badgePlacements(above, below) {
    const aboveMax = above.length ? Math.max(0, ...above) : 0;
    const belowMax = below.length ? Math.max(0, ...below) : 0;
    const out = [];
    if (aboveMax) out.push({ col: 6, count: aboveMax, kind: "above" });
    if (belowMax) out.push({ col: 6, count: belowMax, kind: "below" });
    return out;
  }

  // 透明度滑杆 -> sRGB alpha：按线性光换算（gamma 2.2），让 50% 看起来像 50%
  const OPACITY_GAMMA = 2.2;

  function opacityFromTransparency(t) {
    return Math.min(1, Math.max(0, Math.pow(1 - Math.min(1, Math.max(0, t)), 1 / OPACITY_GAMMA)));
  }

  function transparencyFromOpacity(a) {
    return Math.min(1, Math.max(0, 1 - Math.pow(Math.min(1, Math.max(0, a)), OPACITY_GAMMA)));
  }

  function newTodoId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // 启动时统一待办形状。必须保留 source / provider：AI 来源标签依赖它们，
  // 每次启动都重建对象，漏字段会在下一次保存时永久写丢。
  function normalizeTodos(input) {
    return (Array.isArray(input) ? input : [])
      .filter((todo) => todo && typeof todo.text === "string")
      .map((todo) => ({
        id: todo.id || newTodoId(),
        text: todo.text,
        done: !!todo.done,
        done_at: todo.done_at || null,
        pinned: !!todo.pinned,
        due: todo.due || null,
        start: todo.start || null,
        created: todo.created || new Date().toISOString(),
        source: todo.source || null,
        provider: todo.provider || null,
      }));
  }

  return {
    SOLAR_TERMS,
    pad2,
    ymd,
    startOfDay,
    solarTermOn,
    clipSegment,
    layoutBands,
    badgePlacements,
    formatStamp,
    buildExportText,
    opacityFromTransparency,
    transparencyFromOpacity,
    normalizeTodos,
  };
});
