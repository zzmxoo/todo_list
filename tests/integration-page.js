/*
 * 回归测试集（UI / 集成层）
 *
 * 每条用例对应一个已修复的问题或必须长期保持的行为，名称前缀 [REG-xx]。
 * tests/REGRESSION.md 是清单：修复提交 -> 用例编号 -> 自动化位置。
 *
 * 约定：修复 bug 时，先在这里补一条能复现旧问题的用例，再改代码；
 * 用例必须能在当前版本通过，并在旧版本上失败。
 */
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
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
  const getWin = () => window.__TAURI__.window.getCurrentWindow();
  const Pos = () => window.__TAURI__.dpi.PhysicalPosition;

  const todoTexts = () => $$('.todo-row .text').map((el) => el.textContent);
  const findRow = (text) => $$('.todo-row').find((r) => r.querySelector('.text').textContent === text);

  async function waitFor(fn, timeout = 2000, step = 60) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      if (await fn()) return performance.now() - start;
      await sleep(step);
    }
    return -1;
  }

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
    const isOn = document.body.className.includes('calendar-mode');
    if (isOn !== on) {
      click($('#calendarSwitch'));
      await sleep(200);
    }
    await closeSettings();
    await sleep(350);
  }
  async function ensureMinimal(on) {
    await openSettingsTab(0);
    const isOn = $('#minimalSwitch').classList.contains('on');
    if (isOn !== on) {
      click($('#minimalSwitch'));
      await sleep(250);
    }
    await closeSettings();
    await sleep(400);
  }
  async function ensureWeather(on) {
    if (document.body.classList.contains('calendar-mode')) return;
    const active = $('#weatherPill').classList.contains('active');
    if (active !== on) {
      click($('#weatherPill'));
      await sleep(450);
    }
  }
  async function addTodo(text) {
    let input = null;
    for (let attempt = 0; attempt < 3 && !input; attempt += 1) {
      click($('#addRow'));
      await sleep(120);
      input = $('.add-input');
      if (!input) await sleep(150);
      input = $('.add-input');
    }
    ok(input, 'add input');
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(220);
    const row = findRow(text);
    ok(row, 'row created: ' + text);
    return row;
  }
  async function addDueTodo(text, dateStr) {
    const row = await addTodo(text);
    click(row.querySelector('.act-btn.due'));
    await sleep(160);
    const date = $('#dueDate');
    const time = $('#dueTime');
    date.value = dateStr;
    date.dispatchEvent(new Event('input', { bubbles: true }));
    time.value = '18:00';
    time.dispatchEvent(new Event('input', { bubbles: true }));
    click($('#dueOk'));
    await sleep(320);
    return findRow(text);
  }
  async function deleteTodo(text) {
    const row = findRow(text);
    if (row) {
      click(row.querySelector('.act-btn.del'));
      await sleep(200);
    }
  }
  async function goMonth(year, month) {
    for (let i = 0; i < 24; i += 1) {
      const title = $('#calTitle').textContent;
      const m = title.match(/^(\d+)年(\d+)月$/);
      if (!m) break;
      const y = Number(m[1]);
      const mm = Number(m[2]);
      if (y === year && mm === month) return true;
      click(y < year || (y === year && mm < month) ? $('#calNext') : $('#calPrev'));
      await sleep(180);
    }
    return false;
  }
  async function resetEdge(w) {
    if ($('#app').className.includes('edge-hidden')) {
      const PPos = Pos();
      await w.setPosition(new PPos(500, 400));
      await sleep(900);
    }
  }
  async function midAnimationHide(w, orig, size) {
    const PPos = Pos();
    await w.setPosition(new PPos(-Math.round(size.width / 2), 260));
    await sleep(1200);
    return orig;
  }

  // 统一初始状态：普通模式、天气收起、非极简，避免上次运行的设置影响用例。
  if (document.body.classList.contains('calendar-mode')) await setCalendar(false);
  if ($('#weatherPill').classList.contains('active')) {
    click($('#weatherPill'));
    await sleep(450);
  }
  if ($('#minimalSwitch') && $('#minimalSwitch').classList.contains('on')) {
    await ensureMinimal(false);
  }
  click($('#calToday'));
  await sleep(200);

  await t('[REG-01] 模块与名言库加载（1427 条、无重复）', async () => {
    ok(window.TodoCore && window.TodoDomain && window.CalendarDomain, 'domains');
    ok(window.HolidayDomain && window.QuoteDomain && window.WeatherAPI, 'domains2');
    const res = await fetch('quotes.json');
    const data = await res.json();
    eq(data.quotes.length, 1427);
    eq(new Set(data.quotes.map((q) => q.t)).size, 1427, 'unique quotes');
    return '1427 quotes';
  });

  await t('[REG-39] 名言库不含贬义 / 嘲讽 / 粗俗语句', async () => {
    // 名言用于桌面点缀，必须是正向或中性的。曾收录过
    // 「在中国，创新就是率先模仿」这类嘲讽式论断，需要长期防回归。
    const res = await fetch('quotes.json');
    const data = await res.json();
    const bad = [
      // 贬义词直接指向人
      /傻瓜|傻子|笨婆|蠢货|笨蛋|废物|窝囊/,
      // 粗俗比喻
      /疯狗|瘟疫|蛆|狗屎/,
      // 嘲讽他人志向
      /母鸡的理想/,
      // 上述被移除的具体语句
      /在中国，创新就是率先模仿/,
      /为爱情而生活是愚蠢/,
      /小人记仇/,
      /虚伪的朋友，遇事常点头哈腰/,
      /奸诈的聪明人/,
    ];
    const hits = data.quotes.filter((q) => bad.some((re) => re.test(q.t)));
    if (hits.length) {
      throw new Error(
        '发现 ' + hits.length + ' 条不当语句：' + hits.slice(0, 3).map((q) => q.t).join(' / ')
      );
    }
    return 'no derogatory quotes';
  });

  await t('[REG-02] 已完成待办从列表隐藏且计数正确', async () => {
    eq($$('.todo-row.done').length, 0, 'done rows');
    const countText = $('#count').textContent;
    const count = countText ? parseInt(countText, 10) : 0;
    eq(count, $$('.todo-row').length, 'count matches rows');
    return count + ' items';
  });

  await t('[REG-03] 新增 / 置顶 / 编辑 / 删除待办', async () => {
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

  await t('[REG-04] 输入中的待办草稿不会被后台重绘清空', async () => {
    // 955503f：后台刷新（跨天 tick）重绘列表时，正在输入的内容必须保留。
    const anchor = await addTodo('ITEST-草稿锚点');
    ok(anchor, 'anchor');
    click($('#addRow'));
    await sleep(150);
    const input = $('.add-input');
    ok(input, 'draft input');
    input.value = 'ITEST-草稿';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // 模拟跨天 tick：应用用全局 Date 判断日期变化，只改 Date 不动焦点。
    const RealDate = window.Date;
    const fake = new RealDate(RealDate.now() + 24 * 60 * 60 * 1000);
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fake.getTime());
        else super(...args);
      }
      static now() {
        return fake.getTime();
      }
    }
    window.Date = FakeDate;
    try {
      await sleep(1150);
    } finally {
      window.Date = RealDate;
    }
    const again = $('.add-input');
    ok(again, 'input still present after re-render');
    eq(again.value, 'ITEST-草稿', 'draft value kept');
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    // 再等一个 tick，让 lastDay 回到真实日期，避免影响后续用例
    await sleep(1100);
    await deleteTodo('ITEST-草稿锚点');
    return 'preserved';
  });

  await t('[REG-05] 设置分类顺序、页面切换与关于版本', async () => {
    click($('#settingsBtn'));
    await sleep(500);
    const labels = $$('.set-page[data-page=system] .set-label').map((e) => e.textContent);
    eq(labels[0], '极简模式');
    eq(labels[1], '日历模式');
    eq(labels[2], '窗口置顶');
    eq(labels[3], '不在任务栏显示');
    eq(labels[4], '允许开机启动');
    ok(labels[5].includes('导出'), 'export label');
    const tabs = $$('.set-tab');
    click(tabs[1]);
    await sleep(100);
    eq($$('.set-page').find((p) => p.classList.contains('active')).dataset.page, 'ui', 'ui tab');
    click(tabs[2]);
    await sleep(100);
    eq($$('.set-page').find((p) => p.classList.contains('active')).dataset.page, 'weather', 'weather tab');
    ok($('#cityInput'), 'city input');
    click(tabs[3]);
    await sleep(100);
    eq($$('.set-page').find((p) => p.classList.contains('active')).dataset.page, 'about');
    ok(/^\d+\.\d+\.\d+$/.test($('#aboutVersion').textContent), 'about version');
    const appVersion = await window.__TAURI__.app.getVersion();
    eq($('#aboutVersion').textContent, appVersion, 'about matches app version');
    return 'ok';
  });

  await t('[REG-06] 设置面板浮动在右侧、不遮挡待办、标题栏可拖动', async () => {
    // e2fdf74
    if ($('#settingsOverlay').hidden) {
      click($('#settingsBtn'));
      await sleep(500);
    }
    const panel = $('#settingsPanel');
    const r = panel.getBoundingClientRect();
    const tr = document.querySelector('.todo-card').getBoundingClientRect();
    eq(getComputedStyle(panel).position, 'absolute', 'floating panel');
    ok(r.left >= tr.right - 1, `no overlap panel=${r.left} todo=${tr.right}`);
    const winObj = getWin();
    const proto = Object.getPrototypeOf(winObj);
    const orig = proto.startDragging;
    let calls = 0;
    proto.startDragging = function () {
      calls += 1;
      return Promise.resolve();
    };
    try {
      const head = panel.querySelector('.settings-head');
      head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      await sleep(80);
      ok(calls >= 1, 'startDragging called from title bar');
    } finally {
      proto.startDragging = orig;
    }
    await closeSettings();
    return 'draggable';
  });

  await t('[REG-07] 设置打开时切换模式不立即改主界面，关闭后一次性生效', async () => {
    // 8979d17 / 605faec：避免设置面板开着时日历被隐藏或布局突变。
    await setCalendar(false);
    click($('#settingsBtn'));
    await sleep(500);
    const beforeClass = document.body.className;
    const beforeHidden = $('#calendarCard').hidden;
    click($('#calendarSwitch'));
    await sleep(200);
    eq(document.body.className, beforeClass, 'mode class deferred');
    eq($('#calendarCard').hidden, beforeHidden, 'calendar stays hidden');
    click($('#settingsDone'));
    await sleep(700);
    ok(document.body.classList.contains('calendar-mode'), 'applied after close');
    eq($('#calendarCard').hidden, false, 'calendar visible after close');
    return 'deferred';
  });

  await t('[REG-08] 日历模式设置面板不遮挡待办且窗口只小幅加宽', async () => {
    // 1f73a79：日历模式打开设置不能把窗口放大一大截。
    await sleep(300);
    const widthBefore = window.innerWidth;
    click($('#settingsBtn'));
    await sleep(800);
    const panel = $('#settingsPanel').getBoundingClientRect();
    const todo = document.querySelector('.todo-card').getBoundingClientRect();
    const widthOpen = window.innerWidth;
    ok(panel.left >= todo.right - 1, `panel=${panel.left} todo=${todo.right}`);
    ok(widthOpen - widthBefore <= 120, `growth=${widthOpen - widthBefore}px`);
    ok(panel.right <= widthOpen - 2, 'panel inside window');
    click($('#settingsDone'));
    await sleep(600);
    ok(!$('#calendarCard').hidden, 'calendar still visible');
    await setCalendar(false);
    return `${widthBefore}->${widthOpen}`;
  });

  await t('[REG-09] 界面配置：字体 / 颜色 / 背景图填充卡片内部', async () => {
    click($('#settingsBtn'));
    await sleep(500);
    const tabs = $$('.set-tab');
    click(tabs[1]);
    await sleep(120);
    const fontSel = $('#fontSelect');
    const oldFont = fontSel.value;
    const fontColor = $('#fontColor');
    const oldColor = fontColor.value;
    fontSel.value = 'kaiti';
    fontSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    const family = getComputedStyle($('.todo-row .text') || document.body).fontFamily;
    ok(/KaiTi|STKaiti/i.test(family), 'kaiti applied: ' + family);
    click($$('#fontColorRow .swatch')[2]);
    await sleep(120);
    eq(getComputedStyle(document.documentElement).getPropertyValue('--text').trim(), '#ffe9c7');
    fontSel.value = oldFont;
    fontSel.dispatchEvent(new Event('change', { bubbles: true }));
    fontColor.value = oldColor;
    fontColor.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);

    // eca3ca4：背景图只填充卡片内部，外层画布不渲染。
    const app = $('#app');
    const card = document.querySelector('.todo-card');
    const bgImage = $('#bgImage');
    const hadBg = app.classList.contains('has-bg');
    const oldVar = app.style.getPropertyValue('--card-image');
    const oldPrio = app.style.getPropertyPriority('--card-image');
    const svg =
      'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%2710%27%3E%3Crect width=%2710%27 height=%2710%27 fill=%27%23ff0000%27/%3E%3C/svg%3E")';
    app.classList.add('has-bg');
    app.style.setProperty('--card-image', svg);
    await sleep(60);
    ok(getComputedStyle(card).backgroundImage.includes('data:image'), 'card uses --card-image');
    eq(getComputedStyle(bgImage).display, 'none', 'outer canvas hidden');
    if (hadBg) app.classList.add('has-bg');
    else app.classList.remove('has-bg');
    if (oldVar) app.style.setProperty('--card-image', oldVar, oldPrio);
    else app.style.removeProperty('--card-image');
    await sleep(60);
    await closeSettings();
    return 'ok';
  });

  await t('[REG-10] 透明度按 gamma 2.2 实时生效', async () => {
    const range = $('#opacityRange');
    const old = range.value;
    range.value = '80';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    const op = parseFloat(getComputedStyle($('#app')).getPropertyValue('--op'));
    ok(Math.abs(op - 0.481) < 0.03, 'op=' + op);
    range.value = old;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    return 'ok';
  });

  await t('[REG-11] 自定义天气链接（uapis.cn）可直接解析', async () => {
    await closeSettings();
    await sleep(300);
    let data;
    try {
      data = await invoke('fetch_json', {
        url: 'https://uapis.cn/api/v1/misc/weather?city=北京&forecast=true',
      });
    } catch (err) {
      if (String(err).includes('429')) return 'skip: rate limited';
      throw err;
    }
    ok(data.temperature !== undefined, 'temperature field');
    const norm = window.WeatherAPI.normalizeUapis(data, {});
    ok(norm.daily.length > 0, 'daily normalized');
    ok(Number.isFinite(norm.current.temp), 'current temp');
    return data.city + ' ' + norm.current.temp + '°';
  });

  await t('[REG-12] 天气展开 / 收起为即时扩缩，无尺寸动画卡顿', async () => {
    // ef5f368：尺寸动画回退后必须在很短时间内完成扩缩。
    await setCalendar(false);
    await ensureWeather(false);
    await sleep(250);
    const w0 = window.innerWidth;
    const t0 = performance.now();
    click($('#weatherPill'));
    let expanded = -1;
    for (let i = 0; i < 20; i += 1) {
      await sleep(15);
      if (window.innerWidth > w0 + 150) {
        expanded = performance.now() - t0;
        break;
      }
    }
    ok(expanded >= 0 && expanded < 250, 'expand ms=' + expanded);
    const delta = window.innerWidth - w0;
    ok(delta >= 240 && delta <= 280, 'delta=' + delta);
    ok(!$('#weatherCard').hidden, 'weather card visible');
    ok(document.body.classList.contains('weather-open'), 'weather-open class');
    const t1 = performance.now();
    click($('#weatherPill'));
    let collapsed = -1;
    for (let i = 0; i < 20; i += 1) {
      await sleep(15);
      if (window.innerWidth <= w0 + 1) {
        collapsed = performance.now() - t1;
        break;
      }
    }
    ok(collapsed >= 0 && collapsed < 250, 'collapse ms=' + collapsed);
    return `expand=${Math.round(expanded)}ms collapse=${Math.round(collapsed)}ms`;
  });

  await t('[REG-13] 极简模式打开天气时添加入口贴在主界面最下', async () => {
    // 极简 + 天气：待办列表撑满，添加行始终贴近卡片底部。
    await ensureWeather(true);
    await ensureMinimal(true);
    await sleep(400);
    ok(document.body.classList.contains('minimal-mode'), 'minimal class');
    ok(document.body.classList.contains('weather-open'), 'weather class');
    const add = $('#addRow').getBoundingClientRect();
    const card = document.querySelector('.todo-card').getBoundingClientRect();
    const gap = card.bottom - add.bottom;
    ok(gap >= 0 && gap <= 14, 'add row gap=' + gap);
    eq(getComputedStyle($('#todoList')).flexGrow, '1', 'list fills card');
    await ensureMinimal(false);
    await ensureWeather(false);
    return 'gap=' + Math.round(gap);
  });

  await t('[REG-14] 日历模式布局与月份导航', async () => {
    await setCalendar(true);
    ok(document.body.classList.contains('calendar-mode'), 'body class');
    eq($('#calendarCard').hidden, false, 'calendar visible');
    const cells = $$('.cal-cell').length;
    ok(cells % 7 === 0 && cells >= 35 && cells <= 42, 'cells=' + cells);
    ok($('#calTitle').textContent.includes('年'), 'title');
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

  await t('[REG-15] 日历色条最多 3 行、滚轮翻看、+n 只贴行尾（周日）', async () => {
    // f800968 / a4808e4：同一周 5 条待办，超过 3 行需滚轮查看，徽标不能被每格重复。
    click($('#calToday'));
    await sleep(250);
    const ds = todayStr();
    const created = [];
    for (let i = 1; i <= 5; i += 1) {
      const text = `ITEST-滚动${i}`;
      await addDueTodo(text, ds);
      created.push(text);
    }
    await sleep(400);
    let detail = '';
    let maxOffset = 0;
    try {
    const cellOf = () => $$('.cal-cell').find((c) => c.dataset.date === ds);
    const todayCell = cellOf();
    ok(todayCell, 'today cell');
    const week = todayCell.closest('.cal-week');
    maxOffset = Number(week.dataset.maxOffset || 0);
    ok(maxOffset >= 1, 'overflow maxOffset=' + maxOffset);
    const rowTops = () => new Set([...week.querySelectorAll('.cal-bar')].map((b) => b.style.top)).size;
    ok(rowTops() <= 3, 'at most 3 visible rows, rows=' + rowTops());
    ok(week.querySelectorAll('.cal-bar').length >= 3, 'bars visible');
    const badges = [...week.querySelectorAll('.cal-bar-badge')];
    ok(badges.length >= 1 && badges.length <= 2, 'badge count=' + badges.length);
    badges.forEach((b) => {
      eq(b.style.getPropertyValue('--col'), '6', 'badge on Sunday column');
      ok(/^\+\d+$/.test(b.textContent), 'badge text=' + b.textContent);
    });

    // 双击色条（覆盖在日期格上）也应打开添加弹窗。
    const bar = week.querySelector('.cal-bar');
    const br = bar.getBoundingClientRect();
    bar.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: br.left + br.width / 2,
        clientY: br.top + br.height / 2,
      })
    );
    await sleep(200);
    ok(!$('#calAddPopover').hidden, 'dblclick over bar opens popover');
    ok(/^\d{4}-\d{2}-\d{2}$/.test($('#calAddDate').value), 'popover date set');
    click($('#calAddCancel'));
    await sleep(150);

    const scrollWeek = async (deltaY) => {
      const cell = cellOf();
      const r = cell.getBoundingClientRect();
      cell.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          bubbles: true,
          cancelable: true,
          clientX: r.x + 10,
          clientY: r.y + 10,
        })
      );
      await sleep(160);
    };
    await scrollWeek(100);
    await scrollWeek(100);
    const scrolled = cellOf().closest('.cal-week');
    const above = [...scrolled.querySelectorAll('.cal-bar-badge.above')];
    eq(above.length, 1, 'single above badge');
    eq(above[0].style.getPropertyValue('--col'), '6', 'above badge on Sunday');
    const tops = new Set([...scrolled.querySelectorAll('.cal-bar')].map((b) => b.style.top)).size;
    ok(tops <= 3, 'still max 3 rows, rows=' + tops);
    await scrollWeek(-100);
    await scrollWeek(-100);
    detail = `maxOffset=${maxOffset} badges=${badges.length}`;
    } finally {
      if (!$('#calAddPopover').hidden) click($('#calAddCancel'));
      for (const text of created) await deleteTodo(text);
      await sleep(400);
    }
    return detail;
  });

  await t('[REG-16] 双击日期格弹出添加待办', async () => {
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

  await t('[REG-17] 右键立即显示日期信息（含农历与名言）', async () => {
    const cell = $$('.cal-cell')[15];
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(80);
    ok(!$('#calInfo').hidden, 'info visible');
    ok($('#ciLunar').textContent.includes('农历'), 'lunar');
    ok($('#ciQuoteText').textContent.length > 0, 'quote');
    $('#calInfo').hidden = true;
    return 'ok';
  });

  await t('[REG-18] 悬停 3 秒显示，离开 1.2 秒消失', async () => {
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

  await t('[REG-19] 节气当天显示节气名与背景', async () => {
    const reached = await goMonth(2026, 11);
    if (!reached) return 'skip: month not reachable';
    const cell = $$('.cal-cell').find((c) => c.dataset.date === '2026-11-22');
    if (!cell) return 'skip: date not in view';
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(100);
    eq($('#ciTerm').textContent, '小雪');
    ok($('#calInfo').style.backgroundImage.includes('data:image'), 'term bg');
    $('#calInfo').hidden = true;
    click($('#calToday'));
    await sleep(250);
    return 'ok';
  });

  await t('[REG-20] 法定节假日每一天都标注假期名与底色', async () => {
    // 多天假期里每一天都要有自己的标签，不能只在首日标一次。
    click($('#calToday'));
    await sleep(300);
    let found = null;
    for (let i = 0; i < 16; i += 1) {
      const cells = $$('.cal-cell.holiday');
      if (cells.length >= 2) {
        found = { title: $('#calTitle').textContent, count: cells.length };
        break;
      }
      click($('#calNext'));
      await sleep(550);
    }
    if (!found) return 'skip: no multi-day holiday data';
    const cells = $$('.cal-cell.holiday');
    ok(cells.length >= 2, 'holiday cells');
    const names = {};
    let missing = 0;
    for (const cell of cells) {
      const label = cell.querySelector('.cal-holiday');
      if (!label || !label.textContent.trim()) {
        missing += 1;
        continue;
      }
      eq(label.textContent, cell.dataset.holiday, 'label matches day');
      names[label.textContent] = (names[label.textContent] || 0) + 1;
      ok(cell.style.getPropertyValue('--hd'), 'holiday tint set');
    }
    eq(missing, 0, 'every holiday cell has a label');
    ok(Object.values(names).some((n) => n >= 2), 'multi-day holiday labelled each day');
    click($('#calToday'));
    await sleep(300);
    return `${found.title} days=${cells.length}`;
  });

  await t('[REG-38] 天气错误分类：HTTP 4xx 不算断网，网络错误才算', async () => {
    // 旧问题：前端用 /请求失败/ 正则识别网络错误，导致
    //   1) Rust 真实网络错误（error sending request for url）反而匹配不上，断网不重试
    //   2) HTTP 401 命中"请求失败"，networkOk 被永久置 false，日历悬浮信息连带失效
    // 现在 Rust 侧用 NET_ERR 前缀标记网络类错误，前端只认前缀。
    // 先切到日历模式承载 #calInfo，再从普通模式的天气入口制造失败
    const realInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
    const infoFires = () => {
      // showCalInfo 在 networkOk === false 时直接 return，借 #calInfo 的显隐判断状态
      const info = document.getElementById('calInfo');
      if (!info) return false;
      info.hidden = true;
      const cell = $$('.cal-cell').find((c) => !c.classList.contains('other-month'));
      if (!cell) return false;
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      return info.hidden === false;
    };
    let mode = null; // null | 'http4xx' | 'network'
    window.__TEST_INVOKE = function (cmd, args) {
      if (cmd === 'fetch_json' && mode && /open-meteo|nominatim/.test((args && args.url) || '')) {
        if (mode === 'http4xx') {
          // 不带前缀：服务端/配置问题，不是断网
          return Promise.reject(new Error('请求失败：HTTP 401'));
        }
        return Promise.reject(new Error('NET_ERR:连接失败'));
      }
      return realInvoke(cmd, args);
    };
    try {
      await setCalendar(true);
      await sleep(300);

      // 先确保 networkOk 处于可用状态
      mode = null;
      const input = $('#cityInput');
      if (input) {
        input.value = '上海';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => (($('#wcStatus') || {}).textContent || '') === '', 20000, 250);
      }
      ok(infoFires(), 'baseline: hover info available');
      await sleep(1400);

      // 1) HTTP 401：不应把 networkOk 打掉，悬浮信息仍可用
      mode = 'http4xx';
      if (input) {
        input.value = '广州';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => (($('#wcStatus') || {}).textContent || '').includes('HTTP'), 20000, 250);
      }
      await sleep(300);
      ok(infoFires(), '4xx must not disable hover info');
      await sleep(1400);

      // 2) 网络错误：应识别为断网，悬浮信息停用
      mode = 'network';
      if (input) {
        input.value = '成都';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => (($('#wcStatus') || {}).textContent || '').includes('连接失败'), 20000, 250);
      }
      await sleep(300);
      ok(!infoFires(), 'network error must disable hover info');

      // 恢复
      mode = null;
      if (input) {
        input.value = '上海';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(3000);
      }
      await setCalendar(false);
      return 'classification verified';
    } finally {
      window.__TEST_INVOKE = null;
      if (document.body.classList.contains('calendar-mode')) await setCalendar(false);
    }
  });

  await t('[REG-21] 日历退回普通模式', async () => {
    await setCalendar(false);
    ok(!document.body.classList.contains('calendar-mode'));
    await sleep(300);
    return 'ok';
  });

  await t('[REG-22] 完成事项写入完成时间并可导出近 30 天', async () => {
    const before = $$('.todo-row').length;
    const row = await addTodo('ITEST-完成');
    click(row.querySelector('.act-btn.done'));
    await sleep(250);
    ok(!findRow('ITEST-完成'), 'hidden after done');
    eq($$('.todo-row').length, before, 'count back');
    await sleep(650);
    const state = await invoke('load_state');
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

  await t('[REG-23] 开机启动开关点击即时反馈并最终写入注册表', async () => {
    // 3d70c65：视觉反馈必须是同步的，注册表写入在后台完成。
    const original = await invoke('get_autostart');
    await openSettingsTab(0);
    const sw = $('#autostartSwitch');
    eq(sw.classList.contains('on'), !!original, 'initial matches registry');
    const next = !original;
    click(sw);
    eq(sw.classList.contains('on'), next, 'instant visual feedback');
    const changed = await waitFor(async () => (await invoke('get_autostart')) === next, 4000, 60);
    ok(changed >= 0, 'registry updated');
    click(sw);
    eq(sw.classList.contains('on'), original, 'instant restore feedback');
    const restored = await waitFor(async () => (await invoke('get_autostart')) === original, 4000, 60);
    ok(restored >= 0, 'registry restored');
    await closeSettings();
    return `immediate registry=${Math.round(changed)}ms restore=${Math.round(restored)}ms`;
  });

  await t('[REG-35] 开机启动写入失败时开关回滚，界面不能停在与实际不一致的状态', async () => {
    // 断网/权限不足/注册表被策略锁定时 set_autostart 会 reject，
    // 开关必须先给出即时反馈、失败后回滚，不能显示「已开启」而注册表实际没写。
    const original = await invoke('get_autostart');
    await openSettingsTab(0);
    const sw = $('#autostartSwitch');
    eq(sw.classList.contains('on'), !!original, 'initial matches registry');

    const realInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
    let failedOnce = false;
    window.__TEST_INVOKE = function (cmd, args) {
      if (cmd === 'set_autostart' && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error('网络异常：无法写入注册表'));
      }
      return realInvoke(cmd, args);
    };
    try {
      click(sw);
      const rolled = await waitFor(() => !failedOnce || sw.classList.contains('on') === !!original, 4000, 60);
      ok(failedOnce, 'failure path exercised');
      ok(rolled >= 0, 'switch rolled back');
      eq(sw.classList.contains('on'), !!original, 'switch restored to registry state');
      eq(await invoke('get_autostart'), !!original, 'registry unchanged');
      await closeSettings();
      return 'rolled back in ' + Math.round(rolled) + 'ms';
    } finally {
      window.__TEST_INVOKE = null;
      await closeSettings();
    }
  });

  await t('[REG-24] 窗口靠边吸附（20px 内归位）', async () => {
    await closeSettings();
    await sleep(300);
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    await w.setPosition(new PPos(12, 12));
    await sleep(450);
    const snapped = await w.outerPosition();
    ok(Math.abs(snapped.x) <= 2 && Math.abs(snapped.y) <= 2, 'snapped: ' + snapped.x + ',' + snapped.y);
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(400);
    return 'ok';
  });

  await t('[REG-25] 日历模式收起时只有一层窄条，左右窄条两端圆弧', async () => {
    // 1067e4e / 5a12eb2 / ee59f2a
    await setCalendar(true);
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    try {
      await midAnimationHide(w, orig, size);
      ok($('#app').className.includes('edge-hidden'), 'hidden class');
      eq(getComputedStyle($('#app'), '::before').opacity, '0', 'calendar panel hidden');
      const peek = $('#edgePeek');
      eq(getComputedStyle(peek).display, 'block', 'peek visible');
      const r = peek.getBoundingClientRect();
      ok(Math.abs(r.width - 24) <= 2, 'peek width=' + r.width);
      ok(Math.abs(r.height - window.innerHeight * 0.5) <= 4, 'peek height=' + r.height);
      eq(getComputedStyle(peek).borderRadius, '12px', 'rounded both ends');
    } finally {
      await w.setPosition(new PPos(orig.x, orig.y));
      await sleep(800);
      if (document.body.classList.contains('calendar-mode')) await setCalendar(false);
    }
    return 'ok';
  });

  await t('[REG-26] 收起过程连续：先收缩淡出再变窄条', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new PPos(-Math.round(size.width / 2), 260));
    await sleep(430);
    const app = $('#app');
    const transform = getComputedStyle(app).transform;
    ok(transform && transform !== 'none', 'scaling: ' + transform);
    ok(!app.className.includes('edge-hidden'), 'content still visible');
    ok(parseFloat(getComputedStyle(app).opacity) < 0.95, 'fading');
    await sleep(900);
    ok(app.className.includes('edge-hidden'), 'hidden after animation');
    eq(getComputedStyle($('#edgePeek')).display, 'block', 'peek shown');
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(700);
    return 'ok';
  });

  await t('[REG-27] 移出屏幕不足 1/3 时不收起', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new PPos(-Math.round(size.width * 0.2), 300));
    await sleep(900);
    ok(!$('#app').className.includes('edge-hidden'), 'must stay visible at 20% off-screen');
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(600);
    return 'ok';
  });

  await t('[REG-28] 刚收起时鼠标仍在窄边不会自动弹出，移开再回才唤出', async () => {
    // a8e7a08：避免收起动画结束时鼠标还在窄边上导致的自动回弹。
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    const hiddenX = -Math.round(size.width / 2);
    const realWindow = window.__TAURI__.window;
    window.__cur = { x: hiddenX + 20, y: 360 };
    window.__TAURI__.window = Object.assign({}, realWindow, {
      cursorPosition: async () => window.__cur,
    });
    let out = 'ok';
    try {
      await w.setPosition(new PPos(hiddenX, 260));
      await sleep(1600);
      ok($('#app').className.includes('edge-hidden'), 'stays hidden while cursor on sliver');
      eq(getComputedStyle($('#edgePeek')).display, 'block', 'peek shown');
      window.__cur = { x: 1200, y: 600 };
      await sleep(500);
      window.__cur = { x: hiddenX + 20, y: 360 };
      const revealed = await waitFor(async () => !$('#app').className.includes('edge-hidden'), 2500, 100);
      ok(revealed >= 0, 'reveals after leave and return');
      out = 'armed';
    } finally {
      window.__cur = { x: 1200, y: 600 };
      await w.setPosition(new PPos(500, 400));
      await sleep(800);
      window.__TAURI__.window = realWindow;
      await w.setPosition(new PPos(orig.x, orig.y));
      await sleep(500);
    }
    return out;
  });

  await t('[REG-29] 悬停唤出 / 移开收起 / 无回弹', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new PPos(-Math.round(size.width / 2), 260));
    await sleep(1200);
    const hidden = await w.outerPosition();
    ok(hidden.x < 0, 'moved out: ' + hidden.x);
    ok($('#app').className.includes('edge-hidden'), 'hidden class');
    const peek = $('#edgePeek');
    eq(getComputedStyle(peek).display, 'block', 'peek visible');
    const realWindow = window.__TAURI__.window;
    let out = 'ok';
    try {
      window.__cur = { x: 1200, y: 600 };
      window.__TAURI__.window = Object.assign({}, realWindow, {
        cursorPosition: async () => window.__cur,
      });
      await sleep(450);
      window.__cur = { x: 8, y: 300 };
      await sleep(1450);
      const shown = await w.outerPosition();
      ok(shown.x > hidden.x + 100, 'revealed: ' + shown.x);
      await sleep(450);
      const stable = await w.outerPosition();
      ok(Math.abs(stable.x - shown.x) <= 3, 'no bounce back: ' + stable.x);
      $('#app').dispatchEvent(new MouseEvent('mouseleave'));
      await sleep(1450);
      const again = await w.outerPosition();
      ok(again.x < 0, 'concealed again: ' + again.x);
      out = 'ok';
    } finally {
      window.__cur = { x: 1200, y: 600 };
      await w.setPosition(new PPos(200, 200));
      await sleep(800);
      window.__TAURI__.window = realWindow;
      await w.setPosition(new PPos(orig.x, orig.y));
      await sleep(500);
    }
    return out;
  });

  await t('[REG-30] 点击窄边立即弹出，不等待悬停', async () => {
    // 46d78fd
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new PPos(-Math.round(size.width / 2), 260));
    await sleep(1200);
    const hidden = await w.outerPosition();
    ok(hidden.x < 0, 'hidden');
    $('#app').dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
    );
    await sleep(220);
    const pos = await w.outerPosition();
    ok(pos.x > hidden.x + 40, 'immediate reveal: ' + pos.x);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(500);
    await w.setPosition(new PPos(200, 200));
    await sleep(800);
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(400);
    return 'ok';
  });

  await t('[REG-31] 收起状态下拖动窗口离开边缘即退出隐藏', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    await w.setPosition(new PPos(-Math.round(size.width / 2), 260));
    await sleep(1200);
    ok($('#app').className.includes('edge-hidden'), 'hidden');
    await w.setPosition(new PPos(200, 200));
    await sleep(900);
    ok(!$('#app').className.includes('edge-hidden'), 'exit hide');
    ok($('#edgePeek').hidden, 'peek hidden');
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(500);
    return 'ok';
  });

  await t('[REG-32] 上边缘停留 2 秒收起，松开鼠标不复弹，顶部窄条半宽圆角', async () => {
    // fac3e7c / 5a12eb2
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    document.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
    );
    let out = 'ok';
    try {
      await w.setPosition(new PPos(300, 60));
      await sleep(350);
      await w.setPosition(new PPos(300, 0));
      await sleep(2800);
      ok($('#app').className.includes('edge-hidden-top'), 'top hidden: ' + $('#app').className);
      const peek = $('#edgePeek');
      const r = peek.getBoundingClientRect();
      ok(Math.abs(r.width - window.innerWidth * 0.5) <= 3, 'half width=' + r.width);
      eq(Math.round(r.height), 24, 'height');
      eq(Math.round(r.bottom), Math.round(window.innerHeight), 'at bottom of hidden window');
      eq(getComputedStyle(peek).borderRadius, '12px', 'rounded');
      const hidden = await w.outerPosition();
      ok(hidden.y < 0, 'window off top: ' + hidden.y);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(700);
      const still = await w.outerPosition();
      ok(still.y < 0, 'stays hidden after mouseup: ' + still.y);
    } finally {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await w.setPosition(new PPos(500, 400));
      await sleep(900);
      await w.setPosition(new PPos(orig.x, orig.y));
      await sleep(500);
    }
    return out;
  });

  await t('[REG-33] 托盘唤出后 5 秒自动收起', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    const hiddenX = -Math.round(size.width / 2);
    await w.setPosition(new PPos(hiddenX, 260));
    await sleep(1400);
    ok($('#app').className.includes('edge-hidden'), 'hidden before tray');
    await window.__TAURI__.event.emit('tray-show', {});
    const revealed = await waitFor(async () => (await w.outerPosition()).x > hiddenX + 100, 2000, 100);
    ok(revealed >= 0, 'tray revealed');
    if ($('#app').matches(':hover')) {
      await w.setPosition(new PPos(500, 400));
      await sleep(800);
      await w.setPosition(new PPos(orig.x, orig.y));
      return 'skip auto-hide: cursor hovering';
    }
    const hiddenAgain = await waitFor(async () => (await w.outerPosition()).x < 0, 7000, 200);
    ok(hiddenAgain >= 0, 'auto-hidden after ~5s');
    await w.setPosition(new PPos(500, 400));
    await sleep(800);
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(500);
    return 'revealed then auto-hidden';
  });

  await t('[REG-36] 保存失败不能丢待办：内存状态保留，恢复后下一次保存完整落盘', async () => {
    // 断网/磁盘异常时 save_state 会 reject。旧实现只 console.warn，
    // 若此后不再触发保存，用户的待办就只存在于内存、重启即丢。
    await closeSettings();
    const realInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
    const text = 'ITEST-断网保存-' + Date.now();
    let failSaves = true;
    window.__TEST_INVOKE = function (cmd, args) {
      if (cmd === 'save_state' && failSaves) {
        return Promise.reject(new Error('网络异常：无法写入磁盘'));
      }
      return realInvoke(cmd, args);
    };
    try {
      await addTodo(text);
      eq(todoTexts().includes(text), true, 'todo stays in memory after failed save');

      // 恢复后不需要再做任何操作，自动补写必须把内存状态落盘
      failSaves = false;
      const saved = await waitFor(async () => {
        const st = await invoke('load_state');
        return ((st && st.todos) || []).some((t) => t.text === text);
      }, 15000, 200);
      ok(saved >= 0, 'state not persisted after recovery (no auto-retry)');

      // 清理测试待办
      await deleteTodo(text);
      const ok2 = await waitFor(() => !todoTexts().includes(text), 3000, 100);
      ok(ok2 >= 0, 'cleanup failed');
      return 'memory kept, persisted in ' + Math.round(saved) + 'ms';
    } finally {
      window.__TEST_INVOKE = null;
    }
  });

  await t('[REG-34] 天气拉取失败后重新打开天气卡要自动重试，不能停在占位文案', async () => {
    // 旧问题：refreshWeather 只在启动 350ms 和每 30 分钟各跑一次，
    // toggleWeather 打开卡片时只把状态覆写成「正在获取天气…」且从不发请求。
    // 于是一次失败后用户关掉再打开，真实错误被覆盖，卡片永久停在占位文案。
    if (document.body.classList.contains('calendar-mode')) return 'skip: calendar mode';
    const status = () => ($('#wcStatus') || {}).textContent || '';
    const input = $('#cityInput');
    if (!input) return 'skip: no city input';
    // 天气/地理编码请求现在统一走 Rust 的 fetch_json（CSP 不允许渲染进程直连），
    // 所以断网要拦 invoke，而不是 window.fetch。
    const realInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
    const setCity = (name) => {
      input.value = name;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let blocked = false;
    window.__TEST_INVOKE = function (cmd, args) {
      // 只拦天气与地理编码，避免连带拦下节假日请求（会把该年写入 holidayFailed）
      if (blocked && cmd === 'fetch_json' && /open-meteo|nominatim/.test((args && args.url) || '')) {
        // 与 Rust classify_request_error 的真实输出保持一致，否则用例会掩盖分类缺陷
        return Promise.reject(new Error('NET_ERR:连接失败'));
      }
      return realInvoke(cmd, args);
    };
    const startedAt = input.value;
    try {
      // 1) 先切到一个正常城市，确保应用处于「能取到天气」的已知状态
      setCity('上海');
      const settled = await waitFor(() => status() === '', 20000, 250);
      ok(settled >= 0, 'baseline city load failed: ' + status());

      // 2) 断网后切换城市，制造一次真实的天气失败
      blocked = true;
      setCity('广州');
      const surfaced = await waitFor(() => status() !== '', 20000, 200);
      ok(surfaced >= 0, 'failure not surfaced at all');
      const failedStatus = status();
      ok(!failedStatus.includes('正在获取'), 'placeholder instead of error: ' + failedStatus);

      // 3) 恢复网络后关闭再打开天气卡：必须自动重试并取到数据
      blocked = false;
      if ($('#weatherPill').classList.contains('active')) {
        click($('#weatherPill'));
        await sleep(700);
      }
      click($('#weatherPill'));
      const recovered = await waitFor(() => status() === '', 20000, 250);
      ok(recovered >= 0, 'stuck after reopen, status=' + status());
      ok(($('#wcTemp') || {}).textContent !== '--°', 'temp still placeholder');

      setCity(startedAt || '北京');
      await sleep(1500);
      return 'recovered in ' + Math.round(recovered) + 'ms';
    } finally {
      blocked = false;
      window.__TEST_INVOKE = null;
    }
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed, failed: results.length - passed, results });
})()
