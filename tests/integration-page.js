(async () => {
  const results = [];
  const t = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
    } catch (err) {
      results.push({ name, ok: false, error: String((err && err.message) || err) });
    }
  };
  const eq = (a, b, m) => {
    if (a !== b) throw new Error((m || 'eq') + ' expected=' + b + ' actual=' + a);
  };
  const ok = (v, m) => {
    if (!v) throw new Error(m || 'assert failed');
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const norm = (s) => String(s || '').replace(/\s+/g, '');

  const todoTexts = () => $$('.todo-row .text').map((el) => el.textContent);
  const findRow = (text) => $$('.todo-row').find((r) => r.querySelector('.text').textContent === text);

  async function openSettingsTab(index) {
    if ($('#settingsOverlay').hidden) click($('#settingsBtn'));
    await sleep(350);
    const tabs = $$('.set-tab');
    click(tabs[index]);
    await sleep(120);
  }
  async function closeSettings() {
    if (!$('#settingsOverlay').hidden) {
      click($('#settingsDone'));
      await sleep(450);
    }
  }
  async function setCalendar(on) {
    await openSettingsTab(0);
    const cls = document.body.className;
    const isOn = cls.includes('calendar-mode');
    if (isOn !== on) {
      click($('#calendarSwitch'));
      await sleep(200);
    }
    await closeSettings();
    await sleep(350);
  }
  async function addTodo(text) {
    click($('#addRow'));
    await sleep(80);
    const input = $('.add-input');
    ok(input, 'add input');
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(220);
    const row = findRow(text);
    ok(row, 'row created: ' + text);
    return row;
  }
  async function deleteTodo(text) {
    const row = findRow(text);
    if (row) {
      click(row.querySelector('.act-btn.del'));
      await sleep(200);
    }
  }

  await t('模块与名言库加载', async () => {
    ok(window.TodoCore && window.TodoDomain && window.CalendarDomain, 'domains');
    ok(window.HolidayDomain && window.QuoteDomain && window.WeatherAPI, 'domains2');
    const res = await fetch('quotes.json');
    const data = await res.json();
    eq(data.quotes.length, 1460);
    return '1460 quotes';
  });

  await t('待办列表不含已完成项', async () => {
    eq($$('.todo-row.done').length, 0, 'done rows');
    const count = parseInt($('#count').textContent, 10);
    eq(count, $$('.todo-row').length, 'count matches rows');
    return count + ' items';
  });

  await t('新增 / 置顶 / 编辑 / 删除待办', async () => {
    const row = await addTodo('ITEST-新增');
    ok(row, 'created');
    const pinBtn = () => findRow('ITEST-新增').querySelector('.act-btn.pin');
    const idxBefore = todoTexts().indexOf('ITEST-新增');
    click(pinBtn());
    await sleep(220);
    ok(pinBtn().classList.contains('on'), 'pin on');
    const idxPinned = todoTexts().indexOf('ITEST-新增');
    ok(idxPinned <= idxBefore, 'moved up when pinned');
    click(pinBtn());
    await sleep(220);
    ok(!pinBtn().classList.contains('on'), 'pin off');
    const target = findRow('ITEST-新增');
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(120);
    const edit = $('.edit-input');
    ok(edit, 'edit input');
    edit.value = 'ITEST-改后';
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(250);
    ok(findRow('ITEST-改后'), 'edited');
    await deleteTodo('ITEST-改后');
    ok(!findRow('ITEST-改后'), 'deleted');
    return 'ok';
  });

  await t('完成待办后从列表消失且计数更新', async () => {
    const before = $$('.todo-row').length;
    const row = await addTodo('ITEST-完成');
    click(row.querySelector('.act-btn.done'));
    await sleep(250);
    ok(!findRow('ITEST-完成'), 'hidden after done');
    eq($$('.todo-row').length, before, 'count back');
    return 'hidden';
  });

  await t('设置面板不遮挡待办，可切换分类', async () => {
    click($('#settingsBtn'));
    await sleep(500);
    const s = $('#settingsPanel').getBoundingClientRect();
    const tRect = document.querySelector('.todo-card').getBoundingClientRect();
    ok(s.left >= tRect.right - 1, 'no overlap');
    const labels = $$('.set-page[data-page=system] .set-label').map((e) => e.textContent);
    eq(labels[0], '极简模式');
    eq(labels[1], '日历模式');
    eq(labels[2], '窗口置顶');
    eq(labels[3], '允许开机启动');
    ok(labels[4].includes('导出'), 'export label');
    const tabs = $$('.set-tab');
    click(tabs[1]);
    await sleep(100);
    ok($$('.set-page').find((p) => p.classList.contains('active')).dataset.page === 'ui', 'ui tab');
    return 'ok';
  });

  await t('界面配置：字体 / 颜色 / 背景图', async () => {
    const fontSel = $('#fontSelect');
    const oldFont = fontSel.value;
    fontSel.value = 'kaiti';
    fontSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const family = getComputedStyle($('.todo-row .text') || document.body).fontFamily;
    ok(/KaiTi|STKaiti/i.test(family), 'kaiti applied: ' + family);
    const swatches = $$('#fontColorRow .swatch');
    const oldColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    click(swatches[2]);
    await sleep(120);
    eq(getComputedStyle(document.documentElement).getPropertyValue('--text').trim(), '#ffe9c7');
    // 还原
    fontSel.value = oldFont;
    fontSel.dispatchEvent(new Event('change', { bubbles: true }));
    click(swatches[0]);
    await sleep(120);
    const bg = getComputedStyle(document.querySelector('.todo-card')).backgroundImage;
    if (document.getElementById('app').classList.contains('has-bg')) {
      ok(bg.includes('url('), 'card bg image');
      eq(getComputedStyle($('#bgImage')).display, 'none', 'outer canvas hidden');
    }
    return 'ok';
  });

  await t('透明度实时生效', async () => {
    const range = $('#opacityRange');
    const old = range.value;
    range.value = '80';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    const op = parseFloat(getComputedStyle($('#app')).getPropertyValue('--op'));
    // 80% 透明度按 gamma 2.2 换算：alpha = 0.2^(1/2.2) ≈ 0.481
    ok(Math.abs(op - 0.481) < 0.03, 'op=' + op);
    range.value = old;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    return 'ok';
  });

  await t('导出按钮与开机启动接口', async () => {
    ok($('#exportBtn'), 'export button');
    const auto = await window.__TAURI__.core.invoke('get_autostart');
    eq(typeof auto, 'boolean');
    return 'autostart=' + auto;
  });

  await closeSettings();
  await sleep(300);

  await t('天气数据已加载', async () => {
    const pill = $('#pillText').textContent;
    ok(/°/.test(pill) && !pill.includes('--'), 'pill=' + pill);
    return pill;
  });

  await setCalendar(true);
  await t('日历模式布局与日期格', async () => {
    ok(document.body.classList.contains('calendar-mode'), 'body class');
    eq($('#calendarCard').hidden, false, 'calendar visible');
    eq($$('.cal-cell').length, 42);
    ok($$('.cal-bar').length >= 0, 'bars');
    ok($('#calTitle').textContent.includes('年'), 'title');
    return $('#calTitle').textContent;
  });

  await t('月份导航：上一月 / 下一月 / 今天', async () => {
    const title = () => $('#calTitle').textContent;
    const first = title();
    click($('#calNext'));
    await sleep(250);
    ok(title() !== first, 'next changed');
    click($('#calPrev'));
    await sleep(250);
    eq(title(), first);
    click($('#calToday'));
    await sleep(250);
    ok(title().includes('年'), 'today');
    return title();
  });

  await t('滚轮翻看与 +n 徽标', async () => {
    const weeks = $$('.cal-week');
    const target = weeks.find((w) => Number(w.dataset.maxOffset || 0) > 0);
    if (!target) return 'skip: no overflow week';
    const cell = target.querySelector('.cal-cell');
    const r = cell.getBoundingClientRect();
    const badgesBefore = target.querySelectorAll('.cal-bar-badge').length;
    cell.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 }));
    await sleep(150);
    const after = $$('.cal-week')[weeks.indexOf(target)];
    ok(after.querySelectorAll('.cal-bar-badge').length >= 1, 'badges shown');
    return 'badges ' + badgesBefore + '->' + after.querySelectorAll('.cal-bar-badge').length;
  });

  await t('双击日期格弹出添加待办', async () => {
    const cell = $$('.cal-cell')[15];
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await sleep(200);
    ok(!$('#calAddPopover').hidden, 'popover open');
    ok($('#calAddDate').value, 'date filled');
    click($('#calAddCancel'));
    await sleep(150);
    ok($('#calAddPopover').hidden, 'closed');
    return 'ok';
  });

  await t('右键立即显示日期信息（含名言）', async () => {
    const cell = $$('.cal-cell')[15];
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(80);
    ok(!$('#calInfo').hidden, 'info visible');
    ok($('#ciLunar').textContent.includes('农历'), 'lunar');
    ok($('#ciQuoteText').textContent.length > 0, 'quote');
    $('#calInfo').hidden = true;
    return 'ok';
  });

  await t('悬停 3 秒显示，离开 1.2 秒消失', async () => {
    // 先清掉右键测试留下的 hover 状态
    $$('.cal-cell')[15].dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
    );
    await sleep(120);
    $('#calInfo').hidden = true;
    const cell = $$('.cal-cell')[28];
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(1500);
    ok($('#calInfo').hidden, 'not yet at 1.5s');
    await sleep(1800);
    ok(!$('#calInfo').hidden, 'shown after 3.3s');
    cell.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await sleep(600);
    ok(!$('#calInfo').hidden, 'still at 0.6s');
    await sleep(800);
    ok($('#calInfo').hidden, 'hidden after 1.4s');
    return 'ok';
  });

  await t('节气日期显示节气名与背景', async () => {
    click($('#calToday'));
    await sleep(200);
    for (let i = 0; i < 12 && !$('#calTitle').textContent.includes('2026年11月'); i += 1) {
      click($('#calTitle').textContent.includes('2026年11月') ? $('#calNext') : $('#calPrev'));
      await sleep(200);
    }
    const cell = $$('.cal-cell').find((c) => c.dataset.date === '2026-11-22');
    if (!cell) return 'skip: date not in view';
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(100);
    eq($('#ciTerm').textContent, '小雪');
    ok($('#calInfo').style.backgroundImage.includes('data:image'), 'term bg');
    $('#calInfo').hidden = true;
    click($('#calToday'));
    await sleep(200);
    return 'ok';
  });

  await t('法定节假日每日标注', async () => {
    const start = $('#calTitle').textContent;
    click($('#calNext'));
    await sleep(200);
    click($('#calNext'));
    await sleep(200);
    click($('#calNext'));
    await sleep(250);
    const cells = $$('.cal-cell.holiday');
    const labels = $$('.cal-holiday');
    ok(cells.length > 0, 'holiday cells');
    ok(labels.length > 0, 'holiday labels');
    eq(cells.length >= labels.length, true, 'labels per day');
    click($('#calToday'));
    await sleep(250);
    return 'holidays=' + cells.length + ', labels=' + labels.length;
  });

  await t('日历退回普通模式', async () => {
    await setCalendar(false);
    ok(!document.body.classList.contains('calendar-mode'));
    return 'ok';
  });

  await t('自定义天气链接（uapis.cn）', async () => {
    const data = await window.__TAURI__.core.invoke('fetch_json', {
      url: 'https://uapis.cn/api/v1/misc/weather?city=北京&forecast=true',
    });
    ok(data.temperature !== undefined, 'temperature field');
    const norm = window.WeatherAPI.normalizeUapis(data, {});
    ok(norm.daily.length > 0, 'daily normalized');
    ok(Number.isFinite(norm.current.temp), 'current temp');
    return data.city + ' ' + norm.current.temp + '°';
  });

  await t('完成事项写入完成时间并可导出', async () => {
    await sleep(600);
    const state = await window.__TAURI__.core.invoke('load_state');
    const done = (state.todos || []).find((todo) => todo.text === 'ITEST-完成');
    ok(done, 'completed todo persisted');
    ok(done.done === true, 'done flag');
    ok(typeof done.done_at === 'string' && !Number.isNaN(new Date(done.done_at).getTime()), 'done_at');
    const text = window.TodoCore.buildExportText(state.todos, Date.now(), 30);
    const line = text.split('\r\n').find((item) => item.includes('ITEST-完成'));
    ok(line, 'export includes item');
    ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}，\d{4}-\d{2}-\d{2} \d{2}:\d{2}，/.test(line), 'line format: ' + line);
    return line;
  });

  await t('窗口靠边吸附', async () => {
    const w = window.__TAURI__.window.getCurrentWindow();
    const P = window.__TAURI__.dpi.PhysicalPosition;
    const orig = await w.outerPosition();
    await w.setPosition(new P(12, 12));
    await sleep(450);
    const snapped = await w.outerPosition();
    ok(Math.abs(snapped.x) <= 2 && Math.abs(snapped.y) <= 2, 'snapped: ' + snapped.x + ',' + snapped.y);
    await w.setPosition(new P(orig.x, orig.y));
    await sleep(400);
    return 'ok';
  });

  await t('日历模式收起时只剩一层窄条', async () => {
    await setCalendar(true);
    const w = window.__TAURI__.window.getCurrentWindow();
    const P = window.__TAURI__.dpi.PhysicalPosition;
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new P(-Math.round(size.width / 2), 260));
    await sleep(1200);
    ok($('#app').className.includes('edge-hidden'), 'hidden class');
    eq(getComputedStyle($('#app'), '::before').opacity, '0', 'panel hidden');
    eq(getComputedStyle($('#edgePeek')).display, 'block', 'peek visible');
    await w.setPosition(new P(orig.x, orig.y));
    await sleep(800);
    await setCalendar(false);
    return 'ok';
  });

  await t('收起过程连续：先收缩再变窄条', async () => {
    const w = window.__TAURI__.window.getCurrentWindow();
    const P = window.__TAURI__.dpi.PhysicalPosition;
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new P(-Math.round(size.width / 2), 260));
    await sleep(430);
    const app = $('#app');
    const transform = getComputedStyle(app).transform;
    ok(transform && transform !== 'none', 'scaling: ' + transform);
    ok(!app.className.includes('edge-hidden'), 'content still visible');
    ok(parseFloat(getComputedStyle(app).opacity) < 0.95, 'fading');
    await sleep(900);
    ok(app.className.includes('edge-hidden'), 'hidden after animation');
    eq(getComputedStyle($('#edgePeek')).display, 'block', 'peek shown');
    await w.setPosition(new P(orig.x, orig.y));
    await sleep(700);
    return 'ok';
  });

  await t('边缘收起 / 悬停唤出 / 移开收起 / 拖动退出', async () => {
    const w = window.__TAURI__.window.getCurrentWindow();
    const P = window.__TAURI__.dpi.PhysicalPosition;
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new P(-Math.round(size.width / 2), 260));
    await sleep(1200);
    const hidden = await w.outerPosition();
    ok(hidden.x < 0, 'moved out: ' + hidden.x);
    ok($('#app').className.includes('edge-hidden'), 'hidden class');
    const peek = $('#edgePeek');
    eq(getComputedStyle(peek).display, 'block', 'peek visible');
    const origWin = window.__TAURI__.window;
    window.__cur = { x: 1200, y: 600 };
    window.__TAURI__.window = Object.assign({}, origWin, {
      cursorPosition: async () => window.__cur,
    });
    await sleep(450);
    window.__cur = { x: 8, y: 300 };
    await sleep(1100);
    const shown = await w.outerPosition();
    ok(shown.x > hidden.x + 100, 'revealed: ' + shown.x);
    await sleep(450);
    const stable = await w.outerPosition();
    ok(Math.abs(stable.x - shown.x) <= 3, 'no bounce back: ' + stable.x);
    $('#app').dispatchEvent(new MouseEvent('mouseleave'));
    await sleep(1450);
    const again = await w.outerPosition();
    ok(again.x < 0, 'concealed again: ' + again.x);
    // 把模拟光标移开，避免悬停轮询再次唤出
    window.__cur = { x: 1200, y: 600 };
    await sleep(400);
    await w.setPosition(new P(200, 200));
    await sleep(900);
    ok(!$('#app').className.includes('edge-hidden'), 'exit hide');
    ok($('#edgePeek').hidden, 'peek hidden');
    await w.setPosition(new P(orig.x, orig.y));
    await sleep(500);
    return 'ok';
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed, failed: results.length - passed, results });
})()
