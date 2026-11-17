"""桌面待办小工具 —— 主程序。"""
from __future__ import annotations

import datetime as dt
import os
import sys
import tempfile

from PySide6.QtCore import QLockFile, QPoint, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import (
    QColor, QFont, QIcon, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap,
    QRadialGradient,
)
from PySide6.QtWidgets import (
    QApplication, QFrame, QHBoxLayout, QLabel, QMenu, QScrollArea, QSystemTrayIcon,
    QVBoxLayout, QWidget,
)

from services import Store, WeatherService, sort_todos
from settings_dialog import SettingsDialog
from ui_widgets import (
    ACCENT, AddRow, CalendarCard, DIM, DuePopup, GlassCard, IconButton, PillButton,
    TEXT, Theme, TodoRow, WeatherCard, make_font,
)

MAIN_W = 400
MAIN_W_CALENDAR = 560
WEATHER_W = 250
GAP = 12
MARGIN = 12
CARD_MIN_H = 300


def make_icon(size=64):
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    gradient = QLinearGradient(0, 0, size, size)
    gradient.setColorAt(0, QColor("#6FA3FF"))
    gradient.setColorAt(1, QColor("#7C5CFF"))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.setBrush(gradient)
    painter.drawRoundedRect(QRectF(2, 2, size - 4, size - 4), size * 0.28, size * 0.28)
    pen = QPen(QColor(255, 255, 255), size * 0.085)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    path = QPainterPath(QPoint(size * 0.27, size * 0.52))
    path.lineTo(size * 0.44, size * 0.69)
    path.lineTo(size * 0.75, size * 0.34)
    painter.drawPath(path)
    painter.end()
    return QIcon(pixmap)


class ListHost(QWidget):
    empty_clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            if self.childAt(event.position().toPoint()) is None:
                self.empty_clicked.emit()


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)
        self.setWindowTitle("桌面待办")

        self.store = Store()
        self._rows = []
        self._daily = []
        self._bg_path = None
        self._bg_pix = QPixmap()
        self._bg_scaled = QPixmap()
        self._drag_offset = None
        self._weather_left = False
        self._settings_dialog = None
        self._position_ready = False
        self._tick_count = 0
        self._last_day = dt.date.today()
        self._due_popup = None

        self._build_ui()
        self._build_tray()
        self._apply_settings()
        self._rebuild_list()
        self._relayout()
        self._restore_position()
        self._apply_cached_weather()
        self._start_timers()

    # ------------------------------------------------------------ UI ----
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(MARGIN, MARGIN, MARGIN, MARGIN)
        root.setSpacing(10)

        self.top_row = QWidget()
        self.top_row.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.top_layout = QHBoxLayout(self.top_row)
        self.top_layout.setContentsMargins(0, 0, 0, 0)
        self.top_layout.setSpacing(GAP)

        self.main_col = QWidget()
        self.main_col.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        main_layout = QVBoxLayout(self.main_col)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        self.todo_card = GlassCard()
        self.todo_card.setMinimumHeight(CARD_MIN_H)
        card_layout = QVBoxLayout(self.todo_card)
        card_layout.setContentsMargins(0, 0, 0, 6)
        card_layout.setSpacing(0)

        # 顶部标题栏（同时作为拖动区）
        header = QWidget()
        header.setFixedHeight(48)
        header.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 8, 12, 8)
        header_layout.setSpacing(8)
        self.title_label = QLabel("待办清单")
        self.title_label.setFont(make_font(15, QFont.Weight.DemiBold))
        self.title_label.setStyleSheet("color: #EAF1FF; background: transparent;")
        self.count_label = QLabel("")
        self.count_label.setFont(make_font(11))
        self.count_label.setStyleSheet("color: #7E93B6; background: transparent;")
        self.weather_btn = PillButton("weather")
        self.weather_btn.setToolTip("显示 / 隐藏天气")
        self.weather_btn.clicked.connect(self.toggle_weather)
        self.settings_btn = IconButton("sliders", None, ghost=True, size=28)
        self.settings_btn.setToolTip("设置")
        self.settings_btn.clicked.connect(self.open_settings)
        header_layout.addWidget(self.title_label)
        header_layout.addWidget(self.count_label)
        header_layout.addStretch(1)
        header_layout.addWidget(self.weather_btn)
        header_layout.addWidget(self.settings_btn)
        card_layout.addWidget(header)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.scroll.viewport().setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.scroll.viewport().setAutoFillBackground(False)
        self.scroll.setStyleSheet(
            "QScrollArea { background: transparent; border: none; }"
            "QScrollArea > QWidget > QWidget { background: transparent; }"
            "QScrollBar:vertical { width: 6px; background: transparent; margin: 2px 0; }"
            "QScrollBar::handle:vertical { background: rgba(255,255,255,0.20); border-radius: 3px; min-height: 24px; }"
            "QScrollBar::handle:vertical:hover { background: rgba(255,255,255,0.34); }"
            "QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }"
            "QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }"
        )
        self.list_host = ListHost()
        self.list_layout = QVBoxLayout(self.list_host)
        self.list_layout.setContentsMargins(14, 0, 14, 2)
        self.list_layout.setSpacing(2)
        self.scroll.setWidget(self.list_host)
        card_layout.addWidget(self.scroll, 1)

        add_wrap = QWidget()
        add_wrap.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        add_layout = QHBoxLayout(add_wrap)
        add_layout.setContentsMargins(14, 0, 14, 2)
        add_layout.setSpacing(0)
        self.add_row = AddRow()
        self.add_row.submitted.connect(self._add_todo)
        add_layout.addWidget(self.add_row)
        card_layout.addWidget(add_wrap)
        self.list_host.empty_clicked.connect(self.add_row.start_edit)

        main_layout.addWidget(self.todo_card)
        self.top_layout.addWidget(self.main_col)

        self.weather_card = WeatherCard()
        self.weather_card.hide()
        self.top_layout.addWidget(self.weather_card)

        self.calendar_card = CalendarCard()
        self.calendar_card.hide()
        self.calendar_card.month_changed.connect(lambda: QTimer.singleShot(0, self._relayout))

        root.addWidget(self.top_row)
        root.addWidget(self.calendar_card)

    def _build_tray(self):
        self.tray = QSystemTrayIcon(make_icon(), self)
        self.tray.setToolTip("桌面待办")
        menu = QMenu()
        menu.setStyleSheet(
            "QMenu { background: #131E36; color: #E7EEFB; border: 1px solid rgba(255,255,255,0.10);"
            " border-radius: 8px; padding: 6px; }"
            "QMenu::item { padding: 6px 26px 6px 16px; border-radius: 5px; font-size: 12px; }"
            "QMenu::item:selected { background: rgba(91,140,255,0.30); }"
            "QMenu::separator { height: 1px; background: rgba(255,255,255,0.10); margin: 5px 8px; }"
        )
        show_action = menu.addAction("显示 / 隐藏")
        settings_action = menu.addAction("设置…")
        self.top_action = menu.addAction("窗口置顶")
        self.top_action.setCheckable(True)
        self.top_action.setChecked(bool(self.store.settings.get("always_on_top", True)))
        menu.addSeparator()
        quit_action = menu.addAction("退出")
        show_action.triggered.connect(self.toggle_visible)
        settings_action.triggered.connect(self.open_settings)
        self.top_action.toggled.connect(self._on_tray_top)
        quit_action.triggered.connect(self.quit_app)
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(self._on_tray_activated)
        self.tray.show()

    # ------------------------------------------------------- todos ------
    def _rebuild_list(self):
        while self.list_layout.count():
            item = self.list_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.hide()
                widget.deleteLater()
        self._rows = []
        todos = sort_todos(self.store.todos)
        for todo in todos:
            row = TodoRow(todo)
            row.set_row_width(self._row_width())
            row.changed.connect(self._on_row_changed)
            row.delete_requested.connect(self._delete_todo)
            row.edit_requested.connect(lambda _todo, r=row: r.start_edit())
            row.due_requested.connect(self._open_due_popup)
            self.list_layout.addWidget(row)
            self._rows.append(row)
        if not todos:
            hint = QLabel("暂无待办\n点击下方「添加待办」开始记录")
            hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
            hint.setFont(make_font(12))
            hint.setStyleSheet("color: #7286A8; background: transparent;")
            hint.setFixedHeight(96)
            hint.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            self.list_layout.addWidget(hint)
        self.list_layout.addStretch(1)
        done = sum(1 for todo in todos if todo.get("done"))
        self.count_label.setText("%d 项" % (len(todos) - done) if todos else "")
        self._refresh_calendar()

    def _row_width(self):
        return (MAIN_W_CALENDAR if self.calendar_card.isVisible() else MAIN_W) - 34

    def _on_row_changed(self):
        self.store.save()
        QTimer.singleShot(0, self._after_todo_change)

    def _after_todo_change(self):
        self._rebuild_list()
        self._relayout()

    def _add_todo(self, text):
        self.store.add_todo(text)
        self._rebuild_list()
        self._relayout()

        def _scroll_bottom():
            bar = self.scroll.verticalScrollBar()
            bar.setValue(bar.maximum())
        QTimer.singleShot(0, _scroll_bottom)

    def _delete_todo(self, todo):
        self.store.remove_todo(todo)
        self._rebuild_list()
        self._relayout()

    def _open_due_popup(self, todo, anchor):
        popup = DuePopup(todo, self)
        popup.submitted.connect(lambda value, t=todo: self._set_due(t, value))
        popup.move(self.mapToGlobal(QPoint(0, 0)))
        popup.show_for(anchor)
        self._due_popup = popup

    def _set_due(self, todo, value):
        todo["due"] = value or None
        self.store.save()
        for row in self._rows:
            if row.todo is todo:
                row.change_due(todo["due"])
                row.set_row_width(self._row_width())
        self._refresh_calendar()
        self._relayout()

    # ------------------------------------------------------ weather -----
    def _start_timers(self):
        self._clock_timer = QTimer(self)
        self._clock_timer.setInterval(1000)
        self._clock_timer.timeout.connect(self._tick)
        self._clock_timer.start()

        self._weather_timer = QTimer(self)
        self._weather_timer.setInterval(30 * 60 * 1000)
        self._weather_timer.timeout.connect(lambda: self.weather.refresh())
        self._weather_timer.start()

        self.weather = WeatherService(self)
        self.weather.updated.connect(self._on_weather)
        self.weather.failed.connect(self._on_weather_failed)
        self.weather.located.connect(self._on_located)
        settings = self.store.settings
        QTimer.singleShot(250, lambda: self.weather.set_city(
            settings.get("city") or "北京", settings.get("latitude"), settings.get("longitude")))

    def _apply_cached_weather(self):
        data = self.store.weather_cache
        if not isinstance(data, dict) or not data.get("daily"):
            return
        try:
            self._on_weather(data)
        except (KeyError, TypeError, ValueError):
            pass

    def _on_weather(self, data):
        self.store.weather_cache = data
        self._daily = data.get("daily") or []
        self.weather_card.set_weather(data)
        current = data.get("current") or {}
        self.weather_btn.set_weather_code(current.get("code", 0))
        self.weather_btn.set_text("%d°" % int(current.get("temp", 0)))
        self.weather_btn.setToolTip("%s · %s" % (data.get("city", ""), "点击显示/隐藏天气"))
        if data.get("lat") is not None:
            self.store.settings["latitude"] = data["lat"]
            self.store.settings["longitude"] = data["lon"]
        self.store.save()
        self._refresh_calendar()

    def _on_weather_failed(self, message):
        self.weather_card.set_status(message)

    def _on_located(self, lat, lon, city):
        self.store.settings["latitude"] = lat
        self.store.settings["longitude"] = lon
        if city:
            self.store.settings["city"] = city
        self.store.save()

    def _refresh_calendar(self):
        self.calendar_card.set_data(sort_todos(self.store.todos), self._daily)

    def _tick(self):
        now = dt.datetime.now()
        self.weather_card.set_time(now)
        self._tick_count += 1
        if now.date() != self._last_day:
            self._last_day = now.date()
            self._refresh_calendar()
            self.calendar_card.grid.update()
        if self._tick_count % 20 == 0:
            for row in self._rows:
                row.update()

    # ------------------------------------------------------- layout -----
    def _apply_settings(self, *_args):
        settings = self.store.settings
        Theme.opacity = max(0.2, min(1.0, float(settings.get("opacity", 0.82))))
        Theme.bg_mode = settings.get("bg_mode", "fill")
        path = settings.get("bg_image") or ""
        if path != self._bg_path:
            self._bg_path = path
            self._bg_pix = QPixmap(path) if path and os.path.exists(path) else QPixmap()
            self._bg_scaled = QPixmap()
        self._apply_window_flags()
        show_calendar = bool(settings.get("calendar"))
        if self.calendar_card.isVisible() != show_calendar:
            self.calendar_card.setVisible(show_calendar)
        for row in self._rows:
            row.set_row_width(self._row_width())
        for widget in self.findChildren(QWidget):
            widget.update()
        self.update()
        self._relayout()
        self.store.save()

    def _apply_window_flags(self):
        top = bool(self.store.settings.get("always_on_top", True))
        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if top:
            flags |= Qt.WindowType.WindowStaysOnTopHint
        if self.windowFlags() != flags:
            geometry = self.geometry()
            visible = self.isVisible()
            self.setWindowFlags(flags)
            if visible:
                self.show()
                self.setGeometry(geometry)

    def _update_scroll_height(self):
        if not self._rows:
            content = 96
        else:
            content = sum(row.height() for row in self._rows) + (len(self._rows) - 1) * 2 + 4
        max_height = 220 if self.calendar_card.isVisible() else 300
        self.scroll.setFixedHeight(min(content, max_height))

    def _relayout(self):
        calendar_on = self.calendar_card.isVisible()
        main_w = MAIN_W_CALENDAR if calendar_on else MAIN_W
        self.main_col.setFixedWidth(main_w)
        for row in self._rows:
            row.set_row_width(main_w - 34)
        self._update_scroll_height()

        self.todo_card.setMinimumHeight(CARD_MIN_H)
        todo_h = max(self.todo_card.sizeHint().height(), CARD_MIN_H)
        if self.weather_card.isVisible():
            min_h = max(CARD_MIN_H, self.weather_card.sizeHint().height())
            self.todo_card.setMinimumHeight(min_h)
            todo_h = max(self.todo_card.sizeHint().height(), min_h)
            self.weather_card.setFixedHeight(todo_h)
        else:
            self.weather_card.setMinimumHeight(0)

        self.layout().activate()
        width = 2 * MARGIN + main_w + ((WEATHER_W + GAP) if self.weather_card.isVisible() else 0)
        height = max(self.layout().sizeHint().height(), CARD_MIN_H + 2 * MARGIN)
        self.setFixedSize(width, height)
        self.weather_btn.set_active(self.weather_card.isVisible())
        self.update()
        for widget in self.findChildren(QWidget):
            widget.update()

    def _restore_position(self):
        screen = self.screen().availableGeometry() if self.screen() else \
            QApplication.primaryScreen().availableGeometry()
        x = self.store.settings.get("x")
        y = self.store.settings.get("y")
        if x is None or y is None:
            x = screen.left() + 40
            y = screen.top() + 40
        x = max(screen.left(), min(int(x), screen.right() - self.width() + 1))
        y = max(screen.top(), min(int(y), screen.bottom() - self.height() + 1))
        self.move(x, y)
        self._position_ready = True

    def _save_position(self):
        if not self._position_ready:
            return
        self.store.settings["x"] = self.x()
        self.store.settings["y"] = self.y()
        self.store.save()

    def moveEvent(self, event):
        super().moveEvent(event)
        if self._position_ready:
            if not hasattr(self, "_position_timer"):
                self._position_timer = QTimer(self)
                self._position_timer.setSingleShot(True)
                self._position_timer.setInterval(700)
                self._position_timer.timeout.connect(self._save_position)
            self._position_timer.start()

    # ------------------------------------------------------ weather UI --
    def toggle_weather(self, show=None):
        settings = self.store.settings
        visible = self.weather_card.isVisible()
        show = (not visible) if show is None else bool(show)
        if show == visible:
            return
        old_x = self.x()
        if show:
            screen = self.screen().availableGeometry()
            need = WEATHER_W + GAP
            right_space = screen.right() - (self.x() + self.width())
            left_space = self.x() - screen.left()
            self._weather_left = right_space < need and left_space > right_space
            if self._weather_left:
                self.top_layout.insertWidget(0, self.weather_card)
            else:
                self.top_layout.addWidget(self.weather_card)
            self.weather_card.show()
            self.weather_card.set_time(dt.datetime.now())
            self._relayout()
            if self._weather_left:
                self.move(old_x - need, self.y())
            if self.store.weather_cache:
                self.weather_card.set_weather(self.store.weather_cache)
        else:
            was_left = self._weather_left
            self.top_layout.removeWidget(self.weather_card)
            self.weather_card.hide()
            self._relayout()
            if was_left:
                self.move(old_x + WEATHER_W + GAP, self.y())
        settings["weather_open"] = show
        self.store.save()

    def open_settings(self):
        if self._settings_dialog is None:
            dialog = SettingsDialog(self.store.settings, self)
            dialog.changed.connect(self._apply_settings)
            dialog.city_changed.connect(self._on_city_changed)
            dialog.exit_requested.connect(self.quit_app)
            dialog.finished.connect(self._on_settings_closed)
            self._settings_dialog = dialog
        dialog = self._settings_dialog
        dialog.adjustSize()
        screen = self.screen().availableGeometry()
        x = min(self.mapToGlobal(QPoint(self.width() - dialog.width() - 16, 16)).x(),
                screen.right() - dialog.width() - 8)
        y = max(screen.top() + 8, self.mapToGlobal(QPoint(0, 16)).y())
        dialog.move(x, y)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _on_settings_closed(self, _result):
        self._settings_dialog = None

    def _on_city_changed(self, city):
        self.store.settings["city"] = city
        self.store.settings["latitude"] = None
        self.store.settings["longitude"] = None
        self.store.save()
        self.weather.set_city(city)
        if self.weather_card.isVisible():
            self.weather_card.set_status("正在获取天气…")

    # ---------------------------------------------------------- tray ----
    def _on_tray_activated(self, reason):
        if reason in (QSystemTrayIcon.ActivationReason.DoubleClick,
                      QSystemTrayIcon.ActivationReason.Trigger):
            self.toggle_visible()

    def toggle_visible(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()
            self.raise_()
            self.activateWindow()

    def _on_tray_top(self, checked):
        self.store.settings["always_on_top"] = bool(checked)
        self._apply_window_flags()
        self.store.save()

    def quit_app(self):
        self.store.save()
        self.tray.hide()
        QApplication.quit()

    # -------------------------------------------------------- painting --
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect())
        path = QPainterPath()
        path.addRoundedRect(rect, 22, 22)
        painter.setClipPath(path)
        opacity = max(0.2, min(1.0, Theme.opacity))

        if not self._bg_pix.isNull():
            painter.setOpacity(max(0.25, opacity))
            mode = self.store.settings.get("bg_mode", "fill")
            if mode == "tile":
                painter.drawTiledPixmap(self.rect(), self._bg_pix)
            elif mode == "stretch":
                painter.drawPixmap(self.rect(), self._bg_pix)
            else:
                scaled = self._scaled_background()
                x = max(0, (scaled.width() - self.width()) // 2)
                y = max(0, (scaled.height() - self.height()) // 2)
                painter.drawPixmap(0, 0, scaled, x, y, self.width(), self.height())
            painter.setOpacity(1.0)
            painter.fillRect(self.rect(), QColor(6, 12, 26, int(72 * opacity)))
        else:
            gradient = QLinearGradient(0, 0, 0, self.height())
            gradient.setColorAt(0.0, QColor(28, 50, 96, int(251 * opacity)))
            gradient.setColorAt(0.55, QColor(15, 27, 55, int(249 * opacity)))
            gradient.setColorAt(1.0, QColor(7, 12, 26, int(246 * opacity)))
            painter.fillRect(rect, gradient)
            glow = QRadialGradient(QPoint(self.width() * 0.85, 0), max(240, self.width() * 0.75))
            glow.setColorAt(0.0, QColor(99, 132, 255, int(74 * opacity)))
            glow.setColorAt(1.0, QColor(99, 132, 255, 0))
            painter.fillRect(rect, glow)
            glow2 = QRadialGradient(QPoint(self.width() * 0.08, self.height()),
                                    max(240, self.height() * 0.6))
            glow2.setColorAt(0.0, QColor(122, 92, 255, int(52 * opacity)))
            glow2.setColorAt(1.0, QColor(122, 92, 255, 0))
            painter.fillRect(rect, glow2)
        painter.setClipping(False)

    def _scaled_background(self):
        if self._bg_scaled.isNull() or self._bg_scaled.size() != self.size():
            self._bg_scaled = self._bg_pix.scaled(
                self.size(), Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation)
        return self._bg_scaled

    # ------------------------------------------------------- dragging ---
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_offset is not None and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_offset)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._drag_offset = None


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("桌面待办")
    app.setQuitOnLastWindowClosed(False)
    app.setStyle("Fusion")
    app.setWindowIcon(make_icon())
    app.setFont(make_font(12))

    lock = QLockFile(os.path.join(tempfile.gettempdir(), "desktop-todo-widget.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        print("桌面待办已在运行")
        return

    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
