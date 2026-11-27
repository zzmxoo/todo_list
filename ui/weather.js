/* 桌面待办 —— 天气数据模块：识别并解析和风 / 彩云 / uapis.cn / Open-Meteo */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WeatherAPI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function dayKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 预报第 i 项是「从现在起第 i 天」；接口给的是城市时区日期，跨时区时与本地日历
  // 对不上（本地今天格丢天气）。统一重写为本地今天 + i，消费端按本地日期匹配。
  function rebaseDailyDates(days) {
    return days.map((day, index) => ({ ...day, date: dayKey(index) }));
  }

  function round(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  }

  /* -------- 天气现象 -> WMO 代码（沿用界面里的图标表） -------- */

  // 和风天气图标代码（100/101/.../999）
  function fromQWeatherIcon(icon) {
    const code = parseInt(icon, 10);
    if (!Number.isFinite(code)) return 2;
    if (code === 100 || code === 150) return 0;
    if ([101, 102, 103, 151, 152, 153].includes(code)) return 2;
    if (code === 104 || code === 154) return 3;
    if (code >= 200 && code < 300) return 2;
    if (code >= 300 && code < 400) {
      if (code === 302 || code === 303 || code === 304) return 95;
      if (code === 300 || code === 301) return 80;
      if (code === 305 || code === 309) return 61;
      if (code === 306 || code === 314) return 63;
      if (code === 313) return 66;
      return 65;
    }
    if (code >= 400 && code < 500) {
      if (code === 400 || code === 404 || code === 405 || code === 408) return 71;
      if (code === 401 || code === 406 || code === 409) return 73;
      if (code === 407) return 85;
      return 75;
    }
    if (code >= 500 && code < 600) return 45;
    return 2;
  }

  const CAIYUN_SKYCON = {
    CLEAR_DAY: 0,
    CLEAR_NIGHT: 0,
    PARTLY_CLOUDY_DAY: 1,
    PARTLY_CLOUDY_NIGHT: 1,
    CLOUDY: 3,
    LIGHT_HAZE: 45,
    MODERATE_HAZE: 45,
    HEAVY_HAZE: 45,
    FOG: 45,
    DUST: 45,
    SAND: 45,
    WIND: 2,
    LIGHT_RAIN: 61,
    MODERATE_RAIN: 63,
    HEAVY_RAIN: 65,
    STORM_RAIN: 82,
    LIGHT_SNOW: 71,
    MODERATE_SNOW: 73,
    HEAVY_SNOW: 75,
    STORM_SNOW: 75,
  };

  function fromCaiyunSkycon(value) {
    return CAIYUN_SKYCON[String(value || "").toUpperCase()] ?? 2;
  }

  function fromText(text) {
    const t = String(text || "");
    if (/雷/.test(t)) return 95;
    if (/暴雨|大雨|强阵雨/.test(t)) return 65;
    if (/中雨/.test(t)) return 63;
    if (/雨/.test(t)) return 61;
    if (/暴雪|大雪/.test(t)) return 75;
    if (/中雪/.test(t)) return 73;
    if (/雪/.test(t)) return 71;
    if (/雾|霾|沙|尘/.test(t)) return 45;
    if (/阴/.test(t)) return 3;
    if (/云/.test(t)) return 2;
    if (/晴/.test(t)) return 0;
    return 2;
  }

  /* ------------------------------ 数据源识别 ------------------------------ */

  function detectProvider(url) {
    const u = String(url || "").toLowerCase();
    if (/qweather\.(com|net)|devapi\.qweather/.test(u)) return "qweather";
    if (u.includes("caiyunapp.com")) return "caiyun";
    if (u.includes("uapis.cn")) return "uapis";
    if (u.includes("open-meteo.com")) return "open-meteo";
    return "";
  }

  function detectPayload(data) {
    if (!data || typeof data !== "object") return "";
    if (data.current && data.daily && Array.isArray(data.daily.time)) return "open-meteo";
    if (Array.isArray(data.daily) && (data.code !== undefined || data.updateTime)) return "qweather";
    if (data.status && data.result) return "caiyun";
    if (data.temperature !== undefined || data.forecast !== undefined) return "uapis";
    return "";
  }

  /* ------------------------------ 规范化 ------------------------------ */

  function normalizeOpenMeteo(data, ctx) {
    const daily = data.daily || {};
    const dates = Array.isArray(daily.time) ? daily.time : [];
    const days = dates
      .map((date, index) => ({
        date,
        code: Number(daily.weather_code?.[index] ?? 0),
        hi: round(daily.temperature_2m_max?.[index]),
        lo: round(daily.temperature_2m_min?.[index]),
      }))
      .filter((day) => day.date);
    if (!days.length) throw new Error("暂无天气数据");

    const current = data.current || {};
    return {
      city: ctx.city || "",
      lat: ctx.lat ?? null,
      lon: ctx.lon ?? null,
      current: {
        temp: round(current.temperature_2m),
        code: Number(current.weather_code ?? 0),
        humidity: round(current.relative_humidity_2m),
        wind: round(current.wind_speed_10m),
      },
      daily: rebaseDailyDates(days),
      ts: Date.now() / 1000,
    };
  }

  function normalizeQWeather(dailyData, nowData, ctx) {
    const days = (Array.isArray(dailyData?.daily) ? dailyData.daily : [])
      .slice(0, 7)
      .map((day) => ({
        date: day.fxDate,
        code: fromQWeatherIcon(day.iconDay ?? day.icon),
        hi: round(day.tempMax),
        lo: round(day.tempMin),
      }))
      .filter((day) => day.date && Number.isFinite(day.hi) && Number.isFinite(day.lo));
    if (!days.length) throw new Error("暂无天气数据");

    const now = nowData?.now || {};
    return {
      city: ctx.city || "",
      lat: ctx.lat ?? null,
      lon: ctx.lon ?? null,
      current: {
        temp: round(now.temp, days[0].hi),
        code: now.icon ? fromQWeatherIcon(now.icon) : days[0].code,
        humidity: round(now.humidity),
        wind: round(now.windSpeed),
      },
      daily: rebaseDailyDates(days),
      ts: Date.now() / 1000,
    };
  }

  function normalizeCaiyun(data, ctx) {
    const result = data.result || {};
    const realtime = result.realtime || {};
    const daily = result.daily || {};
    const temps = Array.isArray(daily.temperature) ? daily.temperature : [];
    const skycons = Array.isArray(daily.skycon) ? daily.skycon : [];

    const days = temps
      .slice(0, 7)
      .map((item, index) => ({
        date: String(item.date || dayKey(index)).slice(0, 10),
        code: fromCaiyunSkycon(skycons[index]?.value),
        hi: round(item.max),
        lo: round(item.min),
      }))
      .filter((day) => day.date && Number.isFinite(day.hi) && Number.isFinite(day.lo));
    if (!days.length) throw new Error("暂无天气数据");

    let humidity = Number(realtime.humidity);
    if (!Number.isFinite(humidity)) humidity = 0;
    else if (humidity <= 1) humidity *= 100;

    // 彩云 realtime.wind.speed 的单位是 km/h，不能当 m/s 再乘 3.6。
    const windKmh = Number(realtime.wind?.speed);
    return {
      city: ctx.city || "",
      lat: ctx.lat ?? null,
      lon: ctx.lon ?? null,
      current: {
        temp: round(realtime.temperature, days[0].hi),
        code: fromCaiyunSkycon(realtime.skycon),
        humidity: Math.round(humidity),
        wind: Number.isFinite(windKmh) ? Math.round(windKmh) : 0,
      },
      daily: rebaseDailyDates(days),
      ts: Date.now() / 1000,
    };
  }

  // 风力等级（如 "1-3"、"6"）换算成大致风速 km/h
  function windFromPower(text) {
    const match = String(text || "").match(/(\d+)(?:\s*-\s*(\d+))?/);
    if (!match) return 0;
    const level = Math.round((Number(match[1]) + Number(match[2] ?? match[1])) / 2);
    const table = [1, 4, 9, 16, 24, 34, 45, 57, 71, 85, 100, 115, 130];
    return table[Math.min(12, Math.max(0, level))] || 0;
  }

  function normalizeUapis(data, ctx) {
    const forecast = Array.isArray(data.forecast) ? data.forecast : [];
    const days = forecast
      .slice(0, 7)
      .map((item, index) => {
        const text = item.weather_day ?? item.weather ?? item.text_day;
        return {
          date: String(item.date || item.datetime || dayKey(index)).slice(0, 10),
          code: item.weather_icon ? fromQWeatherIcon(item.weather_icon) : fromText(text),
          hi: round(item.temp_max ?? item.temperature_max ?? item.high, round(data.temperature)),
          lo: round(item.temp_min ?? item.temperature_min ?? item.low, round(data.temperature)),
        };
      })
      .filter((day) => day.date);

    const current = {
      temp: round(data.temperature),
      code: data.weather_icon ? fromQWeatherIcon(data.weather_icon) : fromText(data.weather),
      humidity: round(data.humidity),
      wind: windFromPower(data.wind_power),
    };
    if (!days.length) {
      days.push({ date: dayKey(0), code: current.code, hi: current.temp, lo: current.temp });
    }

    return {
      city: data.city || ctx.city || "",
      lat: ctx.lat ?? null,
      lon: ctx.lon ?? null,
      current,
      daily: rebaseDailyDates(days),
      ts: Date.now() / 1000,
    };
  }

  /* ------------------------------ 请求 ------------------------------ */

  function qweatherVariant(url, kind) {
    return url.replace(/\/(now|3d|7d|10d|15d|30d|24h)(?=[?&#]|$)/, `/${kind}`);
  }

  function uapisWithForecast(url) {
    if (/[?&]forecast=/.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}forecast=true`;
  }

  async function loadOpenMeteo(url, ctx, fetchJson) {
    return normalizeOpenMeteo(await fetchJson(url), ctx);
  }

  async function loadQWeather(url, ctx, fetchJson) {
    const first = await fetchJson(url);
    let dailyData = null;
    let nowData = null;
    if (Array.isArray(first.daily)) dailyData = first;
    else if (first.now) nowData = first;

    if (!dailyData) dailyData = await fetchJson(qweatherVariant(url, "7d"));
    if (!nowData) {
      try {
        nowData = await fetchJson(qweatherVariant(url, "now"));
      } catch (err) {
        nowData = null;
      }
    }
    return normalizeQWeather(dailyData, nowData, ctx);
  }

  async function loadCaiyun(url, ctx, fetchJson) {
    return normalizeCaiyun(await fetchJson(url), ctx);
  }

  async function loadUapis(url, ctx, fetchJson) {
    return normalizeUapis(await fetchJson(uapisWithForecast(url)), ctx);
  }

  // 未知链接：先抓一次，按响应结构判断格式
  async function loadAuto(url, ctx, fetchJson) {
    const data = await fetchJson(url);
    const kind = detectPayload(data);
    if (kind === "open-meteo") return normalizeOpenMeteo(data, ctx);
    if (kind === "qweather") return loadQWeather(url, ctx, fetchJson);
    if (kind === "caiyun") return normalizeCaiyun(data, ctx);
    if (kind === "uapis") return normalizeUapis(data, ctx);
    throw new Error("无法识别的天气数据格式");
  }

  function load(url, ctx, fetchJson) {
    const provider = detectProvider(url);
    if (provider === "qweather") return loadQWeather(url, ctx, fetchJson);
    if (provider === "caiyun") return loadCaiyun(url, ctx, fetchJson);
    if (provider === "uapis") return loadUapis(url, ctx, fetchJson);
    if (provider === "open-meteo") return loadOpenMeteo(url, ctx, fetchJson);
    return loadAuto(url, ctx, fetchJson);
  }

  /**
   * 从 BigDataCloud reverse-geocode-client 的响应里取城市名。
   * 依次尝试 city / principalSubdivision（省级）/ locality，都没有则返回空串，
   * 由调用方保留原值。
   */
  function pickCityFromReverse(data) {
    if (!data || typeof data !== "object") return "";
    const candidates = [data.city, data.principalSubdivision, data.locality];
    for (const value of candidates) {
      const name = String(value || "").trim();
      if (name) return name;
    }
    return "";
  }

  /**
   * IP 定位服务列表，按可靠性与准确性排序，调用方依次尝试直到成功。
   * 都不需要 API Key。
   * - bigdatacloud：实测判断最准（与真实位置一致），但较慢
   * - ip-api：最快（约 1s）且准确，仅有 HTTP 端点（免费版不支持 HTTPS）
   * - ipwho.is：HTTPS 且快，但 IP 库精度较差（实测偏差数百公里），兜底用
   */
  const IP_LOCATE_SOURCES = [
    {
      name: "bigdatacloud",
      url: "https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=zh",
      city: (d) => d.city || d.principalSubdivision || d.locality,
      coords: (d) => [d.latitude, d.longitude],
    },
    {
      name: "ip-api",
      url: "http://ip-api.com/json/?lang=zh-CN&fields=status,city,regionName,lat,lon",
      city: (d) => (d.status === "fail" ? "" : d.city || d.regionName),
      coords: (d) => [d.lat, d.lon],
    },
    {
      name: "ipwho.is",
      url: "https://ipwho.is/?lang=zh-CN",
      city: (d) => (d.success === false ? "" : d.city || d.region),
      coords: (d) => [d.latitude, d.longitude],
    },
  ];

  /**
   * 逆地理编码服务（坐标 -> 城市名），用于 GPS 路径。
   * nominatim 长期不可用但保留作为兜底：万一其他渠道都失效时仍有得试。
   */
  const REVERSE_SOURCES = [
    {
      name: "bigdatacloud",
      url: (lat, lon) =>
        `https://api.bigdatacloud.net/data/reverse-geocode-client` +
        `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`,
      city: (d) => d.city || d.principalSubdivision || d.locality,
    },
    {
      name: "nominatim",
      url: (lat, lon) =>
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
        `&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=zh-CN`,
      city: (d) => {
        const parts = String(d.display_name || "").split(",").map((p) => p.trim());
        const hit = parts.find((p) => /(市|自治州|地区|盟)$/.test(p));
        const addr = d.address || {};
        return hit || addr.city || addr.town || addr.municipality || addr.county || addr.state || d.name;
      },
    },
  ];

  /** 兼容旧调用点：默认第一个服务的地址。 */
  const ipLocateUrl = IP_LOCATE_SOURCES[0].url;

  /** 从响应里取经纬度；缺失或越界返回 null。 */
  function pickCoords(data) {
    if (!data || typeof data !== "object") return null;
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  return {
    pickCityFromReverse,
    pickCoords,
    ipLocateUrl,
    IP_LOCATE_SOURCES,
    REVERSE_SOURCES,
    detectProvider,
    detectPayload,
    fromQWeatherIcon,
    fromCaiyunSkycon,
    fromText,
    windFromPower,
    normalizeOpenMeteo,
    normalizeQWeather,
    normalizeCaiyun,
    normalizeUapis,
    qweatherVariant,
    uapisWithForecast,
    load,
  };
});
