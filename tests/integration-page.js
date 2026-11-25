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
      const value = await fn();
      const detail = value === undefined ? '' : String(value);
      // skip 必须与 PASS 分开统计，否则断网 / 无显示器时用例会假装通过。
      results.push(
        typeof value === 'string' && value.startsWith('skip')
          ? { name, ok: true, skipped: true, detail }
          : { name, ok: true, detail }
      );
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

  const rowText = (row) => {
    const text = row.querySelector('.text');
    if (text) return text.textContent;
    const input = row.querySelector('.edit-input');
    return input ? input.value : '';
  };
  const todoTexts = () => $$('.todo-row').map(rowText);
  const findRow = (text) => $$('.todo-row').find((r) => rowText(r) === text);

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

  await t('[REG-01] 模块与名言库加载（1313 条、无重复）', async () => {
    ok(window.TodoCore && window.TodoDomain && window.CalendarDomain, 'domains');
    ok(window.HolidayDomain && window.QuoteDomain && window.WeatherAPI, 'domains2');
    const res = await fetch('quotes.json');
    const data = await res.json();
    eq(data.quotes.length, 1313);
    eq(new Set(data.quotes.map((q) => q.t)).size, 1313, 'unique quotes');
    return '1313 quotes';
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
      // 用户第二轮指出的消极/讽刺/贬损语句
      /好心不得好报|好心认做驴肝肺|狼肚子里没有好心肝/,
      /满口仁义道德，一肚子男盗女娼/,
      /世无英雄，竖子成名/,
      /四肢发达，头脑简单/,
      /猫哭老鼠|春风吹不入驴的耳朵/,
      /为人作保，灾祸临头/,
      /今日有酒今朝醉/,
      /少数人常常被证明是对的/,
      /聪明反被聪明误|聪明一世，糊涂一时/,
      /愚者永远把自己的判断|愚蠢人心在嘴上|使愚昧者更愚蠢/,
      /道德上的矮子/,
      /懒牛屎尿多/,
      /丈母娘看女婿/,
      /做事一错，补过无及/,
      /早恋是这样一种果实/,
      /人生之不如意十之八九/,
      /贫困会中断友谊/,
      /希望是厄运的忠实的姐妹|希望是永远达不到的/,
      /金钱是无底的大海/,
      /道德上的完全麻痹|良心的完全麻痹/,
      /人老了丑，树老了朽/,
      /世事茫茫如大海/,
      /不怕该债的精穷/,
      /憨厚朴实有碍事业的成功/,
      /一分钱难倒英雄汉/,
      /知识愈浅，自信愈深/,
      /英雄不怕战，只怕中暗箭/,
      /做事不为东，累死也无功/,
      /懒惰的人，吊死在苹果树下/,
      /为朋友而死不难/,
      /精力充沛的青春，是不怎么容易灭亡的/,
      /太多，就是不健康/,
      /使心用心/,
      /渐进思想是创新的最大敌人/,
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

  await t('[REG-45] AI 通过收件箱插入待办并显示来源', async () => {
    // 测试脚本启动前用 --add 写了一条 ITEST-AI-INSERT；桌面端启动后应自动合并。
    let row = null;
    for (let i = 0; i < 30 && !row; i += 1) {
      row = findRow('ITEST-AI-INSERT');
      if (!row) await sleep(100);
    }
    ok(row, 'AI todo appears');
    const tag = row.querySelector('.ai-tag');
    ok(tag, 'AI source tag');
    ok(/DeepSeek/.test(tag.textContent), 'source label: ' + tag.textContent);
    ok(/DeepSeek/.test(tag.title), 'source tooltip: ' + tag.title);
    row.querySelector('.act-btn.del').click();
    await sleep(300);
    ok(!findRow('ITEST-AI-INSERT'), 'AI todo deleted');
    return tag.textContent;
  });

  await t('[REG-03] 新增 / 置顶 / 编辑 / 删除待办', async () => {
    // 先放一条锚点，保证「置顶后到第一」不是空列表上的恒真断言。
    await addTodo('ITEST-置顶锚点');
    const row = await addTodo('ITEST-新增');
    ok(row, 'created');
    const pinBtn = () => findRow('ITEST-新增').querySelector('.act-btn.pin');
    const idxBefore = todoTexts().indexOf('ITEST-新增');
    ok(idxBefore > 0, 'baseline has item before pinned one');
    click(pinBtn());
    await sleep(220);
    ok(pinBtn().classList.contains('on'), 'pin on');
    const idxPinned = todoTexts().indexOf('ITEST-新增');
    ok(idxPinned < idxBefore, 'moved above baseline when pinned: ' + idxPinned + ' vs ' + idxBefore);
    click(pinBtn());
    await sleep(220);
    ok(!pinBtn().classList.contains('on'), 'pin off');
    const target = findRow('ITEST-新增');
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let edit = null;
    for (let i = 0; i < 10 && !edit; i += 1) {
      await sleep(100);
      edit = $('.edit-input');
    }
    ok(edit, 'edit input');
    edit.value = 'ITEST-改后';
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(250);
    ok(findRow('ITEST-改后'), 'edited');
    await deleteTodo('ITEST-改后');
    ok(!findRow('ITEST-改后'), 'deleted');
    await deleteTodo('ITEST-置顶锚点');
    ok(!findRow('ITEST-置顶锚点'), 'anchor deleted');
    return 'ok';
  });

  await t('[REG-04] 输入中的待办草稿不会被后台重绘清空', async () => {
    // 955503f：后台刷新（跨天 tick）重绘列表时，正在输入的内容必须保留。
    const anchor = await addTodo('ITEST-草稿锚点');
    ok(anchor, 'anchor');
    click($('#addRow'));
    let input = null;
    for (let i = 0; i < 10 && !input; i += 1) {
      await sleep(100);
      input = $('.add-input');
    }
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

  await t('[REG-49] 后台重绘保留行内编辑内容和列表滚动位置', async () => {
    // AI 收件箱每秒轮询会触发 commitTodos -> renderTodos；行内编辑不能被吞。
    const names = [];
    try {
      for (let i = 0; i < 12; i += 1) {
        const name = 'ITEST-滚动-' + i;
        await addTodo(name);
        names.push(name);
      }
      const list = $('#todoList');
      list.scrollTop = 30;
      await sleep(120);
      const scrollBefore = list.scrollTop;
      const canScroll = scrollBefore > 0;
      const target = findRow(names[0]);
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      let input = null;
      for (let i = 0; i < 10 && !input; i += 1) {
        await sleep(80);
        input = $('.edit-input');
      }
      ok(input, 'edit input');
      input.value = 'ITEST-编辑中';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      window.__TEST_RENDER_TODOS();
      await sleep(150);
      const kept = $('.edit-input');
      ok(kept, 'edit input preserved after re-render');
      eq(kept.value, 'ITEST-编辑中', 'edit value preserved');
      if (canScroll) {
        ok(
          list.scrollTop >= scrollBefore - 1,
          'scroll preserved: ' + list.scrollTop + ' vs ' + scrollBefore
        );
      }
      return canScroll ? 'edit+scroll preserved' : 'edit preserved (list not scrollable)';
    } finally {
      const active = $('.edit-input');
      if (active) {
        active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(150);
      }
      for (const name of names) await deleteTodo(name);
    }
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
    await sleep(300);
    eq($$('.set-page').find((p) => p.classList.contains('active')).dataset.page, 'ai', 'ai tab');
    eq($$('.ai-card').length, 3, 'three AI clients');
    const aiText = $$('.ai-card summary').map((e) => e.textContent).join(' ');
    ok(/WorkBuddy/.test(aiText), 'WorkBuddy card');
    ok(/DeepSeek Harness/.test(aiText), 'DSH card');
    ok(/豆包/.test(aiText), 'Doubao card');
    ok($('#aiMcpJson').textContent.includes('--mcp'), 'MCP JSON');
    ok($('#aiMcpJson').textContent.includes('"command": "desktop-todo.exe"'), 'portable command');
    ok(!$('#aiMcpJson').textContent.includes('D:\\Tools'), 'no hardcoded install path');
    ok($('#aiDshYaml').textContent.includes('cordis.patch.yml'), 'DSH YAML');
    ok($('#aiCliExample').textContent.includes('--add'), 'CLI example');
    click(tabs[4]);
    await sleep(100);
    eq($$('.set-page').find((p) => p.classList.contains('active')).dataset.page, 'about');
    ok(/^\d+\.\d+\.\d+$/.test($('#aboutVersion').textContent), 'about version');
    const appVersion = await window.__TAURI__.app.getVersion();
    eq($('#aboutVersion').textContent, appVersion, 'about matches app version');
    // 再次点击设置图标也能关闭
    click($('#settingsBtn'));
    await sleep(500);
    ok($('#settingsOverlay').hidden, 'settings icon toggles closed');
    click($('#settingsBtn'));
    await sleep(500);
    ok(!$('#settingsOverlay').hidden, 'settings icon reopens');
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
    ok(expanded >= 0 && expanded < 400, 'expand ms=' + expanded);
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
    let shown = false;
    for (let i = 0; i < 15 && !shown; i += 1) {
      await sleep(200);
      shown = !$('#calInfo').hidden;
    }
    ok(shown, 'shown after 3s timer');
    cell.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await sleep(600);
    ok(!$('#calInfo').hidden, 'still at 0.6s');
    let hidden = false;
    for (let i = 0; i < 10 && !hidden; i += 1) {
      await sleep(200);
      hidden = $('#calInfo').hidden;
    }
    ok(hidden, 'hidden after leave delay');
    return 'ok';
  });

  await t('[REG-40] 单击日期格弹出信息，停留时间够移动到弹框上', async () => {
    // 需求：单击日期格即时弹出农历/格言；与拖动窗口共用左键，需靠位移阈值区分。
    // 单击后的停留时间必须够用户把光标移到弹框上，否则还没移过去就关了。
    // showCalInfo 在网络失败时会直接 return，先确认环境允许弹框。
    const info = $('#calInfo');
    info.hidden = true;
    const cells = $$('.cal-cell');
    const cell = cells.find((c) => !c.classList.contains('other-month') && c.dataset.date);
    ok(cell, 'a date cell');
    // 探针：构造一次 contextmenu（右键总是立即显示），确认弹框机制可用
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(120);
    if (info.hidden) return 'skip: network unavailable, popup disabled';
    info.hidden = true;
    const rect = cell.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // 模拟真实的按下→抬起（不移动），应视为单击而非拖动
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    await sleep(150);
    ok(!info.hidden, 'click shows info immediately');

    // 关键：2 秒内不能消失，否则用户来不及把光标移到弹框上
    await sleep(2000);
    ok(!info.hidden, 'still visible at 2s (enough time to reach the popup)');

    // 关键回归：光标经过其它日期格时弹框不能立即消失
    // （旧实现 mouseover 里无条件 hideCalInfo，光标从 19 号移向弹框
    //   途中经过 18 号就会把弹框干掉）
    const other = cells.find((c) => c !== cell && !c.classList.contains('other-month'));
    ok(other, 'another cell to pass over');
    other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(120);
    ok(!info.hidden, 'stays visible when cursor passes over another cell');
    other.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
    );

    // 光标移到弹框上：保持显示，不再自动关闭
    info.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(4000);
    ok(!info.hidden, 'stays open while hovering the popup');
    info.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // 离开后按超时关闭
    await sleep(3800);
    ok(info.hidden, 'auto-hidden after leaving popup');

    // 拖动超过阈值不应弹出
    info.hidden = true;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y + 20 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 20, clientY: y + 20 }));
    await sleep(200);
    ok(info.hidden, 'drag must not show info');
    info.hidden = true;
    return 'holds 2s+, stays while hovered, drag does not show';
  });

  await t('[REG-41] 定位后应显示城市名而不是「当前位置」', async () => {
    // 旧问题：逆地理编码用的 nominatim.openstreetmap.org 长期超时（实测 12s 无响应），
    // 反查永远失败，城市名一直停在「当前位置」。改用 BigDataCloud。
    // 这里直接验证解析逻辑，不依赖外网。
    const pick = window.WeatherAPI && window.WeatherAPI.pickCityFromReverse;
    ok(pick, 'pickCityFromReverse exposed');
    // BigDataCloud 真实响应结构
    eq(pick({
      city: '杭州市',
      principalSubdivision: '浙江省',
      locality: '拱墅區',
      countryName: '中华人民共和国',
    }), '杭州市', 'prefer city');
    // 没有 city 时回退到省份
    eq(pick({ principalSubdivision: '浙江省', locality: '拱墅區' }), '浙江省', 'fallback to province');
    // 都没有则返回空，调用方保留原值
    eq(pick({ countryName: '中华人民共和国' }), '', 'no city -> empty');
    eq(pick(null), '', 'null safe');
    return 'city name resolved';
  });

  await t('[REG-42] IP 定位可独立提供城市名与坐标', async () => {
    // 需求：逆地理编码长期不可靠，改用 IP 定位作为主路径——它一次返回
    // 城市名 + 经纬度，不再需要「先 GPS 再反查」两跳。
    const ipUrl = window.WeatherAPI && window.WeatherAPI.ipLocateUrl;
    ok(ipUrl, 'ipLocateUrl exposed');
    ok(ipUrl.startsWith('https://'), 'must be https (CSP + 隐私)');

    const pick = window.WeatherAPI.pickCityFromReverse;
    // IP 定位响应结构与 reverse 一致，同一解析函数复用
    eq(pick({ city: '杭州市', principalSubdivision: '浙江省' }), '杭州市', 'city');

    // 坐标解析：字符串/数字都要能用
    const coords = window.WeatherAPI.pickCoords;
    ok(coords, 'pickCoords exposed');
    const c1 = coords({ latitude: 30.28, longitude: 120.22 });
    eq(c1 && c1.lat, 30.28, 'numeric coords');
    const c2 = coords({ latitude: '30.28', longitude: '120.22' });
    eq(c2 && c2.lat, 30.28, 'string coords');
    eq(coords({}), null, 'missing coords -> null');
    eq(coords({ latitude: 91, longitude: 0 }), null, 'out of range -> null');
    return 'ip locate helpers ok';
  });

  await t('[REG-43] 定位有多路备用服务（IP 定位 + 逆地理编码）', async () => {
    // 需求：单一服务总有挂的时候，要能换一个再试。
    const W = window.WeatherAPI;
    const ip = W.IP_LOCATE_SOURCES;
    ok(Array.isArray(ip), 'ip sources');
    ok(ip.length >= 2, 'at least 2 ip sources, got ' + ip.length);
    for (const s of ip) {
      ok(s.name, 'ip source name');
      ok(/^https?:\/\//.test(s.url), s.name + ' has url');
      ok(typeof s.city === 'function', s.name + ' city extractor');
      ok(typeof s.coords === 'function', s.name + ' coords extractor');
    }

    // 逆地理编码也保留多路：nominatim 长期不可用，但仍作为兜底存在
    const rev = W.REVERSE_SOURCES;
    ok(Array.isArray(rev), 'reverse sources');
    ok(rev.length >= 2, 'at least 2 reverse sources, got ' + rev.length);
    ok(rev.some((s) => s.name === 'nominatim'), 'nominatim kept as fallback');
    for (const s of rev) {
      ok(typeof s.url === 'function', s.name + ' reverse url builder');
      const u = s.url(30.28, 120.22);
      ok(u.includes('30.28') && u.includes('120.22'), s.name + ' embeds coords');
      ok(typeof s.city === 'function', s.name + ' reverse city extractor');
    }

    // 各服务解析器能吃自己的响应结构
    const bdc = ip.find((s) => s.name === 'bigdatacloud');
    if (bdc) {
      eq(bdc.city({ city: '杭州市', principalSubdivision: '浙江省' }), '杭州市', 'bdc city');
    }
    const ipapi = ip.find((s) => s.name === 'ip-api');
    if (ipapi) {
      eq(ipapi.city({ status: 'success', city: '杭州', regionName: '浙江' }), '杭州', 'ip-api city');
      eq(ipapi.city({ status: 'fail' }), '', 'ip-api failure -> empty');
    }
    const nomi = rev.find((s) => s.name === 'nominatim');
    if (nomi) {
      eq(
        nomi.city({ display_name: '拱墅区, 杭州市, 浙江省, 中国', address: {} }),
        '杭州市',
        'nominatim extracts city'
      );
    }
    return `ip=${ip.map((s) => s.name).join(',')} reverse=${rev.map((s) => s.name).join(',')}`;
  });

  await t('[REG-44] 定位失败时在设置面板提示并可手动输入城市', async () => {
    // 需求：定位失败（IP 全挂、GPS 未授权/系统定位关闭）时，
    // 不能只在天气卡底部显示一行小字——要在设置面板的城市输入框下方
    // 明确提示，并让用户能直接输入城市名。
    await openSettingsTab(2); // 天气页
    const hint = $('#locateHint');
    const input = $('#cityInput');
    ok(hint, 'locate hint element exists');
    ok(input, 'city input exists');

    // 初始应为隐藏
    ok(hint.hidden, 'hint hidden by default');

    // 模拟所有定位渠道失败：拦截 fetch_json
    const realInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
    window.__TEST_INVOKE = function (cmd, args) {
      if (cmd === 'fetch_json' && /bigdatacloud|ipwho|ip-api/.test((args && args.url) || '')) {
        return Promise.reject(new Error('NET_ERR:连接失败'));
      }
      return realInvoke(cmd, args);
    };
    try {
      // 没有 geolocation 就不会走 GPS，直接触发失败路径
      const savedGeo = navigator.geolocation;
      try {
        Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
      } catch (e) {
        /* 不可改写则跳过本用例 */
        return 'skip: geolocation not overridable';
      }
      click($('#locateBtn'));
      const shown = await waitFor(() => !hint.hidden, 8000, 200);
      ok(shown >= 0, 'hint shown after locate failure');
      ok(hint.textContent.includes('输入城市'), 'hint tells user to type a city: ' + hint.textContent);

      // 手动输入城市仍可用
      input.value = '北京';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(2500);
      ok(hint.hidden || !hint.textContent, 'hint cleared after manual input');
      Object.defineProperty(navigator, 'geolocation', { value: savedGeo, configurable: true });
      return 'hint shown and cleared';
    } finally {
      window.__TEST_INVOKE = null;
      await closeSettings();
    }
  });

  await t('[REG-19] 节气当天显示节气名与背景', async () => {
    // 从当前日期往后找第一个节气日，避免硬编码年份在两年后永久 skip。
    const core = window.TodoCore;
    let target = null;
    const start = new Date();
    for (let i = 0; i < 370 && !target; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12);
      const term = core.solarTermOn(d);
      if (term) target = { date: core.ymd(d), term, y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    ok(target, 'no solar term in next year');
    const reached = await goMonth(target.y, target.m);
    if (!reached) return 'skip: month not reachable';
    const cell = $$('.cal-cell').find((c) => c.dataset.date === target.date);
    if (!cell) return 'skip: date not in view';
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(100);
    eq($('#ciTerm').textContent, target.term);
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
    try {
      const next = !original;
      click(sw);
      eq(sw.classList.contains('on'), next, 'instant visual feedback');
      const changed = await waitFor(async () => (await invoke('get_autostart')) === next, 4000, 60);
      ok(changed >= 0, 'registry updated');
      click(sw);
      eq(sw.classList.contains('on'), original, 'instant restore feedback');
      const restored = await waitFor(async () => (await invoke('get_autostart')) === original, 4000, 60);
      ok(restored >= 0, 'registry restored');
      return `immediate registry=${Math.round(changed)}ms restore=${Math.round(restored)}ms`;
    } finally {
      // 用例中途失败也必须把用户的开机启动恢复原状（data.json 恢复不覆盖注册表）。
      let restoreError = null;
      try {
        if ((await invoke('get_autostart')) !== original) {
          await invoke('set_autostart', { enabled: original });
        }
      } catch (err) {
        restoreError = err;
      }
      await closeSettings();
      if (restoreError) {
        throw new Error('autostart restore failed: ' + ((restoreError && restoreError.message) || restoreError));
      }
    }
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
    const app = $('#app');
    const started = await waitFor(() => {
      const style = getComputedStyle(app);
      return style.transform !== 'none' && parseFloat(style.opacity) < 0.99;
    }, 1200, 20);
    ok(started >= 0, 'scaling/fading started');
    ok(!app.className.includes('edge-hidden'), 'content still visible');
    const hidden = await waitFor(() => app.className.includes('edge-hidden'), 2000, 50);
    ok(hidden >= 0, 'hidden after animation');
    const peekShown = await waitFor(
      () => getComputedStyle($('#edgePeek')).display === 'block',
      1000,
      30
    );
    ok(peekShown >= 0, 'peek shown');
    await w.setPosition(new PPos(orig.x, orig.y));
    await sleep(700);
    return 'ok';
  });

  await t('[REG-27] 待办原点/五角星移出屏幕才收起', async () => {
    const w = getWin();
    const PPos = Pos();
    await resetEdge(w);
    const orig = await w.outerPosition();
    const size = await w.outerSize();
    // 该用例依赖列表里有待办；全新安装/空列表时自己建一条，不能靠用户数据。
    const fixture = 'ITEST-标记';
    await addTodo(fixture);
    try {
      const markerRow = findRow(fixture);
      ok(markerRow, 'fixture row');
      const marker =
        markerRow.querySelector('.status') || markerRow.querySelector('.mark-dot');
      ok(marker, 'todo marker');
    const appRect = $('#app').getBoundingClientRect();
    const ratio = size.width / window.innerWidth;
    const markerRight = (marker.getBoundingClientRect().right - appRect.left) * ratio;

    // 标记还在屏幕内（只差几像素）时不收起
    await w.setPosition(new PPos(-Math.max(2, Math.round(markerRight - 8)), 300));
    await sleep(900);
    ok(!$('#app').className.includes('edge-hidden'), 'marker still inside, stay visible');

    // 标记完全移出左侧后才收起
    await w.setPosition(new PPos(-Math.round(markerRight + 12), 300));
    let hidden = false;
    for (let i = 0; i < 15 && !hidden; i += 1) {
      await sleep(200);
      hidden = $('#app').className.includes('edge-hidden');
    }
    ok(hidden, 'marker outside screen, hide');

    await w.setPosition(new PPos(200, 300));
    await sleep(900);
    let rightInfo = 'skip: no monitor';
    try {
      const monitors = window.__TAURI__.window.availableMonitors
        ? await window.__TAURI__.window.availableMonitors()
        : [];
      const mon =
        monitors.find((item) => {
          const left = item.position.x;
          const top = item.position.y;
          return (
            orig.x >= left &&
            orig.x <= left + item.size.width &&
            orig.y >= top &&
            orig.y <= top + item.size.height
          );
        }) || monitors[0];
      if (mon) {
        // 从这里开始是真正的断言：任何失败都必须冒泡，不能再被当成 skip。
        rightInfo = 'right check failed';
        const rightEdge = mon.position.x + mon.size.width;
        const insideRight = rightEdge - size.width + Math.round(markerRight) - 8;
        await w.setPosition(new PPos(insideRight, 300));
        await sleep(900);
        ok(!$('#app').className.includes('edge-hidden'), 'right: marker threshold not reached');
        const outsideRight = rightEdge - size.width + Math.round(markerRight) + 12;
        await w.setPosition(new PPos(outsideRight, 300));
        let hiddenRight = false;
        for (let i = 0; i < 15 && !hiddenRight; i += 1) {
          await sleep(200);
          hiddenRight = $('#app').className.includes('edge-hidden-right');
        }
        ok(hiddenRight, 'right: symmetric threshold hides');
        rightInfo = 'right ok';
      }
    } catch (err) {
      if (rightInfo !== 'skip: no monitor') throw err;
      rightInfo = 'skip: no monitor (' + err.message + ')';
    } finally {
      await w.setPosition(new PPos(orig.x, orig.y));
      await sleep(600);
    }
    const prefix = 'markerRight=' + Math.round(markerRight);
    return rightInfo.startsWith('skip') ? rightInfo + ' ' + prefix : prefix + ' ' + rightInfo;
    } finally {
      await deleteTodo(fixture);
    }
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
    await sleep(80);
    ok($('#app').classList.contains('edge-showing'), 'mouse suppressed while revealing');
    eq(getComputedStyle($('#app')).pointerEvents, 'none', 'pointer events disabled');
    await sleep(160);
    const pos = await w.outerPosition();
    ok(pos.x > hidden.x + 40, 'immediate reveal: ' + pos.x);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(600);
    ok(!$('#app').classList.contains('edge-showing'), 'mouse restored after reveal');
    ok(getComputedStyle($('#app')).pointerEvents !== 'none', 'pointer events enabled');
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
    let exited = false;
    for (let attempt = 0; attempt < 3 && !exited; attempt += 1) {
      await w.setPosition(new PPos(200 + attempt * 24, 200 + attempt * 24));
      for (let i = 0; i < 6 && !exited; i += 1) {
        await sleep(200);
        exited = !$('#app').className.includes('edge-hidden');
      }
    }
    ok(exited, 'exit hide');
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
      let topHidden = false;
      for (let i = 0; i < 25 && !topHidden; i += 1) {
        await sleep(200);
        topHidden = $('#app').className.includes('edge-hidden-top');
      }
      ok(topHidden, 'top hidden: ' + $('#app').className);
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

  await t('[REG-67] 双击行内按钮只能作用一次，不能连带删掉下一条', async () => {
    await addTodo('ITEST-双击-A');
    await addTodo('ITEST-双击-B');
    findRow('ITEST-双击-A').querySelector('.act-btn.del').dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1 })
    );
    await sleep(200);
    ok(!findRow('ITEST-双击-A'), 'first click deletes A');
    const second = findRow('ITEST-双击-B').querySelector('.act-btn.del');
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    await sleep(200);
    ok(findRow('ITEST-双击-B'), 'second click of double-click must be ignored');
    await deleteTodo('ITEST-双击-B');
    return 'double click guarded';
  });

  await t('[REG-68] 误点完成后可通过撤销恢复', async () => {
    await addTodo('ITEST-撤销');
    const row = findRow('ITEST-撤销');
    row.querySelector('.act-btn.done').click();
    await sleep(250);
    ok(!findRow('ITEST-撤销'), 'completed hidden');
    ok(!$('#undoToast').hidden, 'undo toast shown');
    click($('#undoBtn'));
    await sleep(250);
    ok(findRow('ITEST-撤销'), 'undo restores todo');
    await deleteTodo('ITEST-撤销');
    return 'undo works';
  });

  await t('[REG-69] 天气数据形状异常时丢弃而不是启动即只读', async () => {
    eq(window.__TEST_NORMALIZE_WEATHER({ daily: 'bad' }), null);
    eq(window.__TEST_NORMALIZE_WEATHER({ daily: [], current: {} }) !== null, true);
    return 'weather shape guarded';
  });

  await t('[REG-57] 只读告警提供解除入口，并禁用设置与待办操作', async () => {
    // 建一条 fixture，保证「待办操作被禁用」不是空列表上的恒真断言。
    const fixture = 'ITEST-只读';
    await addTodo(fixture);
    try {
      window.__TEST_LOAD_ERROR('data.json 已损坏，原文件已保留为 data.json.corrupt-1');
      await sleep(600);
      ok(!$('#loadError').hidden, 'banner visible');
      const text = $('#loadErrorText').textContent;
      ok(/data\.json\.corrupt-\*/.test(text), 'tells user to move .corrupt-* out: ' + text);
      ok(/不要删除/.test(text), 'warns not to delete: ' + text);
      ok($('#loadErrorOpen') && $('#loadErrorRetry'), 'recovery buttons');
      ok($('#addRow').classList.contains('disabled'), 'add row disabled');
      // 告警条占高度后窗口必须变高，底部添加行不能被 overflow:hidden 裁掉。
      const addRect = $('#addRow').getBoundingClientRect();
      const appRect = $('#app').getBoundingClientRect();
      ok(
        addRect.bottom <= appRect.bottom + 1,
        'add row clipped: ' + addRect.bottom + ' > ' + appRect.bottom
      );
      const act = findRow(fixture).querySelector('.act-btn');
      ok(act && act.disabled, 'todo action disabled');
      click($('#settingsBtn'));
      await sleep(350);
      ok($('#settingsPanel .settings-body').inert, 'settings body inert');
      click($('#settingsDone'));
      await sleep(150);
      return 'read-only ui, banner in layout';
    } finally {
      window.__TEST_RESET_READ_ONLY();
      await sleep(200);
      await deleteTodo(fixture);
    }
  });

  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  return JSON.stringify({ passed, failed, skipped, results });
})()
