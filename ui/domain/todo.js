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
    const d = new Date(todo.due);
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
    if (diffDays === 0) return `今天 ${hm(due)}`;
    if (diffDays === 1) return `明天 ${hm(due)}`;
    if (diffDays === -1) return `昨天 ${hm(due)}`;
    const prefix = due.getFullYear() === base.getFullYear() ? "" : `${due.getFullYear()}年`;
    return `${prefix}${due.getMonth() + 1}月${due.getDate()}日 ${hm(due)}`;
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
      return m >= 10 ? `${h}时${m}分` : `${h}时`;
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
