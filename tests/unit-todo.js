(function () {
  const api = window.TodoDomain;
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

  test('parseDue 处理空值与非法日期', () => {
    eq(api.parseDue(null), null);
    eq(api.parseDue({ due: '' }), null);
    eq(api.parseDue({ due: 'not-a-date' }), null);
    ok(api.parseDue({ due: '2026-11-18T09:00:00' }) instanceof Date, 'valid');
  });

  test('dueState 五种状态与 30 分钟边界', () => {
    const now = new Date(2026, 10, 18, 12, 0).getTime();
    eq(api.dueState({ due: '2026-11-18T12:20:00' }, now), 'soon');
    eq(api.dueState({ due: '2026-11-18T12:30:00' }, now), 'soon', '30分钟整');
    eq(api.dueState({ due: '2026-11-18T12:31:00' }, now), 'normal');
    eq(api.dueState({ due: '2026-11-18T11:59:00' }, now), 'overdue');
    eq(api.dueState({ due: '2026-11-18T11:00:00', done: true }, now), 'done');
    eq(api.dueState({}, now), 'none');
  });

  test('dueText 今天 / 明天 / 昨天 / 跨年', () => {
    const now = new Date(2026, 10, 18, 12, 0);
    eq(api.dueText({ due: '2026-11-18T18:00:00' }, now), '今天 18:00');
    eq(api.dueText({ due: '2026-11-19T09:00:00' }, now), '明天 09:00');
    eq(api.dueText({ due: '2026-11-17T20:30:00' }, now), '昨天 20:30');
    eq(api.dueText({ due: '2026-12-31T08:05:00' }, now), '12月31日 08:05');
    eq(api.dueText({ due: '2025-12-31T08:05:00' }, now), '2025年12月31日 08:05');
  });

  test('todoDuration 分钟 / 小时 / 天', () => {
    const created = '2026-11-18T10:00:00';
    eq(api.todoDuration({ created }, new Date('2026-11-18T10:05:00')), '');
    eq(api.todoDuration({ created }, new Date('2026-11-18T10:40:00')), '40分');
    eq(api.todoDuration({ created }, new Date('2026-11-18T12:30:00')), '2时30分');
    eq(api.todoDuration({ created }, new Date('2026-11-19T12:00:00')), '1天');
    eq(
      api.todoDuration({ start: '2026-11-18T09:00:00' }, new Date('2026-11-18T11:00:00')),
      '2时'
    );
  });

  test('sortTodos：置顶优先、完成靠后、同组稳定', () => {
    const list = [
      { id: 'a' },
      { id: 'b', pinned: true },
      { id: 'c', done: true },
      { id: 'd', pinned: true, done: true },
      { id: 'e' },
    ];
    eq(api.sortTodos(list).map((t) => t.id).join(','), 'b,d,a,e,c');
  });

  test('createTodo 去空格、拒绝空内容、默认字段', () => {
    eq(api.createTodo({ text: '   ' }), null);
    eq(api.createTodo({}), null);
    const todo = api.createTodo({ id: '1', text: '  写周报  ', due: '2026-11-18T09:00:00' });
    eq(todo.text, '写周报');
    eq(todo.done, false);
    eq(todo.done_at, null);
    eq(todo.pinned, false);
    eq(todo.due, '2026-11-18T09:00:00');
    eq(todo.start, null);
    ok(todo.created, 'created 自动填充');
    eq(todo.source, '', '手动待办没有来源');
    eq(todo.provider, '', '手动待办没有 provider');
    const ai = api.createTodo({ text: 'AI 待办', source: 'DeepSeek', provider: 'dsh' });
    eq(ai.source, 'DeepSeek');
    eq(ai.provider, 'dsh');
  });

  test('applyDone 记录 / 清空完成时间且不修改原对象', () => {
    const todo = { id: '1', done: false, done_at: null };
    const done = api.applyDone(todo, true, '2026-11-18T10:00:00');
    eq(done.done, true);
    eq(done.done_at, '2026-11-18T10:00:00');
    eq(todo.done, false, '原对象不变');
    const undone = api.applyDone(done, false);
    eq(undone.done, false);
    eq(undone.done_at, null);
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
