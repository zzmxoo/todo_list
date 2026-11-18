(function () {
  const api = window.WeatherAPI;
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

  test('detectProvider 识别各家链接', () => {
    eq(api.detectProvider('https://devapi.qweather.com/v7/weather/7d?location=1&key=x'), 'qweather');
    eq(api.detectProvider('https://api.caiyunapp.com/v2.6/token/120,30/weather.json'), 'caiyun');
    eq(api.detectProvider('https://uapis.cn/api/v1/misc/weather?city=北京'), 'uapis');
    eq(api.detectProvider('https://api.open-meteo.com/v1/forecast?latitude=1'), 'open-meteo');
    eq(api.detectProvider('https://example.com/weather'), '');
  });

  test('detectPayload 识别响应结构', () => {
    eq(api.detectPayload({ current: {}, daily: { time: [] } }), 'open-meteo');
    eq(api.detectPayload({ code: '200', daily: [] }), 'qweather');
    eq(api.detectPayload({ status: 'ok', result: {} }), 'caiyun');
    eq(api.detectPayload({ temperature: 20, forecast: [] }), 'uapis');
    eq(api.detectPayload({ foo: 1 }), '');
  });

  test('和风图标代码映射', () => {
    eq(api.fromQWeatherIcon('100'), 0);
    eq(api.fromQWeatherIcon('104'), 3);
    eq(api.fromQWeatherIcon('305'), 61);
    eq(api.fromQWeatherIcon('302'), 95);
    eq(api.fromQWeatherIcon('400'), 71);
    eq(api.fromQWeatherIcon('501'), 45);
  });

  test('彩云 skycon 与文字描述映射', () => {
    eq(api.fromCaiyunSkycon('CLEAR_DAY'), 0);
    eq(api.fromCaiyunSkycon('PARTLY_CLOUDY_NIGHT'), 1);
    eq(api.fromCaiyunSkycon('LIGHT_RAIN'), 61);
    eq(api.fromText('中雨'), 63);
    eq(api.fromText('雷阵雨'), 95);
    eq(api.fromText('雾'), 45);
  });

  test('normalizeQWeather 同时取实况与预报', () => {
    const daily = {
      daily: [
        { fxDate: '2026-11-18', iconDay: '100', tempMax: '20', tempMin: '10' },
        { fxDate: '2026-11-19', iconDay: '305', tempMax: '17', tempMin: '9' },
      ],
    };
    const now = { now: { temp: '15', icon: '101', humidity: '60', windSpeed: '12' } };
    const w = api.normalizeQWeather(daily, now, { city: '杭州' });
    eq(w.city, '杭州');
    eq(w.current.temp, 15);
    eq(w.current.code, 2);
    eq(w.current.humidity, 60);
    eq(w.current.wind, 12);
    eq(w.daily.length, 2);
    eq(w.daily[0].hi, 20);
    eq(w.daily[1].code, 61);
  });

  test('normalizeCaiyun 处理湿度与风速单位', () => {
    const data = {
      status: 'ok',
      result: {
        realtime: {
          temperature: 18.6,
          humidity: 0.62,
          skycon: 'PARTLY_CLOUDY_DAY',
          wind: { speed: 5 },
        },
        daily: {
          temperature: [{ date: '2026-11-18', max: 22.4, min: 12.1 }],
          skycon: [{ value: 'LIGHT_RAIN' }],
        },
      },
    };
    const w = api.normalizeCaiyun(data, { city: '杭州' });
    eq(w.current.temp, 19);
    eq(w.current.humidity, 62);
    eq(w.current.wind, 18);
    eq(w.current.code, 1);
    eq(w.daily[0].code, 61);
    eq(w.daily[0].hi, 22);
    eq(w.daily[0].lo, 12);
  });

  test('normalizeUapis 解析实况与 forecast', () => {
    const data = {
      city: '渭南市',
      temperature: 9.9,
      humidity: 83,
      weather_icon: '100',
      forecast: [{ date: '2026-11-18', temp_max: 18, temp_min: 6, weather_icon: '305' }],
    };
    const w = api.normalizeUapis(data, {});
    eq(w.city, '渭南市');
    eq(w.current.temp, 10);
    eq(w.current.humidity, 83);
    eq(w.current.code, 0);
    eq(w.daily[0].code, 61);
    eq(w.daily[0].hi, 18);
    eq(w.daily[0].lo, 6);
  });

  test('normalizeUapis 兼容 weather_day 与风力等级', () => {
    const data = {
      temperature: 5,
      humidity: 22,
      weather: '晴',
      weather_icon: '100',
      wind_power: '6-7',
      forecast: [
        { date: '2026-11-18', temp_max: 7, temp_min: -2, weather_day: '多云' },
        { date: '2026-11-19', temp_max: 6, temp_min: -2, weather_day: '雷阵雨' },
      ],
    };
    const w = api.normalizeUapis(data, {});
    eq(w.current.wind, 57);
    eq(w.daily[0].code, 2);
    eq(w.daily[1].code, 95);
    eq(api.windFromPower('1-3'), 9);
    eq(api.windFromPower(''), 0);
  });

  test('uapis 链接自动补 forecast 参数', () => {
    eq(
      api.uapisWithForecast('https://uapis.cn/api/v1/misc/weather?city=北京'),
      'https://uapis.cn/api/v1/misc/weather?city=北京&forecast=true'
    );
    eq(
      api.uapisWithForecast('https://uapis.cn/api/v1/misc/weather?city=北京&forecast=true'),
      'https://uapis.cn/api/v1/misc/weather?city=北京&forecast=true'
    );
  });

  test('和风链接在 7d / now 之间切换', () => {
    eq(
      api.qweatherVariant('https://devapi.qweather.com/v7/weather/7d?location=1&key=x', 'now'),
      'https://devapi.qweather.com/v7/weather/now?location=1&key=x'
    );
    eq(
      api.qweatherVariant('https://devapi.qweather.com/v7/weather/now?location=1&key=x', '7d'),
      'https://devapi.qweather.com/v7/weather/7d?location=1&key=x'
    );
  });

  const passed = results.filter((r) => r.ok).length;
  return JSON.stringify({ passed: passed, failed: results.length - passed, results: results });
})()
