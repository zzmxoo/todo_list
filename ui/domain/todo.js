/* 桌面待办 —— 待办领域规则（纯函数，不碰 DOM / 存储） */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TodoDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 86400000;
  const SOON_MS = 30 * 60 * 1000;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function hm(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function parseDue(todo) {
    if (!todo || !todo.due) return null;
    const raw = String(todo.due);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const maxDay = new Date(year, month, 0).getDate();
      if (month < 1 || month > 12 || day < 1 || day > maxDay) return null;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // none | done | overdue | soon | normal
  function dueState(todo, nowMs) {
    const due = parseDue(todo);
    if (!due) return "none";
    if (todo.done) return "done";
    const diff = due.getTime() - (Number.isFinite(nowMs) ? nowMs : Date.now());
    if (diff < 0) return "overdue";
    if (diff <= SOON_MS) return "soon";
    return "normal";
  }

  function dueText(todo, now) {
    const due = parseDue(todo);
    if (!due) return "";
    const base = now instanceof Date ? now : new Date();
    const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const target = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.round((target - today) / DAY_MS);
    // 会议/事件有开始时间：同一天时显示 10:30–11:30，而不是只显示结束时间
    const start = todo.start ? new Date(todo.start) : null;
    const range =
      start &&
      !Number.isNaN(start.getTime()) &&
      start.getFullYear() === due.getFullYear() &&
      start.getMonth() === due.getMonth() &&
      start.getDate() === due.getDate()
        ? `${hm(start)}–${hm(due)}`
        : hm(due);
    if (diffDays === 0) return `今天 ${range}`;
    if (diffDays === 1) return `明天 ${range}`;
    if (diffDays === -1) return `昨天 ${range}`;
    const prefix = due.getFullYear() === base.getFullYear() ? "" : `${due.getFullYear()}年`;
    return `${prefix}${due.getMonth() + 1}月${due.getDate()}日 ${range}`;
  }

  // 从开始（日历中添加时指定，否则为创建时间）到截止的时长文案
  function todoDuration(todo, due) {
    const start = todo.start
      ? new Date(todo.start)
      : todo.created
        ? new Date(todo.created)
        : null;
    if (!start || Number.isNaN(start.getTime()) || due <= start) return "";
    const mins = Math.round((due.getTime() - start.getTime()) / 60000);
    if (mins < 10) return "";
    if (mins < 60) return `${mins}分`;
    if (mins < 24 * 60) {
      const h = Math.floor(mins / 60);
      const m = Math.round(mins % 60);
      return m > 0 ? `${h}时${m}分` : `${h}时`;
    }
    return `${Math.round(mins / 1440)}天`;
  }

  function sortTodos(list) {
    return list
      .map((todo, index) => ({ todo, index }))
      .sort((a, b) => {
        const pinA = a.todo.pinned ? 0 : 1;
        const pinB = b.todo.pinned ? 0 : 1;
        if (pinA !== pinB) return pinA - pinB;
        const doneA = a.todo.done ? 1 : 0;
        const doneB = b.todo.done ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        return a.index - b.index;
      })
      .map((item) => item.todo);
  }

  function createTodo(options = {}) {
    const value = String(options.text == null ? "" : options.text).trim();
    if (!value) return null;
    const created = options.created || new Date().toISOString();
    const done = !!options.done;
    return {
      id: options.id || "",
      text: value,
      done,
      done_at: done ? options.done_at || created : null,
      pinned: !!options.pinned,
      due: options.due || null,
      start: options.start || null,
      created,
      // AI 接入来源；手动创建的待办为空字符串
      source: options.source || "",
      provider: options.provider || "",
    };
  }

  function applyDone(todo, done, nowIso) {
    const next = !!done;
    return {
      ...todo,
      done: next,
      done_at: next ? nowIso || new Date().toISOString() : null,
    };
  }

  return {
    parseDue,
    dueState,
    dueText,
    todoDuration,
    sortTodos,
    createTodo,
    applyDone,
  };
});
