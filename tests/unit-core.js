(function () {
  const core = window.TodoCore;
  const results = [];
  const eq = (actual, expected, message) => {
    if (actual !== expected) {
      throw new Error((message || 'eq') + ' expected=' + expected + ' actual=' + actual);
    }
  };
  const ok = (value, message) => {
    if (!value) throw new Error(message || 'assert failed');
  };
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name: name, ok: true });
    } catch (err) {
      results.push({ name: name, ok: false, error: String((err && err.message) || err) });
    }
  };

  test('pad2', () => {
    eq(core.pad2(3), '03');
    eq(core.pad2(12), '12');
  });

  test('ymd / startOfDay', () => {
    const d = new Date(2026, 10, 7, 15, 30);
    eq(core.ymd(d), '2026-11-07');
    const s = core.startOfDay(d);
    eq(s.getHours(), 0);
    eq(s.getMinutes(), 0);
    eq(core.ymd(s), '2026-11-07');
  });

  test('solarTermOn 2026 节气当天', () => {
    eq(core.solarTermOn(new Date(2026, 1, 4)), '立春');
    eq(core.solarTermOn(new Date(2026, 3, 5)), '清明');
    eq(core.solarTermOn(new Date(2026, 10, 22)), '小雪');
    eq(core.solarTermOn(new Date(2026, 11, 22)), '冬至');
  });

  test('solarTermOn 非节气当天', () => {
    eq(core.solarTermOn(new Date(2026, 0, 15)), '');
    eq(core.solarTermOn(new Date(2026, 10, 21)), '');
  });

  test('withinUpcoming 今天起 N 天（含已超时）', () => {
    const now = new Date(2026, 10, 17, 10, 0);
    eq(core.withinUpcoming(new Date(2026, 10, 16, 9, 0), now, 7), true, '超时');
    eq(core.withinUpcoming(new Date(2026, 10, 17, 18, 0), now, 7), true, '今天');
    eq(core.withinUpcoming(new Date(2026, 10, 23, 23, 59), now, 7), true, '第7天');
    eq(core.withinUpcoming(new Date(2026, 10, 24, 0, 0), now, 7), false, '第8天');
    eq(core.withinUpcoming(null, now, 7), false, '空值');
  });

  test('clipSegment 跨月只保留本月', () => {
    const clip = core.clipSegment(
      new Date(2026, 0, 28),
      new Date(2026, 1, 3),
      new Date(2026, 0, 26),
      new Date(2026, 1, 1),
      new Date(2026, 1, 1),
      new Date(2026, 1, 28)
    );
    ok(clip, '应有裁剪结果');
    eq(core.ymd(clip.from), '2026-02-01');
    eq(core.ymd(clip.to), '2026-02-01');
  });

  test('clipSegment 完全不相交返回 null', () => {
    const clip = core.clipSegment(
      new Date(2026, 2, 1),
      new Date(2026, 2, 3),
      new Date(2026, 1, 23),
      new Date(2026, 2, 1),
      new Date(2026, 1, 1),
      new Date(2026, 1, 28)
    );
    eq(clip, null);
  });

  test('layoutBands 同列下排与上下计数', () => {
    const segs = [0, 1, 2, 3, 4].map(() => ({ col: 3, span: 1 }));
    const top = core.layoutBands(segs, 3, 0);
    eq(top.laneCount, 5);
    eq(top.maxOffset, 2);
    eq(top.offset, 0);
    eq(top.above[3], 0);
    eq(top.below[3], 2);

    const mid = core.layoutBands(segs, 3, 1);
    eq(mid.offset, 1);
    eq(mid.above[3], 1);
    eq(mid.below[3], 1);

    const bottom = core.layoutBands(segs, 3, 99);
    eq(bottom.offset, 2);
    eq(bottom.above[3], 2);
    eq(bottom.below[3], 0);
  });

  test('layoutBands 不重叠事项共享首行', () => {
    const bands = core.layoutBands(
      [
        { col: 0, span: 2 },
        { col: 3, span: 1 },
      ],
      3,
      0
    );
    eq(bands.placed[0].lane, 0);
    eq(bands.placed[1].lane, 0);
    eq(bands.maxOffset, 0);
    eq(bands.above[0], 0);
    eq(bands.below[0], 0);
  });

  test('layoutBands 跨列计数覆盖整个区间', () => {
    const bands = core.layoutBands(
      [
        { col: 0, span: 3 },
        { col: 1, span: 2 },
        { col: 2, span: 4 },
        { col: 0, span: 2 },
      ],
      2,
      0
    );
    eq(bands.below[0], 1);
    eq(bands.below[1], 1);
    eq(bands.below[2], 1);
    eq(bands.below[3], 1);
    eq(bands.above[3], 0);
    const scrolled = core.layoutBands(
      [
        { col: 0, span: 3 },
        { col: 1, span: 2 },
        { col: 2, span: 4 },
        { col: 0, span: 2 },
      ],
      2,
      2
    );
    eq(scrolled.offset, 2);
    eq(scrolled.above[2], 2);
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
