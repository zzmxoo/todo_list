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

  test('节日格渲染后整体偏暖（清明节豁免）', () => {
    // 关键：判的是叠色合成后的颜色，不是常量。常量再暖，被冷色玻璃底
    // 稀释后仍会渲染成蓝紫，这正是之前遗漏的问题。
    const expected = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];
    const missing = expected.filter((n) => !(n in holiday.TINT));
    if (missing.length) throw new Error('缺少节日: ' + missing.join(','));
    const wrong = [];
    for (const name of expected) {
      if (name === '清明节') continue; // 冷色豁免
      if (holiday.isRenderedTintColdOrDim(name)) {
        wrong.push(`${name} 渲染后偏冷或偏暗`);
      }
    }
    if (wrong.length) throw new Error(wrong.join('; '));
  });

  test('节日配色不使用红色系', () => {
    // 需求：不要红色系。红色区间取色相 345°–15°（含正红、品红边），
    // 常量与渲染后都要检查——透明叠色会把红色往底色方向拉，两个都看更稳。
    const hueOf = (text) => {
      const [r, g, b] = text.split(',').map((n) => Number(n.trim()) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h;
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      return h < 0 ? h + 360 : h;
    };
    const isRed = (h) => h <= 15 || h >= 345;
    const bad = [];
    for (const name of Object.keys(holiday.TINT)) {
      if (name === '清明节') continue; // 竹青，本就不是红色
      const raw = holiday.holidayTint(name);
      const rendered = holiday.composite(raw, holiday.holidayBase(name), holiday.TINT_ALPHA);
      const renderedText = rendered ? rendered.join(', ') : '';
      const h1 = hueOf(raw);
      const h2 = renderedText ? hueOf(renderedText) : h1;
      if (isRed(h1)) bad.push(`${name} 常量色相 ${Math.round(h1)}° 偏红`);
      if (isRed(h2)) bad.push(`${name} 渲染色相 ${Math.round(h2)}° 偏红`);
    }
    if (bad.length) throw new Error(bad.join('; '));
  });

  test('节日渲染色之间可区分（最小 RGB 距离 ≥ 8）', () => {
    // 防止"改成暖色但七个节日看起来都一样"的回归。
    const names = ['元旦', '春节', '劳动节', '端午节', '中秋节', '国庆节'];
    const pairs = [];
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        pairs.push([holiday.renderedTintDistance(names[i], names[j]), names[i], names[j]]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    if (pairs[0][0] < 8) {
      throw new Error(`最相似的两种节日差异仅 ${pairs[0][0].toFixed(1)}: ${pairs[0][1]}-${pairs[0][2]}`);
    }
  });

  test('合并节日名可按首项匹配（如"国庆节、中秋节"）', () => {
    eq(holiday.holidayTint('国庆节、中秋节'), holiday.TINT['国庆节']);
    eq(holiday.holidayTint('中秋节、国庆节'), holiday.TINT['中秋节']);
  });

  test('holidayTint 未知节日回退到中性暖色且不与任何节日撞色', () => {
    const fallback = holiday.holidayTint('不存在的节日');
    eq(fallback, '246, 186, 96');
    const clash = Object.values(holiday.TINT).filter((v) => v === fallback);
    eq(clash.length, 0, '回退色不应等于某个节日的颜色');
  });

  test('isRenderedTintColdOrDim 判定基于合成后的颜色', () => {
    // 清明节基准：允许冷色
    eq(holiday.isRenderedTintColdOrDim('春节'), false, '春节应判为暖');
    eq(holiday.isRenderedTintColdOrDim('国庆节'), false, '国庆应判为暖');
    // 若把某节日改成纯绿，合成后仍应判为冷
    const saved = holiday.TINT['春节'];
    holiday.TINT['春节'] = '0, 200, 0';
    eq(holiday.isRenderedTintColdOrDim('春节'), true, '纯绿应判为冷');
    holiday.TINT['春节'] = saved;
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
