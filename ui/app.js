/* 桌面待办 —— Tauri + WebView2 前端 */
(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    opacity: 0.9,
    bg_image: "",
    bg_mode: "fill",
    bg_color: "#342a72",
    font_family: "default",
    font_color: "#eaf1ff",
    minimal: false,
    calendar: false,
    always_on_top: true,
    city: "北京",
    weather_api: "",
    autostart: false,
    hide_taskbar: false,
    latitude: null,
    longitude: null,
    weather_open: false,
    holidays: {},
    x: null,
    y: null,
  };

  const FONT_STACKS = {
    default: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
    yahei: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    simsun: 'SimSun, "Songti SC", serif',
    kaiti: 'KaiTi, "STKaiti", "Kaiti SC", serif',
    fangsong: 'FangSong, "STFangsong", serif',
    simhei: 'SimHei, "Microsoft YaHei", sans-serif',
    dengxian: 'DengXian, "Microsoft YaHei", sans-serif',
  };

  const WMO = {
    0: ["晴", "sun"],
    1: ["晴间多云", "suncloud"],
    2: ["多云", "suncloud"],
    3: ["阴", "cloud"],
    45: ["雾", "fog"],
    48: ["雾凇", "fog"],
    51: ["小毛毛雨", "rain"],
    53: ["毛毛雨", "rain"],
    55: ["强毛毛雨", "rain"],
    56: ["冻毛毛雨", "rain"],
    57: ["强冻毛毛雨", "rain"],
    61: ["小雨", "rain"],
    63: ["中雨", "rain"],
    65: ["大雨", "rain"],
    66: ["冻雨", "rain"],
    67: ["强冻雨", "rain"],
    71: ["小雪", "snow"],
    73: ["中雪", "snow"],
    75: ["大雪", "snow"],
    77: ["雪粒", "snow"],
    80: ["阵雨", "rain"],
    81: ["强阵雨", "rain"],
    82: ["暴雨", "rain"],
    85: ["阵雪", "snow"],
    86: ["强阵雪", "snow"],
    95: ["雷阵雨", "thunder"],
    96: ["雷阵雨伴冰雹", "thunder"],
    99: ["强雷雨伴冰雹", "thunder"],
  };

  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const AI_PROVIDER_LABELS = {
    "deepseek-harness": "DeepSeek",
    deepseek: "DeepSeek",
    dsh: "DeepSeek",
    workbuddy: "WorkBuddy",
    "work-buddy": "WorkBuddy",
    wb: "WorkBuddy",
    doubao: "豆包",
    "豆包": "豆包",
    "": "AI",
  };
  const LUNAR_DAYS = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
  ];

  // 二十四节气等纯函数集中在 core.js
  const {
    SOLAR_TERMS,
    pad2,
    ymd,
    solarTermOn,
    layoutBands,
    badgePlacements,
    buildExportText,
  } = window.TodoCore;

  // 节气弹框背景：深色渐变 + 节气名水印，按季节配一组颜色
  const TERM_THEME = {
    小寒: ["#101c33", "#2f4d78", "#bcd8ff"],
    大寒: ["#0d1830", "#294469", "#c6ddff"],
    立春: ["#12291f", "#3f6f52", "#d4edbc"],
    雨水: ["#122b3b", "#356f8b", "#c5e8f4"],
    惊蛰: ["#1b2a1d", "#5a7d35", "#e2edb4"],
    春分: ["#22301c", "#6b8f42", "#edf5c4"],
    清明: ["#182a25", "#4f8060", "#d4ecdb"],
    谷雨: ["#1d2f22", "#5f8a3f", "#e3f0ba"],
    立夏: ["#0f2d20", "#2a7a4c", "#c6efc9"],
    小满: ["#283016", "#7d9633", "#edf3bb"],
    芒种: ["#332e16", "#a37f28", "#f7eab1"],
    夏至: ["#342410", "#bd7728", "#ffe3aa"],
    小暑: ["#38250f", "#c47f30", "#ffdfa6"],
    大暑: ["#3b1c0b", "#cf5c2a", "#ffcf9e"],
    立秋: ["#332513", "#aa6928", "#ffe0b0"],
    处暑: ["#2d2316", "#8f6f35", "#f2dfba"],
    白露: ["#1d2c34", "#648a94", "#dcefee"],
    秋分: ["#2d2318", "#956c38", "#f4dfbe"],
    寒露: ["#1a262e", "#53757d", "#d3e8e8"],
    霜降: ["#26252a", "#7f7e8a", "#e9e8f0"],
    立冬: ["#18202e", "#475871", "#d7e0ee"],
    小雪: ["#1a2534", "#57708c", "#dfeaf7"],
    大雪: ["#141f31", "#455d7c", "#d2e0f4"],
    冬至: ["#101827", "#395073", "#c9d9f2"],
  };
  const TERM_SEASON = {
    spring: "M42 196 C42 150 58 128 92 116 C90 156 74 182 42 196 Z",
    autumn: "M46 200 C74 186 96 160 98 124 C66 132 46 158 46 200 Z",
  };
  const TERM_BG_CACHE = new Map();

  // 中国法定节假日：NateScarlet/holiday-cn 每年发布一份 JSON，包含放假与调休
  const HOLIDAY_URL = (year) =>
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
  // 节日底色等纯规则集中在 ui/domain/holiday.js（HolidayDomain.holidayTint）

  // 每日一句：内置 1313 条中外名言/格言/谚语，随机展示，不需要联网
  const QUOTE_SEED_URL = "quotes.json";

  // 悬停日期时随机展示一句，全部选用公版古籍、诗词与常见谚语
  const QUOTES = [
    { text: "千里之行，始于足下。", from: "《道德经》" },
    { text: "不积跬步，无以至千里；不积小流，无以成江海。", from: "《荀子》" },
    { text: "锲而不舍，金石可镂。", from: "《荀子》" },
    { text: "天行健，君子以自强不息。", from: "《周易》" },
    { text: "地势坤，君子以厚德载物。", from: "《周易》" },
    { text: "长风破浪会有时，直挂云帆济沧海。", from: "李白" },
    { text: "会当凌绝顶，一览众山小。", from: "杜甫" },
    { text: "沉舟侧畔千帆过，病树前头万木春。", from: "刘禹锡" },
    { text: "山重水复疑无路，柳暗花明又一村。", from: "陆游" },
    { text: "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", from: "苏轼" },
    { text: "莫听穿林打叶声，何妨吟啸且徐行。", from: "苏轼" },
    { text: "纸上得来终觉浅，绝知此事要躬行。", from: "陆游" },
    { text: "问渠那得清如许？为有源头活水来。", from: "朱熹" },
    { text: "欲穷千里目，更上一层楼。", from: "王之涣" },
    { text: "天生我材必有用，千金散尽还复来。", from: "李白" },
    { text: "路漫漫其修远兮，吾将上下而求索。", from: "屈原" },
    { text: "穷且益坚，不坠青云之志。", from: "王勃" },
    { text: "宝剑锋从磨砺出，梅花香自苦寒来。", from: "《警世贤文》" },
    { text: "不经一番寒彻骨，怎得梅花扑鼻香。", from: "黄檗禅师" },
    { text: "海纳百川，有容乃大；壁立千仞，无欲则刚。", from: "林则徐" },
    { text: "落红不是无情物，化作春泥更护花。", from: "龚自珍" },
    { text: "但愿人长久，千里共婵娟。", from: "苏轼" },
    { text: "三人行，必有我师焉。", from: "孔子" },
    { text: "知之者不如好之者，好之者不如乐之者。", from: "孔子" },
    { text: "工欲善其事，必先利其器。", from: "孔子" },
    { text: "敏而好学，不耻下问。", from: "孔子" },
    { text: "君子坦荡荡，小人长戚戚。", from: "孔子" },
    { text: "车到山前必有路，船到桥头自然直。", from: "谚语" },
    { text: "只要功夫深，铁杵磨成针。", from: "谚语" },
    { text: "世上无难事，只怕有心人。", from: "谚语" },
    { text: "一分耕耘，一分收获。", from: "谚语" },
    { text: "水滴石穿，绳锯木断。", from: "谚语" },
    { text: "失败乃成功之母。", from: "谚语" },
    { text: "熟能生巧。", from: "谚语" },
    { text: "勤能补拙。", from: "谚语" },
    { text: "笨鸟先飞早入林。", from: "谚语" },
    { text: "吃一堑，长一智。", from: "谚语" },
    { text: "临渊羡鱼，不如退而结网。", from: "《汉书》" },
    { text: "有志者，事竟成。", from: "《后汉书》" },
    { text: "精诚所至，金石为开。", from: "《后汉书》" },
    { text: "桃李不言，下自成蹊。", from: "《史记》" },
    { text: "不飞则已，一飞冲天；不鸣则已，一鸣惊人。", from: "《史记》" },
    { text: "燕雀安知鸿鹄之志。", from: "《史记》" },
    { text: "业精于勤，荒于嬉。", from: "韩愈" },
    { text: "读书破万卷，下笔如有神。", from: "杜甫" },
    { text: "少壮不努力，老大徒伤悲。", from: "《长歌行》" },
    { text: "一年之计在于春，一日之计在于晨。", from: "《增广贤文》" },
    { text: "但行好事，莫问前程。", from: "《增广贤文》" },
    { text: "不忘初心，方得始终。", from: "《华严经》" },
  ];
  const WEATHER_W = 250;
  const GAP = 12;
  const MARGIN = 12;
  const SETTINGS_W = 404;
  const SETTINGS_H = 620;
  const SNAP_DIST = 20;
  // 窄边厚度：原 48 减小 1/4
  const EDGE_SLIVER = 36;
  const EDGE_REVEAL_MS = 800;
  const EDGE_LEAVE_MS = 700;
  const EDGE_HIDE_ANIM_MS = 378;
  const EDGE_SHOW_ANIM_MS = 378;
  const TRAY_HIDE_MS = 5000;
  const TOP_DWELL_MS = 2000;
  // 日历模式是一整页：左列待办，右列月历（宽度与 CSS 中的 300px 列保持一致）
  const CAL_TODO_W = 300;
  const CAL_W = 393;
  const CAL_H = 392;

  const tauri = window.__TAURI__ || {};
  const realInvoke = tauri.core?.invoke || (async () => null);
  // 测试钩子：集成用例用 window.__TEST_INVOKE 注入失败（断网、磁盘只读等），生产环境为空。
  const invoke = (cmd, args) =>
    typeof window.__TEST_INVOKE === "function"
      ? window.__TEST_INVOKE(cmd, args)
      : realInvoke(cmd, args);
  const win = tauri.window?.getCurrentWindow?.() || null;
  const LogicalSize = tauri.dpi?.LogicalSize || tauri.window?.LogicalSize;
  const LogicalPosition = tauri.dpi?.LogicalPosition || tauri.window?.LogicalPosition;
  const PhysicalPosition = tauri.dpi?.PhysicalPosition || tauri.window?.PhysicalPosition;
  const convertFileSrc = tauri.core?.convertFileSrc;

  const state = { todos: [], settings: { ...DEFAULT_SETTINGS }, weather: null };
  const els = {};
  let weatherLeft = false;
  let settingsOpen = false;
  let settingsSavedSize = null;
  let addEditing = false;
  let dueTodoId = null;
  let calAddDue = null;
  let calAddKey = null;
  let cellHoverTimer = null;
  let hoverCell = null;
  let infoHideTimer = null;
  const weekScroll = new Map();
  const MAX_BARS = 3;
  const INFO_HIDE_DELAY = 1200;
  // 单击弹出后的停留时长：弹框可能出现在光标上方，需要足够时间移过去。
  // 悬停触发（光标已在格子上）用 INFO_HIDE_DELAY 即可。
  const INFO_CLICK_HOLD = 3000;
  // 单击弹出的弹框在光标经过其它日期格时要保持，不能像悬停那样被替换掉。
  let infoPinned = false;
  let lastQuoteIndex = -1;
  let networkOk = null;
  let calPress = null;
  let monthCursor = null;
  let weatherBusy = false;
  let weatherFailed = false;
  let weatherRetryTimer = null;
  const WEATHER_RETRY_MS = 30 * 1000;
  const WEATHER_RETRY_MAX_MS = 10 * 60 * 1000;
  const holidayBusy = new Set();
  const holidayFailed = new Set();
  let quoteSeed = [];
  let layoutChain = Promise.resolve();
  let saveTimer = null;
  let lastDay = new Date().toDateString();
  let dragTimer = null;
  let moveSettleTimer = null;
  let edgeHide = null;
  let edgeAnimToken = 0;
  let pendingAnimStart = null;
  let animStartListening = false;
  let edgeAnimating = null;
  let edgeClickGuardUntil = 0;
  let trayHideTimer = null;
  let edgeRevealTimer = null;
  let edgeLeaveTimer = null;
  let edgePollTimer = null;
  let topDwellSince = 0;
  let topDwellTimer = null;
  let pointerDown = false;
  let tickCount = 0;

  /* ---------------------------------------------------------- utils */
  const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // 透明度滑杆按线性光映射到 sRGB alpha（gamma 2.2），见 ui/core.js
  const { opacityFromTransparency, transparencyFromOpacity } = window.TodoCore;
  // 待办领域规则集中在 ui/domain/todo.js
  const { parseDue, dueState, dueText, todoDuration, sortTodos, createTodo, applyDone } =
    window.TodoDomain;
  const { buildEvents, buildMonthWeeks } = window.CalendarDomain;
  const { buildHolidayMap, holidayTint } = window.HolidayDomain;
  const { pickQuote } = window.QuoteDomain;

  function wmoInfo(code) {
    return WMO[Number(code)] || ["未知", "cloud"];
  }

  function toFileUrl(path) {
    if (!path) return "";
    try {
      if (convertFileSrc) return convertFileSrc(path);
    } catch (err) {
      console.warn(err);
    }
    return "file:///" + String(path).replace(/\\/g, "/");
  }

  /* ------------------------------------------------------- glass color */
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;

  function normalizeHex(raw, fallback) {
    const value = String(raw || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return ("#" + value.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
    }
    return HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
  }

  function hexRgb(hex) {
    const value = normalizeHex(hex, DEFAULT_SETTINGS.bg_color).slice(1);
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }

  /** 由选中的底色推导玻璃渐变、设置面板的深浅色。 */
  function applyGlassColor(hex) {
    const [r, g, b] = hexRgb(hex);
    const rgb = (k) => `${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}`;
    els.app.style.setProperty("--glass-hi", `${r}, ${g}, ${b}`);
    els.app.style.setProperty("--glass-lo", rgb(0.32));
    els.app.style.setProperty("--panel-hi", rgb(0.85));
    els.app.style.setProperty("--panel-lo", rgb(0.28));
  }

  /* ----------------------------------------------------------- icons */
  const svg = (body, size = 12, color = "currentColor") =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

  const ICON = {
    check: svg('<path d="M5 12.5l4.3 4.3L19 7.5"/>'),
    pin: svg('<path d="M9.5 4.5h5l-.7 4.6 3.2 3.1v1.9H7v-1.9l3.2-3.1-.7-4.6z"/><path d="M12 14v5.5"/>'),
    clock: svg('<circle cx="12" cy="12" r="7.6"/><path d="M12 8v4.4l2.9 1.7"/>'),
    trash: svg('<path d="M5 7h14M10 7V5.2h4V7M7.4 7l.8 12h7.6l.8-12"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 13, "#5b8cff"),
    gear: svg(
      '<path d="M4 7h8M16.5 7H20M4 17h3M11.5 17H20"/><circle cx="14.2" cy="7" r="2.2"/><circle cx="9.2" cy="17" r="2.2"/>',
      17
    ),
  };

  function wxIcon(kind, size = 20) {
    const wrap = (body) =>
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    const sunRays =
      '<g stroke="#FFCF66" stroke-width="1.5"><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></g>' +
      '<circle cx="12" cy="12" r="4" fill="#FFD166"/>';
    const cloud =
      '<path d="M7.4 18.3h9.4a3.5 3.5 0 0 0 .4-6.9 4.9 4.9 0 0 0-9.4-1A3.7 3.7 0 0 0 7.4 18.3z" fill="#B8CCEC" stroke="none"/>';
    const cloudSmall = cloud;

    switch (kind) {
      case "sun":
        return wrap(sunRays);
      case "suncloud":
        return wrap(
          '<g transform="translate(2.2 .2) scale(.82)">' +
            sunRays +
            "</g>" +
            '<path d="M7.8 18.6h8.8a3.1 3.1 0 0 0 .3-6.1 4.4 4.4 0 0 0-8.4-.9 3.3 3.3 0 0 0-.7 7z" fill="#B8CCEC" stroke="none"/>'
        );
      case "cloud":
        return wrap(cloud);
      case "rain":
        return wrap(
          '<g transform="translate(0 -2.4)">' +
            cloudSmall +
            "</g>" +
            '<g stroke="#7FB2FF" stroke-width="1.6"><path d="M8.2 18.6l-1 2.6M12 18.6l-1 2.6M15.8 18.6l-1 2.6"/></g>'
        );
      case "snow":
        return wrap(
          '<g transform="translate(0 -2.4)">' +
            cloudSmall +
            "</g>" +
            '<g fill="#DDEBFF"><circle cx="8.2" cy="19.4" r="1.05"/><circle cx="12" cy="20.6" r="1.05"/><circle cx="15.8" cy="19.4" r="1.05"/></g>'
        );
      case "thunder":
        return wrap(
          '<g transform="translate(0 -2.4)">' +
            cloudSmall +
            "</g>" +
            '<path d="M12.8 15.4l-3 4.6h2.4l-1 3 3.6-4.8h-2.4l.4-2.8z" fill="#FBBF3C" stroke="none"/>'
        );
      case "fog":
        return wrap(
          '<g transform="translate(0 -1.6)">' +
            cloudSmall +
            "</g>" +
            '<g stroke="#AFC3E6" stroke-width="1.5" opacity=".85"><path d="M7 18.4h10M8.4 21h8"/></g>'
        );
      default:
        return wrap(cloud);
    }
  }

  /* ------------------------------------------------------- lifecycle */
  const DEFAULT_BODY = () => `${ICON.plus}<span class="add-text">添加待办</span>`;

  function cacheEls() {
    els.app = document.getElementById("app");
    els.topRow = document.querySelector(".top-row");
    els.todoCard = document.getElementById("todoCard");
    els.header = document.querySelector(".todo-header");
    els.title = document.querySelector(".title");
    els.count = document.getElementById("count");
    els.weatherPill = document.getElementById("weatherPill");
    els.pillIcon = document.getElementById("pillIcon");
    els.pillText = document.getElementById("pillText");
    els.settingsBtn = document.getElementById("settingsBtn");
    els.todoList = document.getElementById("todoList");
    els.addRow = document.getElementById("addRow");
    els.weatherCard = document.getElementById("weatherCard");
    els.wcClock = document.getElementById("wcClock");
    els.wcDate = document.getElementById("wcDate");
    els.wcCity = document.getElementById("wcCity");
    els.wcIcon = document.getElementById("wcIcon");
    els.wcTemp = document.getElementById("wcTemp");
    els.wcCond = document.getElementById("wcCond");
    els.wcHilo = document.getElementById("wcHilo");
    els.wcExtra = document.getElementById("wcExtra");
    els.forecast = document.getElementById("forecast");
    els.wcStatus = document.getElementById("wcStatus");
    els.calendarCard = document.getElementById("calendarCard");
    els.calTitle = document.getElementById("calTitle");
    els.calSub = document.getElementById("calSub");
    els.calGrid = document.getElementById("calGrid");
    els.calPrev = document.getElementById("calPrev");
    els.calNext = document.getElementById("calNext");
    els.calToday = document.getElementById("calToday");
    els.bgImage = document.getElementById("bgImage");
    els.edgePeek = document.getElementById("edgePeek");
    els.settingsOverlay = document.getElementById("settingsOverlay");
    els.settingsPanel = document.getElementById("settingsPanel");
    els.settingsClose = document.getElementById("settingsClose");
    els.settingsDone = document.getElementById("settingsDone");
    els.opacityRange = document.getElementById("opacityRange");
    els.opacityValue = document.getElementById("opacityValue");
    els.bgPreview = document.getElementById("bgPreview");
    els.colorRow = document.getElementById("colorRow");
    els.bgColor = document.getElementById("bgColor");
    els.fontSelect = document.getElementById("fontSelect");
    els.fontColorRow = document.getElementById("fontColorRow");
    els.fontColor = document.getElementById("fontColor");
    els.pickBg = document.getElementById("pickBg");
    els.clearBg = document.getElementById("clearBg");
    els.bgModes = document.getElementById("bgModes");
    els.calendarSwitch = document.getElementById("calendarSwitch");
    els.exportBtn = document.getElementById("exportBtn");
    els.autostartSwitch = document.getElementById("autostartSwitch");
    els.taskbarSwitch = document.getElementById("taskbarSwitch");
    els.aboutVersion = document.getElementById("aboutVersion");
    els.minimalSwitch = document.getElementById("minimalSwitch");
    els.topSwitch = document.getElementById("topSwitch");
    els.cityInput = document.getElementById("cityInput");
    els.locateHint = document.getElementById("locateHint");
    els.weatherApiInput = document.getElementById("weatherApiInput");
    els.locateBtn = document.getElementById("locateBtn");
    els.quitBtn = document.getElementById("quitBtn");
    els.duePopover = document.getElementById("duePopover");
    els.dueDate = document.getElementById("dueDate");
    els.dueTime = document.getElementById("dueTime");
    els.dueClear = document.getElementById("dueClear");
    els.dueOk = document.getElementById("dueOk");
    els.calAddPopover = document.getElementById("calAddPopover");
    els.calAddTitle = document.getElementById("calAddTitle");
    els.calAddInput = document.getElementById("calAddInput");
    els.calAddHint = document.getElementById("calAddHint");
    els.calAddClock = document.getElementById("calAddClock");
    els.calAddTime = document.getElementById("calAddTime");
    els.calAddDate = document.getElementById("calAddDate");
    els.calAddTimeValue = document.getElementById("calAddTimeValue");
    els.calAddCancel = document.getElementById("calAddCancel");
    els.calAddOk = document.getElementById("calAddOk");
    els.calInfo = document.getElementById("calInfo");
    els.ciTerm = document.getElementById("ciTerm");
    els.ciLunar = document.getElementById("ciLunar");
    els.ciWeather = document.getElementById("ciWeather");
    els.ciWIcon = document.getElementById("ciWIcon");
    els.ciWText = document.getElementById("ciWText");
    els.ciQuote = document.getElementById("ciQuote");
    els.ciQuoteText = document.getElementById("ciQuoteText");
    els.ciQuoteFrom = document.getElementById("ciQuoteFrom");
  }

  async function loadAppVersion() {
    if (!els.aboutVersion) return;
    try {
      const version = await tauri.app?.getVersion?.();
      if (version) els.aboutVersion.textContent = version;
    } catch (err) {
      /* ignore */
    }
  }

  async function boot() {
    cacheEls();
    loadQuoteSeed();
    try {
      const loaded = await invoke("load_state");
      if (loaded && typeof loaded === "object") {
        if (Array.isArray(loaded.todos)) state.todos = loaded.todos;
        if (loaded.settings && typeof loaded.settings === "object") {
          state.settings = { ...DEFAULT_SETTINGS, ...loaded.settings };
        }
        if (loaded.weather && typeof loaded.weather === "object") state.weather = loaded.weather;
      }
    } catch (err) {
      console.warn("load_state failed", err);
    }
    normalizeState();
    wireEvents();
    applyAppearance();
    syncSettingsUi();
    renderTodos();
    renderCalendar();
    renderWeatherCard();
    renderWeatherPill();
    await scheduleLayout();
    await restorePosition();
    try {
      if (win) await win.setAlwaysOnTop(!!state.settings.always_on_top);
    } catch (err) {
      /* ignore */
    }

    const wantWeather = !!state.settings.weather_open;
    state.settings.weather_open = false;
    els.weatherPill.hidden = false;
    if (wantWeather) {
      await toggleWeather(true);
    } else {
      updateWeatherPillState();
    }

    updateClock();
    tick();
    await pullAiTodos();
    setInterval(tick, 1000);
    setInterval(updateRowStates, 15000);
    setInterval(() => { if (!weatherBusy) refreshWeather(); }, 30 * 60 * 1000);
    setInterval(savePosition, 10000);

    setTimeout(() => refreshWeather(), 350);
    holidayCheckToday();
    loadAppVersion();
    invoke("get_autostart")
      .then((on) => {
        state.settings.autostart = !!on;
        setSwitch(els.autostartSwitch, !!on);
      })
      .catch(() => {});
    invoke("set_taskbar_hidden", { enabled: !!state.settings.hide_taskbar }).catch(() => {});
    if (
      state.settings.city === "当前位置" &&
      Number.isFinite(Number(state.settings.latitude)) &&
      Number.isFinite(Number(state.settings.longitude))
    ) {
      resolveCityName(Number(state.settings.latitude), Number(state.settings.longitude));
    }
    els.app.classList.add("ready");
  }

  function normalizeState() {
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    const rawOpacity = Number(state.settings.opacity);
    state.settings.opacity = Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0, 1) : 0.9;
    state.settings.bg_color = normalizeHex(state.settings.bg_color, DEFAULT_SETTINGS.bg_color);
    state.settings.font_family = FONT_STACKS[state.settings.font_family]
      ? state.settings.font_family
      : "default";
    state.settings.font_color = normalizeHex(
      state.settings.font_color,
      DEFAULT_SETTINGS.font_color
    );
    state.settings.weather_api =
      typeof state.settings.weather_api === "string" ? state.settings.weather_api.trim() : "";
    state.settings.autostart = !!state.settings.autostart;
    state.settings.hide_taskbar = !!state.settings.hide_taskbar;
    state.settings.minimal = !!state.settings.minimal;
    state.settings.calendar = !!state.settings.calendar;
    if (!state.settings.holidays || typeof state.settings.holidays !== "object") {
      state.settings.holidays = {};
    }
    // 日历模式与极简模式互斥，日历模式优先
    if (state.settings.calendar) state.settings.minimal = false;
    state.todos = (Array.isArray(state.todos) ? state.todos : [])
      .filter((todo) => todo && typeof todo.text === "string")
      .map((todo) => ({
        id: todo.id || crypto.randomUUID(),
        text: todo.text,
        done: !!todo.done,
        done_at: todo.done_at || null,
        pinned: !!todo.pinned,
        due: todo.due || null,
        start: todo.start || null,
        created: todo.created || new Date().toISOString(),
      }));
  }

  /* ------------------------------------------------------ persistence */
  let saveRetryTimer = null;
  let saveFailures = 0;
  let saving = false;
  const SAVE_RETRY_MS = 5 * 1000;
  const SAVE_RETRY_MAX_MS = 2 * 60 * 1000;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      // 上一次写盘还没结束：重新排队，绝不能直接丢弃（那会丢掉这期间的用户改动）
      if (saving) {
        save();
        return;
      }
      saving = true;
      try {
        await invoke("save_state", { state: serializeState() });
        saveFailures = 0;
        clearTimeout(saveRetryTimer);
        saveRetryTimer = null;
      } catch (err) {
        saveFailures += 1;
        console.warn("save_state failed", err);
        // 写盘失败不能只留在内存里：断网 / 磁盘被占用恢复后必须自动补写，
        // 否则用户这段时间的待办会在重启后全部丢失。
        clearTimeout(saveRetryTimer);
        const delay = Math.min(
          SAVE_RETRY_MAX_MS,
          SAVE_RETRY_MS * Math.pow(2, Math.min(saveFailures - 1, 5))
        );
        saveRetryTimer = setTimeout(() => {
          saveRetryTimer = null;
          save();
        }, delay);
      } finally {
        saving = false;
      }
    }, 200);
  }

  function serializeState() {
    return {
      todos: state.todos,
      settings: state.settings,
      weather: state.weather,
    };
  }

  // 待办写操作的统一出口：保存 + 重绘 + 布局
  function commitTodos(options = {}) {
    save();
    renderTodos();
    if (options.layout === false) return Promise.resolve();
    const pending = scheduleLayout();
    if (options.scrollBottom) {
      pending.then(() => {
        els.todoList.scrollTop = els.todoList.scrollHeight;
      });
    }
    return pending;
  }

  async function savePosition() {
    if (!win || settingsOpen) return;
    if (edgeHide) return; // 隐藏时保留进入隐藏前的位置
    try {
      const rect = await getWindowRect();
      if (rect.x !== state.settings.x || rect.y !== state.settings.y) {
        state.settings.x = Math.round(rect.x);
        state.settings.y = Math.round(rect.y);
        save();
      }
    } catch (err) {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------- window */
  async function getWindowRect() {
    if (!win) {
      return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    }
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition();
    const size = await win.innerSize();
    return {
      x: pos.x / scale,
      y: pos.y / scale,
      w: size.width / scale,
      h: size.height / scale,
    };
  }

  async function setWindowSize(width, height) {
    if (!win || !LogicalSize) return;
    try {
      const scale = await win.scaleFactor();
      const size = await win.innerSize();
      const currentW = Math.round(size.width / scale);
      const currentH = Math.round(size.height / scale);
      if (currentW === Math.round(width) && currentH === Math.round(height)) return;
      await win.setSize(new LogicalSize(Math.round(width), Math.round(height)));
    } catch (err) {
      console.warn("setSize failed", err);
    }
  }

  async function setWindowPos(x, y) {
    if (!win || !LogicalPosition) return;
    try {
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
    } catch (err) {
      console.warn("setPosition failed", err);
    }
  }

  function screenBounds() {
    const left = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
    const top = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
    return {
      left,
      top,
      right: left + window.screen.availWidth,
      bottom: top + window.screen.availHeight,
    };
  }

  /** 尺寸变化后把窗口拉回屏幕可用区域，避免底部被任务栏裁切。 */
  async function clampWindowPosition() {
    if (edgeHide) return;
    const rect = await getWindowRect();
    const avail = screenBounds();
    const maxX = Math.max(avail.left, avail.right - rect.w);
    const maxY = Math.max(avail.top, avail.bottom - rect.h);
    const x = Math.round(clamp(rect.x, avail.left, maxX));
    const y = Math.round(clamp(rect.y, avail.top, maxY));
    if (Math.abs(x - rect.x) > 0.5 || Math.abs(y - rect.y) > 0.5) {
      await setWindowPos(x, y);
    }
    state.settings.x = x;
    state.settings.y = y;
  }

  /** 拖动结束后贴近屏幕边缘时自动吸附 */
  async function snapWindowToEdges() {
    if (!win || edgeHide) return;
    try {
      const rect = await getWindowRect();
      const avail = screenBounds();
      let x = rect.x;
      let y = rect.y;
      if (Math.abs(rect.x - avail.left) <= SNAP_DIST) x = avail.left;
      if (Math.abs(avail.right - (rect.x + rect.w)) <= SNAP_DIST) x = avail.right - rect.w;
      if (Math.abs(rect.y - avail.top) <= SNAP_DIST) y = avail.top;
      if (Math.abs(avail.bottom - (rect.y + rect.h)) <= SNAP_DIST) y = avail.bottom - rect.h;
      if (Math.abs(x - rect.x) > 0.5 || Math.abs(y - rect.y) > 0.5) {
        await setWindowPos(x, y);
        state.settings.x = Math.round(x);
        state.settings.y = Math.round(y);
      }
    } catch (err) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------ edge hide */
  async function setWindowPosPhysical(x, y) {
    if (!win || !PhysicalPosition) return;
    try {
      await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    } catch (err) {
      /* ignore */
    }
  }

  /** 窗口位移交给 Rust 逐帧执行；Rust 开始时发事件，前端据此同步启动内容动画 */
  async function animateWindowTo(x, y, duration, onStart) {
    if (!win) return;
    ensureAnimStartListener();
    const id = ++edgeAnimToken;
    edgeAnimating = id;
    pendingAnimStart = { id, onStart };
    const fireStart = () => {
      if (pendingAnimStart && pendingAnimStart.id === id) {
        const cb = pendingAnimStart.onStart;
        pendingAnimStart = null;
        if (cb) cb();
      }
    };
    const fallback = setTimeout(fireStart, 90);
    try {
      await invoke("animate_window", {
        x: Math.round(x),
        y: Math.round(y),
        durationMs: Math.max(120, Math.round(duration)),
        id,
      });
    } catch (err) {
      fireStart();
      await setWindowPosPhysical(x, y);
    } finally {
      clearTimeout(fallback);
      if (edgeAnimating === id) edgeAnimating = null;
    }
  }

  function ensureAnimStartListener() {
    if (animStartListening || !tauri.event) return;
    animStartListening = true;
    try {
      tauri.event.listen("edge-anim-start", (event) => {
        const id = Number(event.payload);
        if (pendingAnimStart && pendingAnimStart.id === id) {
          const cb = pendingAnimStart.onStart;
          pendingAnimStart = null;
          if (cb) cb();
        }
      });
    } catch (err) {
      /* ignore */
    }
  }

  function edgeOrigin(edge) {
    if (edge === "top") return "50% 100%";
    if (edge === "bottom") return "50% 0%";
    if (edge === "left") return "100% 50%";
    return "0% 50%";
  }

  /** 内容缩放/淡入淡出交给 CSS transition（合成器执行），由 Rust 动画开始事件触发 */
  function prepareEdgeContent(edge) {
    if (!els.app) return;
    els.app.style.transition = "none";
    els.app.style.transformOrigin = edgeOrigin(edge);
    els.app.style.transform = "scale(0.55)";
    els.app.style.opacity = "0.08";
  }

  function runEdgeContent(edge, hiding, duration) {
    if (!els.app) return;
    // 略长于窗口位移，避免系统繁忙时窗口晚到、内容已提前放大完导致跳一下
    const ms = Math.max(120, Math.round(duration * 1.1));
    els.app.style.transformOrigin = edgeOrigin(edge);
    els.app.style.transition = `transform ${ms}ms cubic-bezier(0.45, 0, 0.55, 1), opacity ${ms}ms cubic-bezier(0.45, 0, 0.55, 1)`;
    els.app.style.transform = hiding ? "scale(0.55)" : "scale(1)";
    els.app.style.opacity = hiding ? "0.08" : "1";
  }

  function resetEdgeTransform() {
    if (!els.app) return;
    els.app.style.transition = "";
    els.app.style.transform = "";
    els.app.style.transformOrigin = "";
    els.app.style.opacity = "";
  }

  function monitorList() {
    try {
      const api = tauri.window;
      return api && api.availableMonitors ? api.availableMonitors() : Promise.resolve([]);
    } catch (err) {
      return Promise.resolve([]);
    }
  }

  function monitorRect(mon) {
    return {
      x: mon.position.x,
      y: mon.position.y,
      w: mon.size.width,
      h: mon.size.height,
    };
  }

  function overlapArea(x, y, w, h, r) {
    const left = Math.max(x, r.x);
    const top = Math.max(y, r.y);
    const right = Math.min(x + w, r.x + r.w);
    const bottom = Math.min(y + h, r.y + r.h);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function pickMonitor(pos, size, monitors) {
    let best = null;
    let bestArea = 0;
    for (const mon of monitors) {
      const r = monitorRect(mon);
      const area = overlapArea(pos.x, pos.y, size.width, size.height, r);
      if (area > bestArea) {
        bestArea = area;
        best = r;
      }
    }
    return best;
  }

  function visibleRatio(pos, size, monitors) {
    const area = size.width * size.height;
    if (!area) return 1;
    let visible = 0;
    for (const mon of monitors) {
      visible += overlapArea(pos.x, pos.y, size.width, size.height, monitorRect(mon));
    }
    return Math.min(1, visible / area);
  }

  async function enterEdgeHide(edge, r, pos, size) {
    if (edgeHide || !win) return;
    const sliver = EDGE_SLIVER;
    const shown = { x: pos.x, y: pos.y };
    if (edge === "top" || edge === "bottom") {
      shown.x = clamp(pos.x, r.x, Math.max(r.x, r.x + r.w - size.width));
    } else {
      shown.y = clamp(pos.y, r.y, Math.max(r.y, r.y + r.h - size.height));
    }
    if (edge === "left") shown.x = r.x;
    if (edge === "right") shown.x = r.x + r.w - size.width;
    if (edge === "top") shown.y = r.y;
    if (edge === "bottom") shown.y = r.y + r.h - size.height;

    const hidden = { x: shown.x, y: shown.y };
    if (edge === "left") hidden.x = r.x - size.width + sliver;
    if (edge === "right") hidden.x = r.x + r.w - sliver;
    if (edge === "top") hidden.y = r.y - size.height + sliver;
    if (edge === "bottom") hidden.y = r.y + r.h - sliver;

    edgeHide = {
      edge,
      rect: r,
      size,
      hidden,
      shown,
      revealed: false,
      armed: false,
      pending: pointerDown,
    };
    topDwellSince = 0;
    clearTimeout(topDwellTimer);
    clearTimeout(edgeRevealTimer);
    edgeRevealTimer = null;
    clearTimeout(edgeLeaveTimer);
    hideCalInfo();
    closeDuePopover();
    closeCalAdd();
    startEdgePoll();
    await animateWindowTo(hidden.x, hidden.y, EDGE_HIDE_ANIM_MS, () =>
      runEdgeContent(edge, true, EDGE_HIDE_ANIM_MS)
    );
    showEdgePeek(edge);
    resetEdgeTransform();
  }

  function showEdgePeek(edge) {
    if (!els.app) return;
    els.app.classList.add("edge-hidden", `edge-hidden-${edge}`);
    if (els.edgePeek) els.edgePeek.hidden = false;
  }

  function hideEdgePeek() {
    if (!els.app) return;
    els.app.classList.remove(
      "edge-hidden",
      "edge-hidden-top",
      "edge-hidden-bottom",
      "edge-hidden-left",
      "edge-hidden-right"
    );
    if (els.edgePeek) els.edgePeek.hidden = true;
  }

  async function revealEdgeHide() {
    if (!edgeHide || edgeHide.revealed) return;
    edgeHide.revealed = true;
    clearTimeout(edgeRevealTimer);
    edgeRevealTimer = null;
    const edge = edgeHide.edge;
    prepareEdgeContent(edge);
    hideEdgePeek();
    await animateWindowTo(edgeHide.shown.x, edgeHide.shown.y, EDGE_SHOW_ANIM_MS, () =>
      runEdgeContent(edge, false, EDGE_SHOW_ANIM_MS)
    );
    resetEdgeTransform();
  }

  async function concealEdgeHide() {
    if (!edgeHide || !edgeHide.revealed) return;
    edgeHide.revealed = false;
    clearTimeout(trayHideTimer);
    trayHideTimer = null;
    const edge = edgeHide.edge;
    await animateWindowTo(edgeHide.hidden.x, edgeHide.hidden.y, EDGE_HIDE_ANIM_MS, () =>
      runEdgeContent(edge, true, EDGE_HIDE_ANIM_MS)
    );
    showEdgePeek(edge);
    resetEdgeTransform();
  }

  function clearEdgeHide() {
    edgeHide = null;
    edgeAnimToken += 1;
    edgeAnimating = null;
    clearTimeout(trayHideTimer);
    trayHideTimer = null;
    invoke("cancel_window_anim").catch(() => {});
    clearTimeout(edgeRevealTimer);
    edgeRevealTimer = null;
    clearTimeout(edgeLeaveTimer);
    edgeLeaveTimer = null;
    clearInterval(edgePollTimer);
    edgePollTimer = null;
    hideEdgePeek();
    resetEdgeTransform();
  }

  function startEdgePoll() {
    clearInterval(edgePollTimer);
    edgePollTimer = setInterval(pollEdgeHover, 200);
  }

  // 托盘图标唤出：如果处于边缘收起状态，弹出后 5 秒自动收回（鼠标在窗口上则顺延）
  function handleTrayShow() {
    if (!edgeHide) return;
    revealEdgeHide();
    clearTimeout(trayHideTimer);
    trayHideTimer = setTimeout(trayHideTick, TRAY_HIDE_MS);
  }

  function trayHideTick() {
    trayHideTimer = null;
    if (!edgeHide || !edgeHide.revealed) return;
    if (els.app && els.app.matches(":hover")) {
      trayHideTimer = setTimeout(trayHideTick, 1000);
      return;
    }
    concealEdgeHide();
  }

  async function pollEdgeHover() {
    if (!edgeHide || edgeHide.revealed || !tauri.window?.cursorPosition) return;
    try {
      const cursor = await tauri.window.cursorPosition();
      const { hidden, size } = edgeHide;
      const inside =
        cursor.x >= hidden.x &&
        cursor.x <= hidden.x + size.width &&
        cursor.y >= hidden.y &&
        cursor.y <= hidden.y + size.height;
      if (!edgeHide.armed) {
        // 刚收起时鼠标可能还停在窄边上，先移开一次再允许悬停唤出
        if (!inside) edgeHide.armed = true;
        return;
      }
      if (inside) {
        if (!edgeRevealTimer) {
          edgeRevealTimer = setTimeout(revealEdgeHide, EDGE_REVEAL_MS);
        }
      } else if (edgeRevealTimer) {
        clearTimeout(edgeRevealTimer);
        edgeRevealTimer = null;
      }
    } catch (err) {
      /* ignore */
    }
  }

  async function handleMoveSettled() {
    if (!win || settingsOpen || edgeAnimating) return;
    if (edgeHide) {
      let pos;
      let size;
      try {
        pos = await win.outerPosition();
        size = await win.outerSize();
      } catch (err) {
        return;
      }
      const r = edgeHide.rect;
      if (!edgeHide.revealed) {
        // 收起状态下只要仍贴着该边缘（含系统在松开鼠标时把窗口放回原位），就重新收起
        let dist = 0;
        if (edgeHide.edge === "left") dist = pos.x - r.x;
        else if (edgeHide.edge === "right") dist = r.x + r.w - (pos.x + size.width);
        else if (edgeHide.edge === "top") dist = pos.y - r.y;
        else dist = r.y + r.h - (pos.y + size.height);
        if (dist <= 60) {
          await animateWindowTo(edgeHide.hidden.x, edgeHide.hidden.y, EDGE_HIDE_ANIM_MS);
          return;
        }
        clearEdgeHide();
        return handleMoveSettled();
      }
      // 唤出状态下：程序化移动忽略，用户拖动则退出隐藏模式
      const moved = Math.abs(pos.x - edgeHide.shown.x) + Math.abs(pos.y - edgeHide.shown.y);
      if (moved <= 4) return;
      clearEdgeHide();
      return handleMoveSettled();
    }
    let pos;
    let size;
    let monitors;
    try {
      pos = await win.outerPosition();
      size = await win.outerSize();
      monitors = await monitorList();
    } catch (err) {
      return;
    }
    const r = pickMonitor(pos, size, monitors);
    if (!r) {
      await snapWindowToEdges();
      return;
    }

    // 拖到上边缘并保持 2 秒：向上隐藏
    if (pointerDown && pos.y <= r.y + 8) {
      if (!topDwellSince) {
        topDwellSince = Date.now();
        clearTimeout(topDwellTimer);
        topDwellTimer = setTimeout(async () => {
          if (!pointerDown || edgeHide) return;
          try {
            const p = await win.outerPosition();
            const s = await win.outerSize();
            const rr = pickMonitor(p, s, await monitorList());
            if (rr && p.y <= rr.y + 8) await enterEdgeHide("top", rr, p, s);
          } catch (err) {
            /* ignore */
          }
        }, TOP_DWELL_MS);
      }
      return;
    }
    topDwellSince = 0;
    clearTimeout(topDwellTimer);

    // 超过 1/3 移出所有显示器：向最近的侧边 / 底边隐藏
    if (visibleRatio(pos, size, monitors) < 2 / 3) {
      const over = {
        left: r.x - pos.x,
        right: pos.x + size.width - (r.x + r.w),
        bottom: pos.y + size.height - (r.y + r.h),
      };
      let edge = "";
      let max = 0;
      for (const key of ["left", "right", "bottom"]) {
        if (over[key] > max) {
          max = over[key];
          edge = key;
        }
      }
      if (edge) {
        await enterEdgeHide(edge, r, pos, size);
        return;
      }
    }
    await snapWindowToEdges();
  }

  async function restorePosition() {
    const rect = await getWindowRect();
    const avail = screenBounds();
    const storedX = Number(state.settings.x);
    const storedY = Number(state.settings.y);
    let x = Number.isFinite(storedX) ? storedX : avail.left + 40;
    let y = Number.isFinite(storedY) ? storedY : avail.top + 40;
    x = clamp(x, avail.left, Math.max(avail.left, avail.right - rect.w));
    y = clamp(y, avail.top, Math.max(avail.top, avail.bottom - rect.h));
    await setWindowPos(x, y);
    state.settings.x = Math.round(x);
    state.settings.y = Math.round(y);
  }

  function scheduleLayout() {
    layoutChain = layoutChain.then(() => doLayout()).catch((err) => console.error(err));
    return layoutChain;
  }

  async function doLayout() {
    if (settingsOpen || edgeHide) return;

    const calendarOn = !!state.settings.calendar;
    const minimalOn = !calendarOn && !!state.settings.minimal;
    document.body.classList.toggle("calendar-mode", calendarOn);
    document.body.classList.toggle("minimal-mode", minimalOn);
    document.body.classList.toggle("weather-open", !calendarOn && !!state.settings.weather_open);
    els.calendarCard.hidden = !calendarOn;
    els.weatherCard.hidden = calendarOn || !state.settings.weather_open;
    updateWeatherPillState();

    if (calendarOn) {
      // 单页布局：左待办、右日历，天气在日期格内，不再有独立的天气卡片
      els.todoList.style.height = "";
      els.todoList.style.overflowY = "";
      renderCalendar();
      await nextFrame();
      const avail = screenBounds();
      const width = Math.min(MARGIN * 2 + CAL_TODO_W + CAL_W, avail.right - avail.left);
      const height = Math.min(MARGIN * 2 + CAL_H, avail.bottom - avail.top);
      await setWindowSize(width, height);
      await clampWindowPosition();
      return;
    }

    els.todoList.style.height = "auto";
    els.todoList.style.overflowY = "hidden";
    void els.todoList.offsetHeight;

    const maxList = 300;
    const contentH = els.todoList.scrollHeight;
    const listH = Math.min(contentH, maxList);
    els.todoList.style.height = `${listH}px`;
    els.todoList.style.overflowY = contentH > maxList + 1 ? "auto" : "hidden";
    void els.todoList.offsetHeight;

    const todoRect = els.todoCard.getBoundingClientRect();
    const todoW = todoRect.width;
    // 极简模式下卡片可以收得更短，添加行紧跟在最后一条待办后面
    const minCardH = minimalOn ? 120 : 300;
    let topH = Math.max(todoRect.height, minCardH);

    if (state.settings.weather_open) {
      const prevAlign = els.weatherCard.style.alignSelf;
      els.weatherCard.style.alignSelf = "flex-start";
      void els.weatherCard.offsetHeight;
      const wcH = els.weatherCard.getBoundingClientRect().height;
      els.weatherCard.style.alignSelf = prevAlign;
      topH = Math.max(topH, wcH, 300);
    }

    const width = MARGIN * 2 + todoW + (state.settings.weather_open ? GAP + WEATHER_W : 0);
    const height = MARGIN * 2 + topH;
    await setWindowSize(width, height);
    await clampWindowPosition();
  }

  /* -------------------------------------------------------- appearance */
  function applyAppearance() {
    const s = state.settings;
    els.app.style.setProperty("--op", String(s.opacity));
    applyGlassColor(normalizeHex(s.bg_color, DEFAULT_SETTINGS.bg_color));
    document.documentElement.style.setProperty(
      "--font",
      FONT_STACKS[s.font_family] || FONT_STACKS.default
    );
    document.documentElement.style.setProperty(
      "--text",
      normalizeHex(s.font_color, DEFAULT_SETTINGS.font_color)
    );

    // 背景图填充到卡片内部，外层画布保持透明
    const hasBg = !!s.bg_image;
    const url = hasBg ? String(toFileUrl(s.bg_image)).replace(/"/g, "%22") : "";
    els.app.classList.toggle("has-bg", hasBg);
    els.app.style.setProperty("--card-image", hasBg ? `url("${url}")` : "none");
    els.bgPreview.style.backgroundImage = hasBg ? `url("${url}")` : "none";
    els.bgImage.style.backgroundImage = "none";

    const mode = s.bg_mode || "fill";
    els.app.style.setProperty(
      "--card-size",
      mode === "stretch" ? "100% 100%" : mode === "tile" ? "auto" : "cover"
    );
    els.app.style.setProperty("--card-repeat", mode === "tile" ? "repeat" : "no-repeat");

    els.bgModes.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }

  function syncSettingsUi() {
    const s = state.settings;
    const transparency = Math.round(transparencyFromOpacity(s.opacity) * 100);
    els.opacityRange.value = String(transparency);
    els.opacityRange.style.setProperty("--fill", `${transparency}%`);
    els.opacityValue.textContent = `${transparency}%`;
    els.calendarSwitch.classList.toggle("on", !!s.calendar);
    els.calendarSwitch.setAttribute("aria-checked", String(!!s.calendar));
    els.topSwitch.classList.toggle("on", !!s.always_on_top);
    els.topSwitch.setAttribute("aria-checked", String(!!s.always_on_top));
    setSwitch(els.minimalSwitch, !!s.minimal);
    setSwitch(els.autostartSwitch, !!s.autostart);
    setSwitch(els.taskbarSwitch, !!s.hide_taskbar);
    const color = normalizeHex(s.bg_color, DEFAULT_SETTINGS.bg_color);
    if (document.activeElement !== els.bgColor) els.bgColor.value = color;
    els.colorRow.querySelectorAll(".swatch").forEach((btn) => {
      btn.classList.toggle("active", String(btn.dataset.color).toLowerCase() === color);
    });
    els.fontSelect.value = FONT_STACKS[s.font_family] ? s.font_family : "default";
    const fontColor = normalizeHex(s.font_color, DEFAULT_SETTINGS.font_color);
    if (document.activeElement !== els.fontColor) els.fontColor.value = fontColor;
    els.fontColorRow.querySelectorAll(".swatch").forEach((btn) => {
      btn.classList.toggle("active", String(btn.dataset.color).toLowerCase() === fontColor);
    });
    if (document.activeElement !== els.cityInput) els.cityInput.value = s.city || "";
    if (document.activeElement !== els.weatherApiInput) {
      els.weatherApiInput.value = s.weather_api || "";
    }
    els.bgPreview.hidden = !s.bg_image;
  }

  /* ------------------------------------------------------------ todos */
  function markerHtml(status) {
    if (status === "overdue") return '<span class="mark-overdue" title="已超时"></span>';
    if (status === "soon") return '<span class="mark-soon" title="即将到期"></span>';
    if (status === "done") return '<span class="mark-done"></span>';
    return '<span class="mark-dot"></span>';
  }

  function renderTodos() {
    // 正在输入新待办时保留输入框，避免后台刷新把它清空
    if (!addEditing) {
      els.addRow.classList.remove("editing");
      els.addRow.innerHTML = DEFAULT_BODY();
    }

    // 已完成的事项不再显示在待办清单里（仍保留在数据与导出中）
    const list = sortTodos(state.todos).filter((todo) => !todo.done);
    els.todoList.innerHTML = "";

    if (!list.length) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.innerHTML = state.todos.length
        ? "全部完成<div class=\"sub\">已完成的事项不再显示，点击下方「添加待办」继续记录</div>"
        : "暂无待办<div class=\"sub\">点击空白处或下方「添加待办」开始记录</div>";
      els.todoList.appendChild(hint);
    }

    for (const todo of list) {
      els.todoList.appendChild(buildRow(todo));
    }

    const remaining = list.filter((todo) => !todo.done).length;
    els.count.textContent = list.length ? `${remaining} 项` : "";
    renderCalendar();
  }

  function buildRow(todo) {
    const row = document.createElement("div");
    const status = dueState(todo);
    row.className =
      "todo-row" +
      (todo.done ? " done" : "") +
      (status === "overdue" ? " overdue" : "");
    row.dataset.id = todo.id;

    const mark = document.createElement("span");
    mark.className = `status ${status}`;
    mark.innerHTML = markerHtml(status);

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = todo.text;

    const due = document.createElement("span");
    due.className = "due-label";
    due.textContent = dueText(todo);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML =
      `<button class="act-btn done" data-act="done" title="${todo.done ? "取消完成" : "标记完成"}">${ICON.check}</button>` +
      `<button class="act-btn pin${todo.pinned ? " on" : ""}" data-act="pin" title="${todo.pinned ? "取消置顶" : "置顶"}">${ICON.pin}</button>` +
      `<button class="act-btn due${todo.due ? " on" : ""}" data-act="due" title="设置结束时间">${ICON.clock}</button>` +
      `<button class="act-btn del" data-act="del" title="删除">${ICON.trash}</button>`;

    row.append(mark, text);
    if (todo.source) {
      const tag = document.createElement("span");
      tag.className = "ai-tag";
      tag.textContent = aiProviderLabel(todo);
      tag.title = `由 ${todo.source} 添加`;
      row.append(tag);
    }
    row.append(due, actions);
    return row;
  }

  function updateRowStates() {
    const now = new Date();
    for (const row of els.todoList.querySelectorAll(".todo-row")) {
      const todo = state.todos.find((item) => item.id === row.dataset.id);
      if (!todo) continue;
      const status = dueState(todo);
      row.classList.toggle("done", !!todo.done);
      row.classList.toggle("overdue", status === "overdue");
      const mark = row.querySelector(".status");
      if (mark) {
        mark.className = `status ${status}`;
        mark.innerHTML = markerHtml(status);
      }
      const due = row.querySelector(".due-label");
      if (due) due.textContent = dueText(todo);
      const pinBtn = row.querySelector('.act-btn.pin');
      if (pinBtn) pinBtn.classList.toggle("on", !!todo.pinned);
    }
    if (now.toDateString() !== lastDay) {
      lastDay = now.toDateString();
      renderCalendar();
    }
  }

  function findTodo(id) {
    return state.todos.find((todo) => todo.id === id) || null;
  }

  function addTodo(text, options = {}) {
    const todo = createTodo({
      id: crypto.randomUUID(),
      text,
      due: options.due,
      start: options.start,
    });
    if (!todo) return null;
    state.todos.push(todo);
    commitTodos({ scrollBottom: true });
    return todo;
  }

  /* --------------------------------------------------------- AI 接入 */
  let aiPullBusy = false;
  let aiPullFailures = 0;
  let aiNextAttempt = 0;

  function aiProviderLabel(todo) {
    const key = String(todo.provider || "").trim().toLowerCase();
    return AI_PROVIDER_LABELS[key] || todo.source || "AI";
  }

  // 外部 MCP / CLI 把待办写入 ai-inbox；桌面端每秒合并一次。
  // 同一 id 只加一次；失败时指数退避，避免磁盘异常时每秒刷 IPC。
  async function pullAiTodos() {
    if (aiPullBusy || Date.now() < aiNextAttempt) return;
    aiPullBusy = true;
    try {
      const items = await invoke("drain_ai_todos");
      if (!Array.isArray(items) || !items.length) {
        aiPullFailures = 0;
        aiNextAttempt = 0;
        return;
      }
      let added = 0;
      for (const item of items) {
        const text = String(item && item.text ? item.text : "").trim();
        const id = String(item && item.id ? item.id : "");
        if (!text || !id) continue;
        if (state.todos.some((todo) => todo.id === id)) continue;
        state.todos.push({
          id,
          text,
          done: false,
          done_at: null,
          pinned: !!item.pinned,
          due: item.due || null,
          start: null,
          created: item.created || new Date().toISOString(),
          source: String(item.source || ""),
          provider: String(item.provider || ""),
        });
        added += 1;
      }
      aiPullFailures = 0;
      aiNextAttempt = 0;
      if (added) commitTodos({ scrollBottom: true });
    } catch (err) {
      aiPullFailures += 1;
      if (aiPullFailures === 1) console.warn("drain_ai_todos failed", err);
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(aiPullFailures - 1, 5)));
      aiNextAttempt = Date.now() + delay;
    } finally {
      aiPullBusy = false;
    }
  }

  function deleteTodo(id) {
    state.todos = state.todos.filter((todo) => todo.id !== id);
    commitTodos();
  }

  function toggleDone(id) {
    const index = state.todos.findIndex((todo) => todo.id === id);
    if (index < 0 || state.todos[index].done) return;
    state.todos[index] = applyDone(state.todos[index], true);
    commitTodos();
  }

  function togglePin(id) {
    const todo = findTodo(id);
    if (!todo) return;
    todo.pinned = !todo.pinned;
    commitTodos();
  }

  /* ------------------------------------------------------ inline edit */
  function startEdit(row, todo) {
    if (row.querySelector(".edit-input")) return;
    const text = row.querySelector(".text");
    if (!text) return;

    const input = document.createElement("input");
    input.className = "edit-input";
    input.type = "text";
    input.value = todo.text;
    input.spellcheck = false;

    text.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      const changed = commit && value && value !== todo.text;
      if (changed) todo.text = value;
      if (changed) {
        commitTodos();
      } else {
        renderTodos();
        scheduleLayout();
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function startAdd() {
    if (addEditing) return;
    addEditing = true;
    els.addRow.classList.add("editing");
    els.addRow.innerHTML =
      `<span class="add-input-wrap"><input class="add-input" type="text" spellcheck="false" placeholder="输入待办内容，回车添加"></span>` +
      `<button class="add-clock" title="设置结束时间" aria-label="设置结束时间">${ICON.clock}</button>`;

    const input = els.addRow.querySelector(".add-input");
    const clock = els.addRow.querySelector(".add-clock");
    input.focus();

    let finished = false;
    let created = null;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      addEditing = false;
      els.addRow.classList.remove("editing");
      const value = input.value.trim();
      els.addRow.innerHTML = DEFAULT_BODY();
      if (commit && value) created = addTodo(value);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));

    // 时钟按钮：先把已输入的内容加为待办，再打开该条目的时间配置
    clock.addEventListener("mousedown", (event) => event.preventDefault());
    clock.addEventListener("click", () => {
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      finish(true);
      if (!created) return;
      const row = els.todoList.querySelector(`.todo-row[data-id="${created.id}"]`);
      if (row) openDuePopover(row, created);
    });
  }

  /* -------------------------------------------------------- due popup */
  function openDuePopover(row, todo) {
    dueTodoId = todo.id;
    const due = parseDue(todo);
    if (due) {
      els.dueDate.value = ymd(due);
      els.dueTime.value = hm(due);
    } else {
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      els.dueDate.value = ymd(soon);
      els.dueTime.value = hm(soon);
    }

    els.duePopover.hidden = false;
    const appRect = els.app.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const popW = 252;
    const popH = els.duePopover.offsetHeight || 168;

    let x = rowRect.right - appRect.left - popW;
    x = clamp(x, 8, Math.max(8, appRect.width - popW - 8));
    let y = rowRect.bottom - appRect.top + 6;
    if (y + popH > appRect.height - 8) {
      y = rowRect.top - appRect.top - popH - 6;
    }
    y = clamp(y, 8, Math.max(8, appRect.height - popH - 8));

    els.duePopover.style.left = `${x}px`;
    els.duePopover.style.top = `${y}px`;
  }

  function closeDuePopover() {
    els.duePopover.hidden = true;
    dueTodoId = null;
  }

  function commitDue() {
    if (!dueTodoId) return;
    const todo = findTodo(dueTodoId);
    if (!todo) {
      closeDuePopover();
      return;
    }
    if (!els.dueDate.value) {
      todo.due = null;
    } else {
      const time = els.dueTime.value || "09:00";
      todo.due = `${els.dueDate.value}T${time}`;
    }
    closeDuePopover();
    commitTodos();
  }

  function clearDue() {
    if (!dueTodoId) return;
    const todo = findTodo(dueTodoId);
    if (todo) {
      todo.due = null;
    }
    closeDuePopover();
    commitTodos();
  }

  /* ------------------------------------------------------- calendar add */
  function updateCalAddHint() {
    if (!calAddDue) {
      els.calAddHint.textContent = "未设置截止时间 · 回车添加";
      return;
    }
    const dueLabel =
      ymd(calAddDue) === calAddKey
        ? hm(calAddDue)
        : `${calAddDue.getMonth() + 1}月${calAddDue.getDate()}日 ${hm(calAddDue)}`;
    els.calAddHint.textContent = `截止 ${dueLabel} · 回车添加`;
  }

  function syncCalAddTimeInputs() {
    if (!calAddDue) return;
    els.calAddDate.value = ymd(calAddDue);
    els.calAddTimeValue.value = hm(calAddDue);
  }

  function clampCalAdd() {
    if (els.calAddPopover.hidden) return;
    const appRect = els.app.getBoundingClientRect();
    const popH = els.calAddPopover.offsetHeight || 140;
    const top = parseFloat(els.calAddPopover.style.top) || 0;
    els.calAddPopover.style.top =
      `${clamp(top, 8, Math.max(8, appRect.height - popH - 8))}px`;
  }

  function toggleCalAddTime(show) {
    const open = typeof show === "boolean" ? show : els.calAddTime.hidden;
    els.calAddTime.hidden = !open;
    els.calAddClock.classList.toggle("active", open);
    if (open) syncCalAddTimeInputs();
    // 展开时间行后弹框变高，重新限制在窗口内
    requestAnimationFrame(clampCalAdd);
  }

  function applyCalAddTime() {
    const dateValue = els.calAddDate.value;
    const timeValue = els.calAddTimeValue.value;
    if (!dateValue || !timeValue) return;
    const next = new Date(`${dateValue}T${timeValue}`);
    if (Number.isNaN(next.getTime())) return;
    calAddDue = next;
    updateCalAddHint();
  }

  function openCalAdd(cell) {
    const key = cell.dataset.date;
    if (!key) return;
    hideCalInfo();
    closeDuePopover();

    const [yy, mm, dd] = key.split("-").map(Number);
    const date = new Date(yy, mm - 1, dd);
    const now = new Date();

    // 默认当天 18:00 截止；若今天已过 18:00，则顺延到下一个整点
    let due = new Date(yy, mm - 1, dd, 18, 0, 0, 0);
    if (due.getTime() <= now.getTime() && key === ymd(now)) {
      due = new Date(now.getTime() + 60 * 60 * 1000);
      due.setMinutes(0, 0, 0);
    }

    calAddKey = key;
    calAddDue = due;
    els.calAddTitle.textContent = `${mm}月${dd}日 ${WEEK[date.getDay()]}`;
    updateCalAddHint();
    els.calAddInput.value = "";
    toggleCalAddTime(false);
    syncCalAddTimeInputs();
    els.calAddPopover.hidden = false;

    const appRect = els.app.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const popW = els.calAddPopover.offsetWidth || 260;
    const popH = els.calAddPopover.offsetHeight || 140;
    let x = cellRect.left - appRect.left;
    if (x + popW > appRect.width - 8) x = cellRect.right - appRect.left - popW;
    x = clamp(x, 8, Math.max(8, appRect.width - popW - 8));
    let y = cellRect.bottom - appRect.top + 6;
    if (y + popH > appRect.height - 8) y = cellRect.top - appRect.top - popH - 6;
    y = clamp(y, 8, Math.max(8, appRect.height - popH - 8));
    els.calAddPopover.style.left = `${x}px`;
    els.calAddPopover.style.top = `${y}px`;

    els.calAddInput.focus();
  }

  function closeCalAdd() {
    els.calAddPopover.hidden = true;
    toggleCalAddTime(false);
    calAddKey = null;
    calAddDue = null;
  }

  function submitCalAdd() {
    const value = els.calAddInput.value;
    if (!value.trim()) {
      els.calAddInput.focus();
      return;
    }
    const due = calAddDue ? `${ymd(calAddDue)}T${hm(calAddDue)}` : null;
    // 从日历里新建的事项视为当天的整天事项，横条只覆盖这一天
    const start = calAddKey ? `${calAddKey}T09:00` : null;
    closeCalAdd();
    addTodo(value, { due, start });
  }

  /* ----------------------------------------------------------- weather */
  /**
   * 定位失败时在设置面板里给出明确提示，并把光标放到输入框，
   * 让用户可以直接手输城市（而不是只有天气卡底部一行小字）。
   */
  function setLocateHint(message) {
    if (!els.locateHint) return;
    els.locateHint.textContent = message || "";
    els.locateHint.hidden = !message;
    if (message) {
      els.locateHint.classList.add("warn");
      if (els.cityInput) els.cityInput.focus();
    } else {
      els.locateHint.classList.remove("warn");
    }
  }

  function setWcStatus(message) {
    els.wcStatus.textContent = message || "";
  }

  async function geocodeCity(city) {
    // 统一走 Rust 代发，避免受渲染进程 CSP 限制；超时由 Rust 侧控制
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    const geo = await invoke("fetch_json", { url: geoUrl });
    const first = geo && geo.results && geo.results[0];
    if (!first) throw new Error(`找不到城市「${city}」`);
    return first;
  }

  function fillWeatherUrl(template, s) {
    return template
      .replace(/\{city\}/g, encodeURIComponent((s.city || "").trim()))
      .replace(/\{lat\}/g, s.latitude == null ? "" : String(s.latitude))
      .replace(/\{lon\}/g, s.longitude == null ? "" : String(s.longitude));
  }

  /** 失败后按 30s 起步退避重试，最长 10min；成功即复位。断网恢复后无需等 30min 定时器。 */
  function scheduleWeatherRetry() {
    clearTimeout(weatherRetryTimer);
    const delay = Math.min(
      WEATHER_RETRY_MAX_MS,
      WEATHER_RETRY_MS * Math.pow(2, Math.max(0, weatherFailed - 1))
    );
    weatherRetryTimer = setTimeout(() => {
      weatherRetryTimer = null;
      if (state.settings.weather_open || !state.weather) refreshWeather();
    }, delay);
  }

  async function refreshWeather() {
    if (weatherBusy) return;
    const s = state.settings;
    weatherBusy = true;
    try {
      const custom = String(s.weather_api || "").trim();
      const city = (s.city || "").trim();
      const needsGeo = !custom || /\{lat\}|\{lon\}/.test(custom);
      if (needsGeo) {
        // 已有坐标（定位得到的）时不需要城市名，城市名稍后由反查补上
        const hasCoords = s.latitude != null && s.longitude != null;
        if (!city && !hasCoords) throw new Error("请先在设置中填写城市");
        if (!hasCoords) {
          const first = await geocodeCity(city);
          s.latitude = first.latitude;
          s.longitude = first.longitude;
          if (first.name) s.city = first.name;
        }
      }

      const url = custom
        ? fillWeatherUrl(custom, s)
        : `https://api.open-meteo.com/v1/forecast?latitude=${s.latitude}&longitude=${s.longitude}` +
          `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`;

      state.weather = await window.WeatherAPI.load(
        url,
        { city: s.city, lat: s.latitude, lon: s.longitude },
        (target) => invoke("fetch_json", { url: target })
      );
      networkOk = true;
      weatherFailed = 0;
      clearTimeout(weatherRetryTimer);
      weatherRetryTimer = null;
      setWcStatus("");
      save();
      renderWeatherCard();
      renderWeatherPill();
      renderCalendar();
    } catch (err) {
      // 只有真正的网络层失败才视为「不可联网」，城市不存在、HTTP 4xx 等业务错误
      // 不影响悬停信息，也不该无限重试。
      // 请求统一走 Rust fetch_json，网络类错误由 Rust 打上 NET_ERR 前缀；
      // 保留原生 fetch 的错误类型判断，兼容浏览器侧调用。
      const text = (err && (err.message || String(err))) || "";
      const isNetwork =
        !!err &&
        (err.name === "TimeoutError" ||
          err.name === "TypeError" ||
          text.startsWith("NET_ERR:"));
      if (isNetwork) networkOk = false;
      weatherFailed += 1;
      console.warn("weather failed", err);
      // 去掉内部前缀再展示给用户
      const clean = text.replace(/^NET_ERR:/, "");
      const message = clean || "网络连接失败";
      setWcStatus(message);
      // 网络类失败自动退避重试；业务错误不重试（重试也会同样失败）
      if (isNetwork) scheduleWeatherRetry();
    } finally {
      weatherBusy = false;
    }
  }

  function renderWeatherCard() {
    const data = state.weather;
    if (!data) {
      els.wcTemp.textContent = "--°";
      els.wcCond.textContent = "获取中…";
      els.wcHilo.textContent = "";
      els.wcExtra.textContent = "";
      els.wcCity.textContent = state.settings.city || "定位中…";
      els.wcIcon.innerHTML = "";
      els.forecast.innerHTML = "";
      return;
    }
    const current = data.current || {};
    const info = wmoInfo(current.code);
    els.wcCity.textContent = data.city || state.settings.city || "定位中…";
    els.wcIcon.innerHTML = wxIcon(info.kind, 42);
    els.wcTemp.textContent = `${current.temp ?? "--"}°`;
    els.wcCond.textContent = info.text;
    els.wcExtra.textContent = `湿度 ${current.humidity ?? "--"}%  ·  风速 ${current.wind ?? "--"} km/h`;

    const today = data.daily && data.daily[0];
    els.wcHilo.textContent = today ? `最高 ${today.hi}°  /  最低 ${today.lo}°` : "";

    const days = data.daily || [];
    const lows = days.map((day) => day.lo);
    const highs = days.map((day) => day.hi);
    const min = Math.min(...lows, ...highs);
    const max = Math.max(...lows, ...highs);
    const span = Math.max(1, max - min);

    els.forecast.innerHTML = "";
    days.forEach((day, index) => {
      const date = new Date(`${day.date}T12:00:00`);
      const row = document.createElement("div");
      row.className = "fc-row";

      const label = document.createElement("span");
      label.className = "fc-day";
      if (index === 0) label.textContent = "今天";
      else if (index === 1) label.textContent = "明天";
      else label.textContent = WEEK[date.getDay()];

      const icon = document.createElement("span");
      icon.className = "fc-icon";
      icon.innerHTML = wxIcon(wmoInfo(day.code).kind, 16);

      const bar = document.createElement("span");
      bar.className = "fc-bar";
      const fill = document.createElement("span");
      fill.style.left = `${((day.lo - min) / span) * 100}%`;
      fill.style.width = `${Math.max(12, ((day.hi - day.lo) / span) * 100)}%`;
      bar.appendChild(fill);

      const range = document.createElement("span");
      range.className = "fc-range";
      range.textContent = `${day.lo}° / ${day.hi}°`;

      row.append(label, icon, bar, range);
      els.forecast.appendChild(row);
    });
  }

  function renderWeatherPill() {
    const data = state.weather;
    if (!data || !data.current) {
      els.pillIcon.innerHTML = wxIcon("suncloud", 15);
      els.pillText.textContent = "--°";
      return;
    }
    const info = wmoInfo(data.current.code);
    els.pillIcon.innerHTML = wxIcon(info.kind, 15);
    els.pillText.textContent = `${data.current.temp}°`;
    els.weatherPill.title = `${data.city || state.settings.city} · 点击显示/隐藏天气`;
  }

  function updateWeatherPillState() {
    els.weatherPill.classList.toggle("active", !!state.settings.weather_open);
  }

  async function toggleWeather(force) {
    // 日历模式只有一页，天气以日期格内的图标呈现
    if (state.settings.calendar) return;
    const show = typeof force === "boolean" ? force : !state.settings.weather_open;
    if (show === !!state.settings.weather_open) return;

    const before = await getWindowRect();
    state.settings.weather_open = show;
    els.weatherCard.hidden = !show;
    updateWeatherPillState();

    if (show) {
      const avail = screenBounds();
      const need = WEATHER_W + GAP;
      const rightSpace = avail.right - (before.x + before.w);
      const leftSpace = before.x - avail.left;
      weatherLeft = rightSpace < need && leftSpace >= need;
      if (weatherLeft) els.topRow.insertBefore(els.weatherCard, els.todoCard);
      else els.topRow.appendChild(els.weatherCard);
      renderWeatherCard();
      // 打开卡片时若还没有数据、或上次已失败，就真正拉一次；
      // 只在占位文案上干等会让卡片永久停在「正在获取天气…」。
      if (!state.weather || weatherFailed) {
        setWcStatus("正在获取天气…");
        refreshWeather();
      }
    }

    await scheduleLayout();

    if (show && weatherLeft) {
      await setWindowPos(before.x - (WEATHER_W + GAP), before.y);
    } else if (!show && weatherLeft) {
      await setWindowPos(before.x + (WEATHER_W + GAP), before.y);
    }
    save();
  }

  /* ---------------------------------------------------------- calendar */
  function eventRangeText(start, end) {
    const left = `${start.getMonth() + 1}月${start.getDate()}日 ${hm(start)}`;
    const right = `${end.getMonth() + 1}月${end.getDate()}日 ${hm(end)}`;
    return left === right ? right : `${left} → ${right}`;
  }

  /* ------------------------------------------------ date info on hover */
  /** 用内置 ICU 的中历计算农历，避免引入额外的历法数据。 */
  function lunarText(date) {
    try {
      const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).formatToParts(date);
      const pick = (type) => parts.find((part) => part.type === type)?.value || "";
      const yearName = pick("yearName");
      const monthName = pick("month");
      const day = Number(pick("day"));
      const dayName = LUNAR_DAYS[day - 1];
      if (!monthName || !dayName) return "";
      return `${yearName ? `${yearName}年 ` : ""}${monthName}${dayName}`;
    } catch (err) {
      return "";
    }
  }

  // 节气弹框背景：按节气名生成一张深色渐变 + 季节图案的 SVG
  function solarTermArt(term) {
    if (TERM_BG_CACHE.has(term)) return TERM_BG_CACHE.get(term);
    const index = SOLAR_TERMS.indexOf(term);
    const [deep, mid, light] = TERM_THEME[term] || ["#141c2c", "#3b4d6b", "#cfe0f7"];
    const first = term[0] || "";
    const second = term[1] || "";
    let motif = "";
    if (index < 6) {
      // 春：一株新芽
      motif =
        `<path d="${TERM_SEASON.spring}" fill="${light}" fill-opacity=".16"/>` +
        `<path d="M58 198 C58 166 68 146 88 132" stroke="${light}" stroke-opacity=".28" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    } else if (index < 12) {
      // 夏：一轮暖阳
      motif =
        `<circle cx="74" cy="70" r="24" fill="${light}" fill-opacity=".12"/>` +
        `<circle cx="74" cy="70" r="15" fill="${light}" fill-opacity=".16"/>`;
    } else if (index < 18) {
      // 秋：一片落叶
      motif =
        `<path d="${TERM_SEASON.autumn}" fill="${light}" fill-opacity=".16"/>` +
        `<path d="M52 192 C66 170 80 150 94 132" stroke="${light}" stroke-opacity=".26" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    } else {
      // 冬：雪花
      motif =
        `<g stroke="${light}" stroke-opacity=".26" stroke-width="1.6" stroke-linecap="round">` +
        `<path d="M72 44v36M72 44l-10 9M72 44l10 9M72 80l-10-9M72 80l10-9"/>` +
        `<path d="M54 62h36M54 62l9-10M90 62l-9-10M54 62l9 10M90 62l-9 10"/>` +
        `</g>`;
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="464" height="220" viewBox="0 0 464 220">` +
      `<defs>` +
      `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${deep}"/><stop offset=".58" stop-color="${mid}"/><stop offset="1" stop-color="${deep}"/>` +
      `</linearGradient>` +
      `<radialGradient id="r" cx=".8" cy=".16" r=".78">` +
      `<stop offset="0" stop-color="${light}" stop-opacity=".5"/><stop offset="1" stop-color="${light}" stop-opacity="0"/>` +
      `</radialGradient>` +
      `</defs>` +
      `<rect width="464" height="220" fill="url(#g)"/>` +
      `<rect width="464" height="220" fill="url(#r)"/>` +
      motif +
      `<text x="438" y="96" text-anchor="end" font-family="KaiTi,STKaiti,'Songti SC',serif" font-size="76" fill="${light}" fill-opacity=".2">${first}</text>` +
      `<text x="438" y="188" text-anchor="end" font-family="KaiTi,STKaiti,'Songti SC',serif" font-size="76" fill="${light}" fill-opacity=".2">${second}</text>` +
      `</svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    TERM_BG_CACHE.set(term, url);
    return url;
  }

  /* ------------------------------------------------------ daily quote */
  async function loadQuoteSeed() {
    try {
      const res = await fetch(QUOTE_SEED_URL, { cache: "no-cache" });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.quotes) ? data.quotes : [];
      quoteSeed = list
        .filter((item) => item && typeof item.t === "string" && item.t)
        .map((item) => ({ t: item.t, f: item.f || "佚名" }));
      lastQuoteIndex = -1;
    } catch (err) {
      /* 种子文件缺失时继续用内置短句 */
    }
  }

  function quotePool() {
    if (quoteSeed.length) return quoteSeed;
    return QUOTES.map((item) => ({ t: item.text, f: item.from }));
  }

  function randomQuote() {
    const picked = pickQuote(quotePool(), lastQuoteIndex);
    if (!picked) return null;
    lastQuoteIndex = picked.index;
    const item = picked.item;
    return { text: item.t ?? item.text, from: item.f ?? item.from };
  }

  function hideCalInfo() {
    clearTimeout(cellHoverTimer);
    cellHoverTimer = null;
    cancelInfoHide();
    hoverCell = null;
    infoPinned = false;
    if (els.calInfo) els.calInfo.hidden = true;
  }

  function cancelInfoHide() {
    clearTimeout(infoHideTimer);
    infoHideTimer = null;
  }

  // 色条会盖住日期格，双击时按坐标找回下面的格子
  function cellAtPoint(x, y) {
    if (!els.calGrid) return null;
    const grid = els.calGrid.getBoundingClientRect();
    // 只接受落在日历网格附近的点，避免点到网格外也命中
    if (x < grid.left - 2 || x > grid.right + 2 || y < grid.top - 2 || y > grid.bottom + 2) {
      return null;
    }
    let best = null;
    let bestDist = Infinity;
    for (const cell of els.calGrid.querySelectorAll(".cal-cell")) {
      const rect = cell.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return cell;
      // 日期格之间有 2px 间隙：落在间隙里时取最近的格子
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = cell;
      }
    }
    return best;
  }

  // 鼠标离开日期格后延迟消失；期间若移到弹框上则保留。
  // delay 可覆盖：单击弹出时弹框可能位于光标上方，需要更长的时间让用户移过去。
  function scheduleHideCalInfo(delay = INFO_HIDE_DELAY) {
    cancelInfoHide();
    infoHideTimer = setTimeout(() => {
      infoHideTimer = null;
      hideCalInfo();
    }, delay);
  }

  function showCalInfo(cell, date) {
    // 断网或天气请求已确认失败（例如程序被禁止联网）时不弹框。
    if (navigator.onLine === false || networkOk === false) return;
    if (hoverCell !== cell || !cell.isConnected) return;

    const key = ymd(date);
    const lunar = lunarText(date);
    const holidayName = buildHolidayMap(state.settings.holidays).get(key);
    els.ciLunar.textContent = [holidayName, lunar ? `农历 ${lunar}` : ""]
      .filter(Boolean)
      .join(" · ");

    const term = solarTermOn(date);
    els.calInfo.classList.toggle("has-term", !!term);
    els.calInfo.style.backgroundImage = term ? solarTermArt(term) : "";
    if (term) {
      els.ciTerm.textContent = term;
      els.ciTerm.title = `二十四节气 · ${term}`;
      els.ciTerm.hidden = false;
    } else {
      els.ciTerm.hidden = true;
    }

    const dayWeather = (state.weather?.daily || []).find((item) => item.date === key);
    if (dayWeather) {
      const info = wmoInfo(dayWeather.code);
      els.ciWIcon.innerHTML = wxIcon(info.kind, 13);
      els.ciWText.textContent = `${info[0]}  ${dayWeather.lo}° ~ ${dayWeather.hi}°`;
      els.ciWeather.hidden = false;
    } else {
      els.ciWeather.hidden = true;
    }

    const quote = randomQuote();
    if (quote) {
      els.ciQuoteText.textContent = quote.text;
      els.ciQuoteFrom.textContent = `—— ${quote.from}`;
      els.ciQuote.hidden = false;
    } else {
      els.ciQuote.hidden = true;
    }

    els.calInfo.hidden = false;

    const appRect = els.app.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const infoW = els.calInfo.offsetWidth || 232;
    const infoH = els.calInfo.offsetHeight || 70;
    let x = cellRect.right - appRect.left + 8;
    if (x + infoW > appRect.width - 8) {
      x = cellRect.left - appRect.left - infoW - 8;
    }
    x = clamp(x, 8, Math.max(8, appRect.width - infoW - 8));
    let y = cellRect.top - appRect.top + cellRect.height / 2 - infoH / 2;
    y = clamp(y, 8, Math.max(8, appRect.height - infoH - 8));
    els.calInfo.style.left = `${x}px`;
    els.calInfo.style.top = `${y}px`;
  }

  function holidayConfig(year) {
    const all = state.settings.holidays;
    const cfg = all && typeof all === "object" ? all[year] : null;
    return cfg && Array.isArray(cfg.days) ? cfg : null;
  }

  function ensureHolidays(year, force) {
    if (!force && holidayConfig(year)) return;
    if (holidayBusy.has(year) || holidayFailed.has(year)) return;
    if (navigator.onLine === false) return;
    holidayBusy.add(year);
    (async () => {
      try {
        // 走 Rust 代发：渲染进程 CSP 不允许直连第三方域名
        const data = await invoke("fetch_json", { url: HOLIDAY_URL(year) });
        const days = (Array.isArray(data.days) ? data.days : [])
          .filter((day) => day && typeof day.date === "string" && day.date.startsWith(`${year}-`))
          .map((day) => ({
            date: day.date,
            name: day.name || "节假日",
            off: !!day.isOffDay,
          }));
        if (!days.length) throw new Error("暂无节假日数据");
        state.settings.holidays = {
          ...(state.settings.holidays || {}),
          [year]: { days, fetched: Date.now(), checked: ymd(new Date()) },
        };
        holidayFailed.delete(year);
        save();
        renderCalendar();
      } catch (err) {
        holidayFailed.add(year);
        console.warn("holiday fetch failed", year, err);
      } finally {
        holidayBusy.delete(year);
      }
    })();
  }

  // 启动时缺本年配置就查询；每年 1 月 1 日、12 月 20 日再刷新一次
  function holidayCheckToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const trigger = (month === 0 && day === 1) || (month === 11 && day === 20);
    const cfg = holidayConfig(year);
    if (!cfg) {
      ensureHolidays(year, trigger);
    } else if (trigger && cfg.checked !== ymd(now)) {
      ensureHolidays(year, true);
    }
  }

  function renderCalendar() {
    hideCalInfo();
    const now = new Date();
    if (!monthCursor) monthCursor = { y: now.getFullYear(), m: now.getMonth() };
    const { y, m } = monthCursor;

    els.calTitle.textContent = `${y}年${m + 1}月`;
    if (y >= 2007 && y <= now.getFullYear() + 1) ensureHolidays(y);

    // 事项从创建时间持续到结束时间，日历模型由 domain/calendar.js 计算
    const events = buildEvents(state.todos);

    const weatherByDay = new Map();
    for (const day of state.weather?.daily || []) {
      weatherByDay.set(day.date, day);
    }

    const holidayByDay = buildHolidayMap(state.settings.holidays);
    const model = buildMonthWeeks(y, m, events);
    els.calSub.textContent = model.monthCount ? `${model.monthCount} 项事项` : "";
    const todayKey = ymd(new Date());

    els.calGrid.innerHTML = "";

    for (const weekModel of model.weeks) {
      const { weekStart, segments } = weekModel;
      const week = document.createElement("div");
      week.className = "cal-week";
      week.setAttribute("data-tauri-drag-region", "");

      for (let c = 0; c < 7; c += 1) {
        const date = new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + c
        );
        const key = ymd(date);
        const cell = document.createElement("div");
        cell.className =
          "cal-cell" +
          (date.getMonth() !== m ? " other" : "") +
          (key === todayKey ? " today" : "");
        cell.dataset.date = key;

        const holidayName = holidayByDay.get(key);
        if (holidayName) {
          cell.classList.add("holiday");
          cell.dataset.holiday = holidayName;
          cell.title = holidayName;
          cell.style.setProperty("--hd", holidayTint(holidayName));
        }

        const day = document.createElement("span");
        day.className = "cal-day";
        day.textContent = String(date.getDate());
        cell.appendChild(day);

        const weather = weatherByDay.get(key);
        if (weather) {
          const wIcon = document.createElement("span");
          wIcon.className = "cal-weather";
          wIcon.innerHTML = wxIcon(wmoInfo(weather.code).kind, 15);
          cell.appendChild(wIcon);
        }

        if (holidayName) {
          const hd = document.createElement("span");
          hd.className = "cal-holiday";
          hd.textContent = holidayName;
          cell.appendChild(hd);
        }

        // 日期格不使用原生拖动区域：双击需要可靠触发，拖动改由下方自定义逻辑处理
        week.appendChild(cell);
      }

      paintWeekBands(week, segments, weekStart);
      els.calGrid.appendChild(week);
    }
  }

  // 绘制一周的事项色条；滚轮滚动时只重绘这一周
  function paintWeekBands(week, segments, weekStart) {
    const overlay = document.createElement("div");
    overlay.className = "cal-bars";
    overlay.setAttribute("data-tauri-drag-region", "");

    // 同一周内重叠的事项逐行下排；最多同时显示 MAX_BARS 行
    const weekKey = ymd(weekStart);
    const bands = layoutBands(segments, MAX_BARS, weekScroll.get(weekKey) || 0);
    const laneOffset = bands.offset;
    week.dataset.maxOffset = String(bands.maxOffset);
    if (laneOffset) weekScroll.set(weekKey, laneOffset);
    else weekScroll.delete(weekKey);

    for (const seg of bands.placed) {
      if (seg.lane < laneOffset || seg.lane >= laneOffset + MAX_BARS) continue;

      const bar = document.createElement("div");
      bar.className =
        `cal-bar c${seg.ev.color}` +
        (seg.cutLeft ? " cut-left" : "") +
        (seg.cutRight ? " cut-right" : "") +
        (seg.ev.todo.done ? " done" : "");
      bar.style.setProperty("--col", String(seg.col));
      bar.style.setProperty("--span", String(seg.span));
      bar.style.top = `${18 + (seg.lane - laneOffset) * 11}px`;
      bar.textContent = seg.ev.todo.text;

      const duration = todoDuration(seg.ev.todo, seg.ev.end);
      bar.title =
        `${seg.ev.todo.text}\n${eventRangeText(seg.ev.start, seg.ev.end)}` +
        (duration ? ` · 时长 ${duration}` : "");
      bar.setAttribute("data-tauri-drag-region", "");
      overlay.appendChild(bar);
    }

    // 上面 / 下面还有几条：只标在首行 / 末行色条的末尾日期格，避免每个格子重复
    const addBadge = (col, top, text, kind) => {
      const badge = document.createElement("span");
      badge.className = `cal-bar-badge ${kind}`;
      badge.style.setProperty("--col", String(col));
      badge.style.top = `${top}px`;
      badge.textContent = text;
      overlay.appendChild(badge);
    };
    const top = 18;
    const bottom = 18 + (MAX_BARS - 1) * 11;
    for (const badge of badgePlacements(bands.above, bands.below)) {
      addBadge(badge.col, badge.kind === "above" ? top : bottom, `+${badge.count}`, badge.kind);
    }

    const old = week.querySelector(".cal-bars");
    if (old) old.remove();
    week.appendChild(overlay);
    week._bands = { segments, weekStart };
  }

  /* ---------------------------------------------------------- settings */
  async function openSettings() {
    if (settingsOpen) return;
    hideCalInfo();
    // 打开设置前退出边缘隐藏，避免隐藏状态阻止布局刷新
    if (edgeHide) clearEdgeHide();
    settingsOpen = true;
    syncSettingsUi();
    const rect = await getWindowRect();
    settingsSavedSize = { w: rect.w, h: rect.h };

    if (state.settings.calendar) {
      // 日历模式已是整页布局：设置浮在右侧，只在窗口过窄时补足到不遮挡待办
      const needW = SETTINGS_W + MARGIN * 2 + CAL_TODO_W + GAP;
      if (rect.w < needW) {
        const avail0 = screenBounds();
        const targetW = Math.min(needW, avail0.right - avail0.left - 8);
        await setWindowSize(targetW, rect.h);
        await clampWindowPosition();
      }
      els.settingsOverlay.hidden = false;
      return;
    }

    // 设置以右侧浮动面板展开，窗口加宽，待办卡片保持可见
    const avail = screenBounds();
    const extra = SETTINGS_W + GAP + MARGIN;
    const targetW = Math.min(rect.w + extra, avail.right - avail.left - 8);
    const targetH = Math.min(Math.max(rect.h, SETTINGS_H), avail.bottom - avail.top);
    let targetY = rect.y;
    if (targetY + targetH > avail.bottom) {
      targetY = Math.max(avail.top, avail.bottom - targetH);
    }
    if (targetY !== rect.y) await setWindowPos(rect.x, targetY);
    await setWindowSize(targetW, targetH);
    await clampWindowPosition();

    els.settingsOverlay.hidden = false;
  }

  async function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    els.settingsOverlay.hidden = true;
    if (settingsSavedSize) {
      const rect = await getWindowRect();
      const avail = screenBounds();
      if (rect.y + settingsSavedSize.h <= avail.bottom) {
        // keep top-left, shrink back to content size below
      }
      settingsSavedSize = null;
    }
    await scheduleLayout();
    await savePosition();
  }

  function setSwitch(el, on) {
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", String(!!on));
  }

  async function toggleCalendarMode() {
    state.settings.calendar = !state.settings.calendar;
    // 两种模式互斥：打开日历就退出极简
    if (state.settings.calendar) state.settings.minimal = false;
    setSwitch(els.calendarSwitch, state.settings.calendar);
    setSwitch(els.minimalSwitch, state.settings.minimal);
    // 设置面板打开时先不改主界面，关闭设置后由 doLayout 一次性应用
    if (!settingsOpen) {
      document.body.classList.toggle("calendar-mode", state.settings.calendar);
      document.body.classList.toggle(
        "minimal-mode",
        !state.settings.calendar && state.settings.minimal
      );
    }
    await commitTodos({ layout: !settingsOpen });
  }

  async function toggleAlwaysOnTop() {
    state.settings.always_on_top = !state.settings.always_on_top;
    setSwitch(els.topSwitch, state.settings.always_on_top);
    try {
      if (win) await win.setAlwaysOnTop(!!state.settings.always_on_top);
    } catch (err) {
      console.warn(err);
    }
    save();
  }

  // 导出最近 30 天已完成事项：创建时间，完成时间，事项内容
  async function exportRecentDone() {
    const content = buildExportText(state.todos, Date.now(), 30);
    const btn = els.exportBtn;
    const reset = () => setTimeout(() => (btn.textContent = "导出"), 1500);

    if (!content) {
      btn.textContent = "暂无记录";
      reset();
      return;
    }

    const name = `近期待办-${ymd(new Date())}.txt`;

    try {
      const saved = await invoke("export_text", { defaultName: name, content });
      if (saved) {
        btn.textContent = "已导出";
        reset();
      }
    } catch (err) {
      console.warn("export failed", err);
      btn.textContent = "导出失败";
      reset();
    }
  }

  async function changeCity() {
    const value = els.cityInput.value.trim();
    if (!value || value === state.settings.city) return;
    state.settings.city = value;
    state.settings.latitude = null;
    state.settings.longitude = null;
    state.weather = null;
    setLocateHint(""); // 用户已手动指定城市，定位失败的提示不再需要
    save();
    setWcStatus("正在获取天气…");
    updateWeatherPillState();
    if (state.settings.weather_open) renderWeatherCard();
    await refreshWeather();
  }

  /**
   * 定位。优先用 IP 定位：一次请求同时拿到城市名和经纬度，
   * 不需要「先 GPS 授权、再反查城市名」两跳，也不依赖长期不可靠的逆地理编码。
   * 拿到 IP 结果后，若浏览器支持定位且在授权中，再尝试用 GPS 提升精度。
   */
  function locate() {
    const applyCity = (name) => {
      state.settings.city = name;
      els.cityInput.value = name;
      if (state.weather) state.weather.city = name;
      save();
      if (state.settings.weather_open) renderWeatherCard();
      renderWeatherPill();
      setLocateHint("");
    };

    setWcStatus("正在定位…");
    setLocateHint("");
    els.cityInput.value = "定位中…";

    (async () => {
      // 1) 依次尝试多个 IP 定位服务，任一成功即可
      for (const source of window.WeatherAPI.IP_LOCATE_SOURCES) {
        try {
          const data = await invoke("fetch_json", { url: source.url });
          const name = String(source.city(data) || "").trim();
          const [rawLat, rawLon] = source.coords(data);
          const coords = window.WeatherAPI.pickCoords({ latitude: rawLat, longitude: rawLon });
          if (name && coords) {
            state.settings.latitude = coords.lat;
            state.settings.longitude = coords.lon;
            applyCity(name);
            setWcStatus("");
            refreshWeather();
            // 2) GPS 仅用于提升坐标精度，失败不影响已有结果
            refineWithGps();
            return;
          }
        } catch (err) {
          console.warn(`ip locate failed (${source.name})`, err);
        }
      }
      // 3) 所有 IP 服务都失败 → 退回 GPS
      useGps();
    })();
  }

  /** 用 GPS 提升坐标精度。已有城市名时只更新坐标，不改城市名。 */
  function refineWithGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // 坐标变化很小就不必重拉天气
        if (
          Math.abs(Number(state.settings.latitude) - lat) < 0.01 &&
          Math.abs(Number(state.settings.longitude) - lon) < 0.01
        ) {
          return;
        }
        state.settings.latitude = lat;
        state.settings.longitude = lon;
        save();
        refreshWeather();
      },
      () => {
        /* GPS 只是精度补充，失败静默忽略 */
      },
      { timeout: 8000, maximumAge: 600000 }
    );
  }

  /** IP 定位不可用时退回：GPS 拿坐标，再反查城市名。 */
  function useGps() {
    const fail = (msg) => {
      setWcStatus(msg);
      setLocateHint(msg + "。可在下方直接输入城市名，或检查 Windows「设置 → 隐私和安全性 → 定位」是否已开启。");
      els.cityInput.value = state.settings.city || "";
    };
    if (!navigator.geolocation) {
      fail("当前环境不支持定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        state.settings.latitude = lat;
        state.settings.longitude = lon;
        save();
        if (state.settings.weather_open) renderWeatherCard();
        refreshWeather();
        resolveCityName(lat, lon);
      },
      (err) => {
        console.warn(err);
        fail("定位失败");
      },
      { timeout: 8000, maximumAge: 600000 }
    );
  }

  /**
   * 根据定位坐标反查城市名，避免天气卡片只显示「当前位置」。
   * 依次尝试多个逆地理编码服务（BigDataCloud 优先，nominatim 兜底）。
   */
  async function resolveCityName(lat, lon) {
    try {
      let name = "";
      for (const source of window.WeatherAPI.REVERSE_SOURCES) {
        try {
          const data = await invoke("fetch_json", { url: source.url(lat, lon) });
          name = String(source.city(data) || "").trim();
          if (name) break;
        } catch (err) {
          console.warn(`reverse geocode failed (${source.name})`, err);
        }
      }
      // 用户可能在请求期间手动改了城市，此时不要覆盖。
      if (
        Number(state.settings.latitude) !== lat ||
        Number(state.settings.longitude) !== lon ||
        (state.settings.city && state.settings.city !== "定位中")
      ) {
        return;
      }
      if (!name) {
        // 坐标拿到了但所有反查服务都失败：保留占位，并提示可手动输入
        state.settings.city = "当前位置";
        els.cityInput.value = "";
        if (state.weather) state.weather.city = "当前位置";
        save();
        renderWeatherCard();
        setLocateHint("已获取位置坐标，但无法识别城市名称。请直接输入城市名。");
        return;
      }
      state.settings.city = name;
      els.cityInput.value = name;
      if (state.weather) state.weather.city = name;
      save();
      renderWeatherCard();
      renderWeatherPill();
      renderCalendar();
    } catch (err) {
      console.warn("reverse geocode failed", err);
    }
  }

  async function pickBackground() {
    try {
      try {
        await win.setAlwaysOnTop(false);
      } catch (err) {
        /* ignore */
      }
      const path = await invoke("pick_image");
      if (path) {
        state.settings.bg_image = path;
        state.settings.bg_mode = state.settings.bg_mode || "fill";
        save();
        applyAppearance();
        syncSettingsUi();
      }
      try {
        await win.setAlwaysOnTop(!!state.settings.always_on_top);
      } catch (err) {
        /* ignore */
      }
    } catch (err) {
      console.warn(err);
    }
  }

  function clearBackground() {
    state.settings.bg_image = "";
    save();
    applyAppearance();
    syncSettingsUi();
  }

  /* ------------------------------------------------------------ clock */
  function updateClock() {
    const now = new Date();
    if (els.wcClock) els.wcClock.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    if (els.wcDate) {
      els.wcDate.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
    }
  }

  function tick() {
    pullAiTodos();
    updateClock();
    tickCount += 1;
    if (new Date().toDateString() !== lastDay) {
      lastDay = new Date().toDateString();
      holidayCheckToday();
      renderTodos();
      renderCalendar();
      scheduleLayout();
      return;
    }
    if (tickCount % 15 === 0) updateRowStates();
  }

  /* ------------------------------------------------------------ events */
  function wireEvents() {
    bindShellEvents();
    bindTodoEvents();
    bindCalendarEvents();
    bindSettingsEvents();
    bindWindowEvents();
  }

  // 顶部栏：天气胶囊、设置入口
  function bindShellEvents() {
    els.header.addEventListener("dblclick", (event) => {
      if (!event.target.closest("button")) return;
    });

    els.weatherPill.addEventListener("click", () => toggleWeather());
    els.settingsBtn.addEventListener("click", () => openSettings());
  }

  // 待办：列表操作、添加、截止时间与日历添加弹窗
  function bindTodoEvents() {
    els.todoList.addEventListener("click", (event) => {
      const action = event.target.closest(".act-btn");
      if (action) {
        const row = action.closest(".todo-row");
        const id = row?.dataset.id;
        if (!id) return;
        const act = action.dataset.act;
        if (act === "done") toggleDone(id);
        else if (act === "pin") togglePin(id);
        else if (act === "del") deleteTodo(id);
        else if (act === "due") {
          const todo = findTodo(id);
          if (todo) openDuePopover(row, todo);
        }
        event.stopPropagation();
        return;
      }
      if (!event.target.closest(".todo-row")) startAdd();
    });

    els.todoList.addEventListener("dblclick", (event) => {
      if (event.target.closest(".edit-input")) return;
      const row = event.target.closest(".todo-row");
      if (!row) return;
      const todo = findTodo(row.dataset.id);
      if (todo) startEdit(row, todo);
    });

    els.todoList.addEventListener("scroll", () => closeDuePopover(), { passive: true });

    els.addRow.addEventListener("click", (event) => {
      if (event.target.closest(".add-input")) return;
      startAdd();
    });

    els.dueOk.addEventListener("click", () => commitDue());
    els.dueClear.addEventListener("click", () => clearDue());

    els.calAddOk.addEventListener("click", () => submitCalAdd());
    els.calAddCancel.addEventListener("click", () => closeCalAdd());
    els.calAddClock.addEventListener("click", () => toggleCalAddTime());
    els.calAddDate.addEventListener("change", () => applyCalAddTime());
    els.calAddTimeValue.addEventListener("change", () => applyCalAddTime());
    els.calAddDate.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        applyCalAddTime();
        submitCalAdd();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCalAdd();
      }
    });
    els.calAddTimeValue.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        applyCalAddTime();
        submitCalAdd();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCalAdd();
      }
    });
    els.calAddInput.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        submitCalAdd();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeCalAdd();
      }
    });

    els.duePopover.querySelectorAll("[data-quick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const now = new Date();
        const target = new Date(now);
        if (btn.dataset.quick === "today18") {
          target.setHours(18, 0, 0, 0);
        } else {
          target.setDate(target.getDate() + 1);
          target.setHours(9, 0, 0, 0);
        }
        els.dueDate.value = ymd(target);
        els.dueTime.value = hm(target);
      });
    });
  }

  // 日历：月份导航、日期格交互、悬停信息与拖动
  function bindCalendarEvents() {
    els.calPrev.addEventListener("click", () => {
      monthCursor = { y: monthCursor.y, m: monthCursor.m - 1 };
      if (monthCursor.m < 0) {
        monthCursor.m = 11;
        monthCursor.y -= 1;
      }
      renderCalendar();
      scheduleLayout();
    });

    els.calNext.addEventListener("click", () => {
      monthCursor = { y: monthCursor.y, m: monthCursor.m + 1 };
      if (monthCursor.m > 11) {
        monthCursor.m = 0;
        monthCursor.y += 1;
      }
      renderCalendar();
      scheduleLayout();
    });

    els.calToday.addEventListener("click", () => {
      const now = new Date();
      monthCursor = { y: now.getFullYear(), m: now.getMonth() };
      renderCalendar();
      scheduleLayout();
    });

    // 双击日期格：在格子上弹出添加待办（色条盖住格子时也能触发）
    els.calGrid.addEventListener("dblclick", (event) => {
      const cell =
        event.target.closest(".cal-cell") || cellAtPoint(event.clientX, event.clientY);
      if (!cell || !cell.dataset.date) return;
      event.preventDefault();
      openCalAdd(cell);
    });

    // 滚轮浏览日期格内超出的待办：每周独立滚动，最多同时显示 3 条
    els.calGrid.addEventListener(
      "wheel",
      (event) => {
        const week = event.target.closest(".cal-week");
        if (!week || !week._bands) return;
        const maxOffset = Number(week.dataset.maxOffset || 0);
        if (maxOffset <= 0) return;
        const step = Math.sign(event.deltaY);
        if (!step) return;
        event.preventDefault();
        const weekStart = week._bands.weekStart;
        const key = ymd(weekStart);
        const current = weekScroll.get(key) || 0;
        const next = clamp(current + step, 0, maxOffset);
        if (next === current) return;
        weekScroll.set(key, next);
        paintWeekBands(week, week._bands.segments, weekStart);
      },
      { passive: false }
    );

    // 在日期格上停留 3 秒显示农历 / 天气 / 每日一句；移走后延迟 1.2 秒消失
    els.calGrid.addEventListener("mouseover", (event) => {
      const cell = event.target.closest(".cal-cell");
      if (!cell) return;
      // 单击弹出的弹框是「固定」的：光标从该格移向弹框时必然经过其它格子，
      // 固定期间经过任何格子都保持现状——既不关闭，也不启动新的悬停计时。
      // 弹框自身的计时器负责超时关闭；移到弹框上会被 mouseenter 取消计时。
      if (infoPinned) return;
      cancelInfoHide();
      if (cell === hoverCell) return;
      hideCalInfo();
      hoverCell = cell;
      const [yy, mm, dd] = (cell.dataset.date || "").split("-").map(Number);
      if (!yy || !mm || !dd) return;
      const date = new Date(yy, mm - 1, dd);
      cellHoverTimer = setTimeout(() => {
        cellHoverTimer = null;
        showCalInfo(cell, date);
      }, 3000);
    });

    els.calGrid.addEventListener("mouseout", (event) => {
      const cell = event.target.closest(".cal-cell");
      if (!cell || cell !== hoverCell) return;
      const to = event.relatedTarget;
      if (to && to.closest && to.closest(".cal-cell") === cell) return;
      // 移到弹框上时保留弹框
      if (to && to.closest && to.closest("#calInfo")) {
        cancelInfoHide();
        return;
      }
      // 单击弹出的弹框已按 INFO_CLICK_HOLD 计时，离开触发格不重置它
      if (infoPinned) return;
      scheduleHideCalInfo();
    });

    els.calGrid.addEventListener("mouseleave", () => {
      // 同上：固定弹框由自己的计时器负责关闭
      if (infoPinned) return;
      scheduleHideCalInfo();
    });
    // 按下时先不关闭弹框：左键既要拖动窗口又要支持单击查看，
    // 等 mouseup 判断是「点击」还是「拖动」后再决定。

    // 右键单击日期格：不等待，立即显示日期信息
    els.calGrid.addEventListener("contextmenu", (event) => {
      const cell = event.target.closest(".cal-cell");
      if (!cell || !cell.dataset.date) return;
      event.preventDefault();
      const [yy, mm, dd] = cell.dataset.date.split("-").map(Number);
      if (!yy || !mm || !dd) return;
      hideCalInfo();
      hoverCell = cell;
      showCalInfo(cell, new Date(yy, mm - 1, dd));
    });

    // 光标停留在弹框上时保持显示，离开后同样延迟消失
    els.calInfo.addEventListener("mouseenter", () => cancelInfoHide());
    els.calInfo.addEventListener("mouseleave", () => scheduleHideCalInfo());

    // 日期格自定义拖动：移动超过 4px 才拖动窗口，避免吞掉双击。
    // 原地按下再抬起则视为单击，用于查看该日期的农历 / 格言弹框。
    els.calGrid.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".cal-bar")) return;
      const cell = event.target.closest(".cal-cell");
      if (!cell) return;
      calPress = { x: event.clientX, y: event.clientY, cell };
    });

    window.addEventListener("mousemove", (event) => {
      if (!calPress) return;
      if (Math.hypot(event.clientX - calPress.x, event.clientY - calPress.y) < 4) return;
      calPress = null;
      hideCalInfo();
      try {
        if (win) win.startDragging();
      } catch (err) {
        /* ignore */
      }
    });

    window.addEventListener("mouseup", () => {
      const press = calPress;
      calPress = null;
      // 未移动即抬起 = 单击日期格：立即弹出该日信息
      if (!press || !press.cell || !press.cell.dataset.date) return;
      const [yy, mm, dd] = press.cell.dataset.date.split("-").map(Number);
      if (!yy || !mm || !dd) return;
      hideCalInfo();
      hoverCell = press.cell;
      infoPinned = true;
      showCalInfo(press.cell, new Date(yy, mm - 1, dd));
      // 单击后给足时间把光标移到弹框上；移上去后 mouseenter 会取消这个计时
      scheduleHideCalInfo(INFO_CLICK_HOLD);
    });
  }

  // 设置面板全部控件
  function bindSettingsEvents() {
    els.settingsClose.addEventListener("click", () => closeSettings());
    els.settingsDone.addEventListener("click", () => closeSettings());
    els.settingsOverlay.addEventListener("click", (event) => {
      if (event.target === els.settingsOverlay) closeSettings();
    });

    // 拖动设置面板标题栏移动窗口
    const settingsHead = els.settingsPanel.querySelector(".settings-head");
    if (settingsHead) {
      settingsHead.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        hideCalInfo();
        try {
          if (win) win.startDragging();
        } catch (err) {
          /* ignore */
        }
      });
    }

    els.opacityRange.addEventListener("input", () => {
      const transparency = Number(els.opacityRange.value);
      state.settings.opacity = opacityFromTransparency(transparency / 100);
      els.opacityRange.style.setProperty("--fill", `${transparency}%`);
      els.opacityValue.textContent = `${transparency}%`;
      applyAppearance();
      save();
    });

    els.pickBg.addEventListener("click", () => pickBackground());
    els.clearBg.addEventListener("click", () => clearBackground());

    els.colorRow.addEventListener("click", (event) => {
      const btn = event.target.closest(".swatch");
      if (!btn) return;
      state.settings.bg_color = normalizeHex(btn.dataset.color, DEFAULT_SETTINGS.bg_color);
      applyAppearance();
      syncSettingsUi();
      save();
    });

    els.bgColor.addEventListener("input", () => {
      state.settings.bg_color = normalizeHex(els.bgColor.value, DEFAULT_SETTINGS.bg_color);
      applyAppearance();
      syncSettingsUi();
      save();
    });

    els.fontSelect.addEventListener("change", () => {
      state.settings.font_family = FONT_STACKS[els.fontSelect.value]
        ? els.fontSelect.value
        : "default";
      applyAppearance();
      save();
    });

    els.fontColorRow.addEventListener("click", (event) => {
      const btn = event.target.closest(".swatch");
      if (!btn) return;
      state.settings.font_color = normalizeHex(btn.dataset.color, DEFAULT_SETTINGS.font_color);
      applyAppearance();
      syncSettingsUi();
      save();
    });

    els.fontColor.addEventListener("input", () => {
      state.settings.font_color = normalizeHex(els.fontColor.value, DEFAULT_SETTINGS.font_color);
      applyAppearance();
      syncSettingsUi();
      save();
    });

    els.minimalSwitch.addEventListener("click", () => {
      state.settings.minimal = !state.settings.minimal;
      // 两种模式互斥：打开极简就退出日历
      if (state.settings.minimal) state.settings.calendar = false;
      setSwitch(els.minimalSwitch, state.settings.minimal);
      setSwitch(els.calendarSwitch, state.settings.calendar);
      // 设置面板打开时先不改主界面，关闭设置后由 doLayout 一次性应用
      if (!settingsOpen) {
        document.body.classList.toggle("calendar-mode", state.settings.calendar);
        document.body.classList.toggle(
          "minimal-mode",
          !state.settings.calendar && state.settings.minimal
        );
      }
      commitTodos({ layout: !settingsOpen });
    });

    els.bgModes.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-mode]");
      if (!btn) return;
      state.settings.bg_mode = btn.dataset.mode;
      applyAppearance();
      save();
    });

    els.calendarSwitch.addEventListener("click", () => toggleCalendarMode());
    els.topSwitch.addEventListener("click", () => toggleAlwaysOnTop());
    els.exportBtn.addEventListener("click", () => exportRecentDone());

    els.autostartSwitch.addEventListener("click", async () => {
      const next = !state.settings.autostart;
      // 先给出视觉反馈，写入注册表在后台完成
      state.settings.autostart = next;
      setSwitch(els.autostartSwitch, next);
      try {
        const applied = await invoke("set_autostart", { enabled: next });
        state.settings.autostart = !!applied;
        setSwitch(els.autostartSwitch, !!applied);
        save();
      } catch (err) {
        console.warn("autostart failed", err);
        state.settings.autostart = !next;
        setSwitch(els.autostartSwitch, !next);
      }
    });

    els.taskbarSwitch.addEventListener("click", async () => {
      const next = !state.settings.hide_taskbar;
      try {
        await invoke("set_taskbar_hidden", { enabled: next });
        state.settings.hide_taskbar = next;
        setSwitch(els.taskbarSwitch, next);
        save();
      } catch (err) {
        console.warn("taskbar toggle failed", err);
        setSwitch(els.taskbarSwitch, state.settings.hide_taskbar);
      }
    });

    // 设置分类：左侧图标切换右侧配置页
    els.settingsPanel.querySelectorAll(".set-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        els.settingsPanel.querySelectorAll(".set-tab").forEach((item) => {
          item.classList.toggle("active", item === tab);
        });
        els.settingsPanel.querySelectorAll(".set-page").forEach((page) => {
          page.classList.toggle("active", page.dataset.page === tab.dataset.tab);
        });
      });
    });

    els.cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        els.cityInput.blur();
      }
    });
    els.cityInput.addEventListener("change", () => changeCity());
    els.weatherApiInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        els.weatherApiInput.blur();
      }
    });
    els.weatherApiInput.addEventListener("change", () => {
      state.settings.weather_api = els.weatherApiInput.value.trim();
      state.weather = null;
      save();
      renderWeatherCard();
      refreshWeather();
    });
    els.locateBtn.addEventListener("click", () => locate());

    els.quitBtn.addEventListener("click", async () => {
      try {
        await invoke("save_state", { state: serializeState() });
        if (win) await win.close();
      } catch (err) {
        console.warn(err);
      }
    });
  }

  // 全局：点击外部关闭弹窗、Esc、位置保存与退出前保存
  function bindWindowEvents() {
    if (tauri.event) {
      tauri.event.listen("tray-show", handleTrayShow).catch(() => {});
    }
    // 拖动停止后处理靠边吸附 / 边缘隐藏
    if (win && typeof win.onMoved === "function") {
      win.onMoved(() => {
        clearTimeout(moveSettleTimer);
        moveSettleTimer = setTimeout(handleMoveSettled, 180);
      });
    }
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 0) pointerDown = true;
      },
      true
    );
    window.addEventListener("mouseup", () => {
      pointerDown = false;
      topDwellSince = 0;
      clearTimeout(topDwellTimer);
      clearTimeout(moveSettleTimer);
      moveSettleTimer = setTimeout(handleMoveSettled, 80);
      if (edgeHide && !edgeHide.revealed && edgeHide.pending) {
        // 拖动中已收起：松开鼠标后系统会把窗口放回鼠标位置，延迟重新收起
        edgeHide.pending = false;
        edgeHide.reassertUntil = Date.now() + 700;
        setTimeout(() => {
          if (edgeHide && !edgeHide.revealed) {
            animateWindowTo(edgeHide.hidden.x, edgeHide.hidden.y, EDGE_HIDE_ANIM_MS);
          }
        }, 80);
      }
    });
    document.addEventListener(
      "pointerup",
      () => {
        pointerDown = false;
      },
      true
    );
    window.addEventListener("blur", () => {
      pointerDown = false;
    });

    // 隐藏状态下悬停 0.8 秒显示；显示后移开鼠标再收起
    els.app.addEventListener("mouseenter", () => {
      if (!edgeHide) return;
      clearTimeout(edgeLeaveTimer);
      edgeLeaveTimer = null;
    });
    els.app.addEventListener("mouseleave", () => {
      if (!edgeHide || !edgeHide.revealed) return;
      clearTimeout(edgeLeaveTimer);
      edgeLeaveTimer = setTimeout(() => {
        if (edgeHide && edgeHide.revealed) concealEdgeHide();
      }, EDGE_LEAVE_MS);
    });

    // 隐藏状态下左键单击 / 双击窄边：不再等待，立即弹出
    els.app.addEventListener(
      "pointerdown",
      (event) => {
        if (!edgeHide || edgeHide.revealed || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(edgeRevealTimer);
        edgeRevealTimer = null;
        edgeClickGuardUntil = Date.now() + 700;
        revealEdgeHide();
      },
      true
    );
    const swallowEdgeClick = (event) => {
      if (Date.now() < edgeClickGuardUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    els.app.addEventListener("click", swallowEdgeClick, true);
    els.app.addEventListener("dblclick", swallowEdgeClick, true);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!els.calAddPopover.hidden && !els.calAddPopover.contains(event.target)) {
          closeCalAdd();
        }
        if (els.duePopover.hidden) return;
        if (els.duePopover.contains(event.target)) return;
        if (event.target.closest('.act-btn.due')) return;
        closeDuePopover();
      },
      true
    );

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.calInfo.hidden) hideCalInfo();
      else if (!els.calAddPopover.hidden) closeCalAdd();
      else if (!els.duePopover.hidden) closeDuePopover();
      else if (settingsOpen) closeSettings();
    });

    document.addEventListener("pointerup", () => {
      clearTimeout(dragTimer);
      dragTimer = setTimeout(savePosition, 500);
    });

    window.addEventListener("beforeunload", () => {
      try {
        invoke("save_state", { state: serializeState() });
      } catch (err) {
        /* ignore */
      }
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
