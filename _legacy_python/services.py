"""数据持久化与天气服务。"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import uuid

from PySide6.QtCore import QObject, QTimer, QUrl, QUrlQuery, Signal
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(APP_DIR, "data.json")

DEFAULT_SETTINGS = {
    "opacity": 0.9,
    "bg_image": "",
    "bg_mode": "fill",          # stretch | tile | fill
    "calendar": False,
    "always_on_top": True,
    "city": "北京",
    "latitude": None,
    "longitude": None,
    "weather_open": False,
    "x": None,
    "y": None,
}

_WMO = {
    0: ("晴", "sun"), 1: ("晴间多云", "suncloud"), 2: ("多云", "suncloud"), 3: ("阴", "cloud"),
    45: ("雾", "fog"), 48: ("雾凇", "fog"),
    51: ("小毛毛雨", "rain"), 53: ("毛毛雨", "rain"), 55: ("强毛毛雨", "rain"),
    56: ("冻毛毛雨", "rain"), 57: ("强冻毛毛雨", "rain"),
    61: ("小雨", "rain"), 63: ("中雨", "rain"), 65: ("大雨", "rain"),
    66: ("冻雨", "rain"), 67: ("强冻雨", "rain"),
    71: ("小雪", "snow"), 73: ("中雪", "snow"), 75: ("大雪", "snow"), 77: ("雪粒", "snow"),
    80: ("阵雨", "rain"), 81: ("强阵雨", "rain"), 82: ("暴雨", "rain"),
    85: ("阵雪", "snow"), 86: ("强阵雪", "snow"),
    95: ("雷阵雨", "thunder"), 96: ("雷阵雨伴冰雹", "thunder"), 99: ("强雷雨伴冰雹", "thunder"),
}


def weather_info(code):
    try:
        code = int(code)
    except (TypeError, ValueError):
        code = -1
    return _WMO.get(code, ("未知", "cloud"))


def parse_dt(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def due_state(todo):
    """none / normal / soon / overdue"""
    due = parse_dt(todo.get("due"))
    if due is None:
        return "none"
    if todo.get("done"):
        return "normal"
    now = dt.datetime.now()
    if now > due:
        return "overdue"
    if due - now <= dt.timedelta(minutes=30):
        return "soon"
    return "normal"


def sort_todos(todos):
    def key(item):
        index, todo = item
        return (0 if todo.get("pinned") else 1, 1 if todo.get("done") else 0, index)
    return [t for _, t in sorted(enumerate(todos), key=key)]


class Store:
    """data.json 读写，所有控件共享同一份内存数据。"""

    def __init__(self, path=DATA_FILE):
        self.path = path
        self.todos = []
        self.settings = dict(DEFAULT_SETTINGS)
        self.weather_cache = None
        self.load()

    def load(self):
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return
        todos = data.get("todos")
        if isinstance(todos, list):
            self.todos = [t for t in todos if isinstance(t, dict) and t.get("text")]
        settings = data.get("settings")
        if isinstance(settings, dict):
            for key in DEFAULT_SETTINGS:
                if key in settings:
                    self.settings[key] = settings[key]
        if isinstance(data.get("weather"), dict):
            self.weather_cache = data["weather"]

    def save(self):
        payload = {
            "todos": self.todos,
            "settings": self.settings,
            "weather": self.weather_cache,
        }
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        except OSError:
            pass

    # ---- todo helpers -------------------------------------------------
    def add_todo(self, text, due=None):
        text = (text or "").strip()
        if not text:
            return None
        todo = {
            "id": uuid.uuid4().hex,
            "text": text,
            "done": False,
            "pinned": False,
            "due": due,
            "created": dt.datetime.now().isoformat(timespec="seconds"),
        }
        self.todos.append(todo)
        self.save()
        return todo

    def remove_todo(self, todo):
        self.todos = [t for t in self.todos if t is not todo]
        self.save()

    def todo_by_id(self, todo_id):
        for todo in self.todos:
            if todo.get("id") == todo_id:
                return todo
        return None


class WeatherService(QObject):
    updated = Signal(dict)
    failed = Signal(str)
    located = Signal(float, float, str)   # lat, lon, city

    def __init__(self, parent=None):
        super().__init__(parent)
        self._nam = QNetworkAccessManager(self)
        self._reply = None
        self._stage = ""
        self.city = ""
        self.lat = None
        self.lon = None
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(15000)
        self._timer.timeout.connect(self._on_timeout)

    def set_city(self, city, lat=None, lon=None):
        city = (city or "").strip()
        changed = city != self.city
        self.city = city
        if changed:
            self.lat = lat
            self.lon = lon
        elif lat is not None:
            self.lat = lat
            self.lon = lon
        self.refresh()

    def refresh(self):
        if not self.city:
            self.failed.emit("请先在设置中填写城市")
            return
        if self.lat is None or self.lon is None:
            self._geocode()
        else:
            self._forecast()

    # ---- network ------------------------------------------------------
    def _start(self, url):
        if self._reply is not None:
            self._reply.abort()
            self._reply.deleteLater()
            self._reply = None
        request = QNetworkRequest(QUrl(url))
        request.setRawHeader(b"User-Agent", b"TodoWidget/1.0")
        try:
            request.setTransferTimeout(12000)
        except AttributeError:
            pass
        self._reply = self._nam.get(request)
        self._reply.finished.connect(self._on_finished)
        self._timer.start()

    def _abort_request(self):
        if self._reply is not None:
            reply, self._reply = self._reply, None
            reply.abort()
            reply.deleteLater()
        self._timer.stop()

    def _on_timeout(self):
        self._abort_request()
        self.failed.emit("天气请求超时")

    def _geocode(self):
        query = QUrlQuery()
        query.addQueryItem("name", self.city)
        query.addQueryItem("count", "1")
        query.addQueryItem("language", "zh")
        query.addQueryItem("format", "json")
        url = QUrl("https://geocoding-api.open-meteo.com/v1/search")
        url.setQuery(query)
        self._stage = "geo"
        self._start(url)

    def _forecast(self):
        query = QUrlQuery()
        query.addQueryItem("latitude", str(self.lat))
        query.addQueryItem("longitude", str(self.lon))
        query.addQueryItem("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m")
        query.addQueryItem("daily", "weather_code,temperature_2m_max,temperature_2m_min")
        query.addQueryItem("timezone", "auto")
        query.addQueryItem("forecast_days", "7")
        url = QUrl("https://api.open-meteo.com/v1/forecast")
        url.setQuery(query)
        self._stage = "forecast"
        self._start(url)

    def _on_finished(self):
        reply, self._reply = self._reply, None
        if reply is None:
            return
        self._timer.stop()
        stage = self._stage
        err = reply.error()
        raw = bytes(reply.readAll())
        reply.deleteLater()
        if err != QNetworkReply.NetworkError.NoError:
            self.failed.emit("网络连接失败，无法获取天气")
            return
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.failed.emit("天气数据解析失败")
            return
        if stage == "geo":
            self._handle_geo(data)
        elif stage == "forecast":
            self._handle_forecast(data)

    def _handle_geo(self, data):
        results = data.get("results") or []
        if not results:
            self.failed.emit("找不到城市「%s」" % self.city)
            return
        first = results[0]
        try:
            self.lat = float(first.get("latitude"))
            self.lon = float(first.get("longitude"))
        except (TypeError, ValueError):
            self.failed.emit("城市坐标解析失败")
            return
        name = first.get("name") or self.city
        self.city = name
        self.located.emit(self.lat, self.lon, name)
        self._forecast()

    def _handle_forecast(self, data):
        current = data.get("current") or {}
        daily = data.get("daily") or {}
        dates = daily.get("time") or []
        codes = daily.get("weather_code") or []
        highs = daily.get("temperature_2m_max") or []
        lows = daily.get("temperature_2m_min") or []

        def num(value, default=0):
            try:
                return round(float(value))
            except (TypeError, ValueError):
                return default

        days = []
        for index, day in enumerate(dates):
            days.append({
                "date": day,
                "code": int(codes[index]) if index < len(codes) and codes[index] is not None else 0,
                "hi": num(highs[index]) if index < len(highs) else 0,
                "lo": num(lows[index]) if index < len(lows) else 0,
            })
        if not days:
            self.failed.emit("暂无天气数据")
            return
        result = {
            "city": self.city,
            "lat": self.lat,
            "lon": self.lon,
            "current": {
                "temp": num(current.get("temperature_2m")),
                "code": int(current.get("weather_code") or 0),
                "humidity": num(current.get("relative_humidity_2m")),
                "wind": num(current.get("wind_speed_10m")),
            },
            "daily": days,
            "ts": time.time(),
        }
        self.updated.emit(result)
