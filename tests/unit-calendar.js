(function () {
  const api = window.CalendarDomain;
  const core = window.TodoCore;
  const results = [];
  const eq = (actual, expected, message) => {
    if (actual !== expected) {
      throw new Error((message || 'eq') + ' expected=' + expected + ' actual=' + actual);
    }
  };
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name: name, ok: true });
    } catch (err) {
      results.push({ name: name, ok: false, error: String((err && err.message) || err) });
    }
  };

  test('buildEvents：跳过无截止，创建晚于截止时以截止为开始', () => {
    const events = api.buildEvents([
      { id: 'a', due: '2026-11-20T18:00:00', created: '2026-11-18T09:00:00' },
      { id: 'b', due: '2026-11-20T18:00:00', created: '2026-11-21T09:00:00' },
      { id: 'c', due: null },
      { id: 'd', due: 'bad-date' },
    ]);
    eq(events.length, 2);
    eq(core.ymd(events[0].startDay), '2026-11-18');
    eq(core.ymd(events[0].endDay), '2026-11-20');
    eq(core.ymd(events[1].startDay), '2026-11-20', '创建时间晚于截止');
    eq(events[0].color, 0);
    eq(events[1].color, 1);
  });

  test('buildWeekSegments：跨周片段剪切与 col/span', () => {
    const events = api.buildEvents([
      { id: 'a', due: '2026-11-24T18:00:00', created: '2026-11-21T09:00:00' },
    ]);
    const week1 = api.buildWeekSegments(
      events,
      new Date(2026, 10, 16),
      new Date(2026, 10, 22),
      new Date(2026, 10, 1),
      new Date(2026, 10, 30)
    );
    eq(week1.length, 1);
    eq(week1[0].col, 5);
    eq(week1[0].span, 2);
    eq(week1[0].cutLeft, false);
    eq(week1[0].cutRight, true);

    const week2 = api.buildWeekSegments(
      events,
      new Date(2026, 10, 23),
      new Date(2026, 10, 29),
      new Date(2026, 10, 1),
      new Date(2026, 10, 30)
    );
    eq(week2.length, 1);
    eq(week2[0].col, 0);
    eq(week2[0].span, 2);
    eq(week2[0].cutLeft, true);
  });

  test('buildWeekSegments：跨月只保留本月部分', () => {
    const events = api.buildEvents([
      { id: 'a', due: '2026-11-03T18:00:00', created: '2026-10-28T09:00:00' },
    ]);
    const seg = api.buildWeekSegments(
      events,
      new Date(2026, 9, 26),
      new Date(2026, 10, 1),
      new Date(2026, 10, 1),
      new Date(2026, 10, 30)
    );
    eq(seg.length, 1);
    eq(seg[0].col, 6);
    eq(seg[0].span, 1);
    eq(seg[0].cutLeft, true);
    eq(seg[0].cutRight, true);
  });

  test('buildWeekSegments：不相交返回空数组', () => {
    const events = api.buildEvents([
      { id: 'a', due: '2026-12-02T18:00:00', created: '2026-12-01T09:00:00' },
    ]);
    const seg = api.buildWeekSegments(
      events,
      new Date(2026, 10, 16),
      new Date(2026, 10, 22),
      new Date(2026, 10, 1),
      new Date(2026, 10, 30)
    );
    eq(seg.length, 0);
  });

  test('buildMonthWeeks：2026 年 11 月的周结构与事项计数', () => {
    const events = api.buildEvents([
      { id: 'a', due: '2026-11-05T18:00:00', created: '2026-11-01T09:00:00' },
      { id: 'b', due: '2026-12-02T18:00:00', created: '2026-11-30T09:00:00' },
    ]);
    const model = api.buildMonthWeeks(2026, 10, events);
    eq(model.weeks.length, 6);
    eq(core.ymd(model.weeks[0].weekStart), '2026-10-26');
    eq(core.ymd(model.weeks[5].weekStart), '2026-11-30');
    eq(model.monthCount, 1, '只统计本月结束的事项');
    eq(model.weeks[0].segments.length, 1, '11 月 1 日所属周应含 a 的片段');
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
