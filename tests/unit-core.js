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

  test('solarTermOn 一月节气', () => {
    eq(core.solarTermOn(new Date(2026, 0, 5)), '小寒');
    eq(core.solarTermOn(new Date(2026, 0, 20)), '大寒');
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

  test('badgePlacements 统一贴在行尾并统计上下条数', () => {
    const segs = [0, 1, 2, 3, 4].map(() => ({ col: 1, span: 2 }));
    const bands = core.layoutBands(segs, 3, 0);
    const top = core.badgePlacements(bands.above, bands.below);
    eq(top.length, 1);
    eq(top[0].kind, 'below');
    eq(top[0].col, 6);
    eq(top[0].count, 2);

    const scrolledBands = core.layoutBands(segs, 3, 2);
    const scrolled = core.badgePlacements(scrolledBands.above, scrolledBands.below);
    eq(scrolled.length, 1);
    eq(scrolled[0].kind, 'above');
    eq(scrolled[0].count, 2);

    const bothBands = core.layoutBands([0, 1, 2, 3, 4, 5].map(() => ({ col: 1, span: 2 })), 2, 2);
    const both = core.badgePlacements(bothBands.above, bothBands.below);
    eq(both.length, 2);
    eq(both[0].col, 6);
    eq(both[1].col, 6);
  });

  test('badgePlacements 取各天隐藏条数的最大值', () => {
    const above = [0, 2, 2, 2, 1, 0, 0];
    const below = [0, 0, 1, 1, 0, 0, 0];
    const out = core.badgePlacements(above, below);
    eq(out.length, 2);
    eq(out[0].kind, 'above');
    eq(out[0].count, 2);
    eq(out[1].kind, 'below');
    eq(out[1].count, 1);
  });

  test('buildExportText 近 30 天已完成，按完成时间排序', () => {
    const now = new Date(2026, 10, 18, 12, 0).getTime();
    const todos = [
      { text: 'B', done: true, created: '2026-11-01T09:00:00', done_at: '2026-11-17T10:30:00' },
      { text: 'A', done: true, created: '2026-10-01T09:00:00', done_at: '2026-11-10T08:05:00' },
      { text: 'old', done: true, created: '2026-09-01T09:00:00', done_at: '2026-10-01T09:00:00' },
      { text: 'open', done: false, created: '2026-11-01T09:00:00', done_at: null },
    ];
    const text = core.buildExportText(todos, now, 30);
    const lines = text.trim().split('\r\n');
    eq(lines.length, 2);
    eq(lines[0], '2026-10-01 09:00，2026-11-10 08:05，A');
    eq(lines[1], '2026-11-01 09:00，2026-11-17 10:30，B');
    eq(core.buildExportText([], now, 30), '');
    const multiline = core.buildExportText(
      [{ text: '第一行\n第二行', done: true, created: '2026-11-01T09:00:00', done_at: '2026-11-17T10:30:00' }],
      now,
      30
    );
    eq(multiline.trim().split('\r\n').length, 1);
    ok(multiline.includes('第一行 第二行'));
  });

  test('透明度按 gamma 2.2 映射并可逆', () => {
    eq(core.opacityFromTransparency(0), 1);
    eq(core.opacityFromTransparency(1), 0);
    // 独立期望值，避免断言照抄实现公式
    ok(Math.abs(core.opacityFromTransparency(0.5) - 0.72974) < 1e-4, '50%');
    ok(Math.abs(core.transparencyFromOpacity(0.5) - 0.78236) < 1e-4, '反向');
    const alpha = core.opacityFromTransparency(0.41);
    ok(Math.abs(core.transparencyFromOpacity(alpha) - 0.41) < 1e-9, '往返');
    ok(core.opacityFromTransparency(0.5) > 0.7, '50% 应保持较高不透明度');
  });

  test('normalizeTodos 保留 AI 来源字段并补默认值', () => {
    const list = core.normalizeTodos([
      { id: 'a', text: 'AI 待办', source: 'WorkBuddy', provider: 'workbuddy' },
      { text: '普通待办' },
      null,
      { text: 3 },
    ]);
    eq(list.length, 3);
    eq(list[0].source, 'WorkBuddy');
    eq(list[0].provider, 'workbuddy');
    eq(list[0].done, false);
    eq(list[0].done_at, null);
    eq(list[0].pinned, false);
    eq(list[1].source, null);
    eq(list[1].provider, null);
    eq(list[2].text, '3');
    ok(typeof list[1].id === 'string' && list[1].id.length > 0, 'generated id');
  });

  test('validateLoadedState 拒绝非数组 todos', () => {
    eq(core.validateLoadedState({ todos: [] }).todos.length, 0);
    eq(core.validateLoadedState({ settings: {} }).settings !== undefined, true);
    let threw = false;
    try {
      core.validateLoadedState({ todos: { a: 1 } });
    } catch (err) {
      threw = /todos/.test(err.message);
    }
    ok(threw, 'non-array todos must throw');
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
