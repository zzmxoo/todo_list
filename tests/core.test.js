"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../ui/core.js");

test("pad2 / ymd / startOfDay", () => {
  assert.equal(core.pad2(3), "03");
  assert.equal(core.pad2(12), "12");
  const d = new Date(2026, 10, 7, 15, 30);
  assert.equal(core.ymd(d), "2026-11-07");
  const s = core.startOfDay(d);
  assert.equal(s.getHours(), 0);
  assert.equal(s.getMinutes(), 0);
  assert.equal(core.ymd(s), "2026-11-07");
});

test("solarTermOn 命中 2026 年节气当天", () => {
  assert.equal(core.solarTermOn(new Date(2026, 1, 4)), "立春");
  assert.equal(core.solarTermOn(new Date(2026, 3, 5)), "清明");
  assert.equal(core.solarTermOn(new Date(2026, 10, 22)), "小雪");
  assert.equal(core.solarTermOn(new Date(2026, 11, 22)), "冬至");
});

test("solarTermOn 非节气当天返回空串", () => {
  assert.equal(core.solarTermOn(new Date(2026, 0, 15)), "");
  assert.equal(core.solarTermOn(new Date(2026, 10, 21)), "");
});

test("withinUpcoming：今天起 N 天内（含已超时）", () => {
  const now = new Date(2026, 10, 17, 10, 0);
  assert.equal(core.withinUpcoming(new Date(2026, 10, 16, 9, 0), now, 7), true); // 已超时
  assert.equal(core.withinUpcoming(new Date(2026, 10, 17, 18, 0), now, 7), true); // 今天
  assert.equal(core.withinUpcoming(new Date(2026, 10, 23, 23, 59), now, 7), true);
  assert.equal(core.withinUpcoming(new Date(2026, 10, 24, 0, 0), now, 7), false); // 第 8 天
  assert.equal(core.withinUpcoming(null, now, 7), false);
});

test("clipSegment：跨月事项只保留本月部分", () => {
  const weekStart = new Date(2026, 0, 26);
  const weekEnd = new Date(2026, 1, 1);
  const monthStart = new Date(2026, 1, 1);
  const monthEnd = new Date(2026, 1, 28);
  const clipped = core.clipSegment(
    new Date(2026, 0, 28),
    new Date(2026, 1, 3),
    weekStart,
    weekEnd,
    monthStart,
    monthEnd
  );
  assert.ok(clipped);
  assert.equal(core.ymd(clipped.from), "2026-02-01");
  assert.equal(core.ymd(clipped.to), "2026-02-01");
});

test("clipSegment：本周与本月都不相交时返回 null", () => {
  const clipped = core.clipSegment(
    new Date(2026, 2, 1),
    new Date(2026, 2, 3),
    new Date(2026, 1, 23),
    new Date(2026, 2, 1),
    new Date(2026, 1, 1),
    new Date(2026, 1, 28)
  );
  assert.equal(clipped, null);
});

test("layoutBands：同列逐行下排并按窗口统计上下条数", () => {
  const segs = [0, 1, 2, 3, 4].map(() => ({ col: 3, span: 1 }));
  const top = core.layoutBands(segs, 3, 0);
  assert.equal(top.laneCount, 5);
  assert.equal(top.maxOffset, 2);
  assert.equal(top.offset, 0);
  assert.equal(top.above[3], 0);
  assert.equal(top.below[3], 2);

  const mid = core.layoutBands(segs, 3, 1);
  assert.equal(mid.offset, 1);
  assert.equal(mid.above[3], 1);
  assert.equal(mid.below[3], 1);

  const bottom = core.layoutBands(segs, 3, 99);
  assert.equal(bottom.offset, 2);
  assert.equal(bottom.above[3], 2);
  assert.equal(bottom.below[3], 0);
});

test("layoutBands：不重叠的事项共享第一行", () => {
  const segs = [
    { col: 0, span: 2 },
    { col: 3, span: 1 },
  ];
  const bands = core.layoutBands(segs, 3, 0);
  assert.deepEqual(
    bands.placed.map((s) => s.lane),
    [0, 0]
  );
  assert.equal(bands.maxOffset, 0);
  assert.equal(bands.above[0], 0);
  assert.equal(bands.below[0], 0);
});

test("内置名言库：1460 条、内容长度与去重", () => {
  const file = path.join(__dirname, "..", "ui", "quotes.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.quotes.length, 1460);
  const seen = new Set();
  for (const item of data.quotes) {
    assert.equal(typeof item.t, "string");
    assert.ok(item.t.length >= 6 && item.t.length <= 40, item.t);
    assert.equal(typeof item.f, "string");
    assert.ok(item.f.length > 0);
    assert.equal(seen.has(item.t), false, `重复：${item.t}`);
    seen.add(item.t);
  }
});
