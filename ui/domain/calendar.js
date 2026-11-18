/* 桌面待办 —— 日历模型（纯函数：事项区间、每周片段、整月周结构） */
(function (root, factory) {
  const hasRequire = typeof require === "function";
  const api = factory(
    hasRequire ? require("./todo.js") : root.TodoDomain,
    hasRequire ? require("../core.js") : root.TodoCore
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (todoApi, coreApi) {
  "use strict";

  const DAY_MS = 86400000;
  const startOfDay = coreApi.startOfDay;
  const clipSegment = coreApi.clipSegment;

  function ymd(date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  // 事项从开始（指定时间或创建时间）持续到截止时间，颜色按出现顺序轮换
  function buildEvents(todos) {
    const events = [];
    for (const todo of todos || []) {
      const due = todoApi.parseDue(todo);
      if (!due) continue;
      const created = todo.start
        ? new Date(todo.start)
        : todo.created
          ? new Date(todo.created)
          : null;
      const start =
        created && !Number.isNaN(created.getTime()) && created <= due ? created : due;
      events.push({
        todo,
        start,
        end: due,
        startDay: startOfDay(start),
        endDay: startOfDay(due),
        color: events.length % 5,
      });
    }
    return events;
  }

  // 某一周内与事项区间相交的片段，并裁掉本月以外的部分
  function buildWeekSegments(events, weekStart, weekEnd, monthStart, monthEnd) {
    const segments = [];
    for (const ev of events || []) {
      const clip = clipSegment(ev.startDay, ev.endDay, weekStart, weekEnd, monthStart, monthEnd);
      if (!clip) continue;
      const rawCol = Math.round((clip.from - weekStart) / DAY_MS);
      const col = Math.min(6, Math.max(0, rawCol));
      const rawSpan = Math.round((clip.to - clip.from) / DAY_MS) + 1;
      const span = Math.min(7 - col, Math.max(1, rawSpan));
      segments.push({
        ev,
        col,
        span,
        cutLeft: ev.startDay < clip.from,
        cutRight: ev.endDay > clip.to,
      });
    }
    segments.sort((a, b) => a.col - b.col || b.span - a.span);
    return segments;
  }

  // 整月周结构：首周可能含上月末，末周可能含下月初
  function buildMonthWeeks(year, month, events) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekCount = Math.ceil((offset + daysInMonth) / 7);
    const gridStart = new Date(year, month, 1 - offset);
    const monthStart = first;
    const monthEnd = new Date(year, month + 1, 0);

    const weeks = [];
    let monthCount = 0;
    for (let w = 0; w < weekCount; w += 1) {
      const weekStart = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + w * 7
      );
      const weekEnd = new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + 6
      );
      weeks.push({
        weekStart,
        weekEnd,
        segments: buildWeekSegments(events, weekStart, weekEnd, monthStart, monthEnd),
      });
    }
    for (const ev of events || []) {
      if (ev.endDay >= monthStart && ev.endDay <= monthEnd) monthCount += 1;
    }
    return { weekCount, offset, gridStart, monthStart, monthEnd, weeks, monthCount };
  }

  return { buildEvents, buildWeekSegments, buildMonthWeeks, startOfDay, ymd };
});
