/* Tiny·待办事项 —— 每日一句选择规则（纯函数） */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuoteDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * 从池子里随机取一条，尽量避开上一条。
   * @returns {{index:number,item:any}|null}
   */
  function pickQuote(pool, lastIndex, random) {
    if (!Array.isArray(pool) || !pool.length) return null;
    const rand = typeof random === "function" ? random : Math.random;
    let index = Math.floor(rand() * pool.length);
    // 避免连续两次看到同一句；限制重试次数，避免随机源卡死
    let guard = 0;
    while (pool.length > 1 && index === lastIndex && guard < 50) {
      index = Math.floor(rand() * pool.length);
      guard += 1;
    }
    return { index, item: pool[index] };
  }

  return { pickQuote };
});
