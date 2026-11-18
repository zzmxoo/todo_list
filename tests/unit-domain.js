(function () {
  const holiday = window.HolidayDomain;
  const quote = window.QuoteDomain;
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

  test('buildHolidayMap 只收放假日期，合并多年份', () => {
    const map = holiday.buildHolidayMap({
      2026: {
        days: [
          { date: '2026-10-01', name: '国庆节', off: true },
          { date: '2026-10-10', name: '国庆节', off: false },
        ],
      },
      2027: {
        days: [{ date: '2027-01-01', name: '元旦', off: true }],
      },
    });
    eq(map.size, 2);
    eq(map.get('2026-10-01'), '国庆节');
    eq(map.get('2027-01-01'), '元旦');
    eq(map.has('2026-10-10'), false, '调休不显示');
  });

  test('buildHolidayMap 容忍缺失与脏数据', () => {
    eq(holiday.buildHolidayMap(null).size, 0);
    eq(holiday.buildHolidayMap({ 2026: {} }).size, 0);
    const map = holiday.buildHolidayMap({
      2026: { days: [{ date: '2026-05-01', off: true }, null, { off: true }] },
    });
    eq(map.get('2026-05-01'), '节假日', '缺省名称');
    eq(map.size, 1);
  });

  test('pickQuote 避开上一条', () => {
    const pool = ['a', 'b', 'c'];
    let seq = [1 / 3, 2 / 3];
    const rand = () => (seq.length ? seq.shift() : 0);
    const picked = quote.pickQuote(pool, 1, rand);
    eq(picked.index, 2);
    eq(picked.item, 'c');
  });

  test('pickQuote 只有一条时允许重复', () => {
    const picked = quote.pickQuote(['only'], 0, () => 0.99);
    eq(picked.index, 0);
    eq(picked.item, 'only');
  });

  test('pickQuote 空池返回 null，随机源卡死不会死循环', () => {
    eq(quote.pickQuote([], 0), null);
    const picked = quote.pickQuote(['a', 'b'], 0, () => 0);
    eq(picked.index, 0);
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
