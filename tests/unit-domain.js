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

  test('节日按大小分两个色系：大节日柔和暖色，小节日低饱和竹青', () => {
    // 需求：颜色不要太多。大节日统一一个暖色系，小节日用同色系的冷色。
    const groups = holiday.GROUPS;
    eq(Object.keys(groups).length, 2, '色系数');
    for (const name of ['春节', '国庆节', '元旦']) {
      eq(holiday.groupOf(name), 'warm', name + ' 应在暖色系');
    }
    for (const name of ['清明节', '端午节', '劳动节', '中秋节']) {
      eq(holiday.groupOf(name), 'cool', name + ' 应在冷色系');
    }
    const all = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];
    const missing = all.filter((n) => !holiday.tintGroups()[n]);
    if (missing.length) throw new Error('缺少节日: ' + missing.join(','));
  });

  test('同色系的节日渲染色完全一致', () => {
    eq(holiday.holidayTint('春节'), holiday.holidayTint('国庆节'), '春节/国庆同色');
    eq(holiday.holidayTint('元旦'), holiday.holidayTint('国庆节'), '元旦/国庆同色');
    eq(holiday.holidayTint('清明节'), holiday.holidayTint('端午节'), '清明/端午同色');
    eq(holiday.holidayTint('劳动节'), holiday.holidayTint('中秋节'), '劳动/中秋同色');
  });

  test('节日色块视觉重量足够轻，不能抢走主界面焦点', () => {
    // 需求：连续 7 天的大面积高亮色块会抢走左侧待办清单的焦点，
    // 甚至比"今天"的白框还重。要求渲染后与普通格的差异远小于早期实现。
    // 早期不透明底方案差异约 84；12% 单层叠色约 30。
    const surface = [48, 39, 105];
    const limit = 40;
    const heavy = [];
    for (const name of Object.keys(holiday.tintGroups())) {
      const rendered = holiday.composite(
        holiday.holidayTint(name),
        holiday.holidayBase(name),
        holiday.TINT_ALPHA
      );
      const d = Math.sqrt(rendered.reduce((sum, v, i) => sum + (v - surface[i]) ** 2, 0));
      if (d > limit) heavy.push(`${name} 差异 ${d.toFixed(1)}`);
    }
    if (heavy.length) throw new Error('色块过重: ' + heavy.join('; '));
  });

  test('节日文字在浅色块上仍可读（对比度 ≥ 4.5）', () => {
    const lumOf = (rgb) => {
      const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    };
    const contrast = (a, b) => {
      const la = lumOf(a);
      const lb = lumOf(b);
      const hi = Math.max(la, lb);
      const lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };
    const label = [255, 217, 210];
    const bad = [];
    for (const name of Object.keys(holiday.tintGroups())) {
      const cell = holiday.composite(
        holiday.holidayTint(name),
        holiday.holidayBase(name),
        holiday.TINT_ALPHA
      );
      const c = contrast(label, cell);
      if (c < 4.5) bad.push(`${name} 对比度 ${c.toFixed(2)}`);
    }
    if (bad.length) throw new Error(bad.join('; '));
  });

  test('合并节日名可按首项匹配（如"国庆节、中秋节"）', () => {
    eq(holiday.holidayTint('国庆节、中秋节'), holiday.holidayTint('国庆节'));
    eq(holiday.holidayTint('中秋节、国庆节'), holiday.holidayTint('中秋节'));
  });

  test('未知节日归入冷色系，不额外增加颜色', () => {
    eq(holiday.groupOf('不存在的节日'), 'cool');
    eq(holiday.holidayTint('不存在的节日'), holiday.holidayTint('清明节'));
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
