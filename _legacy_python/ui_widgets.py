"""界面组件：玻璃卡片、待办行、天气卡、日历卡。"""
from __future__ import annotations

import datetime as dt
import math

from PySide6.QtCore import QPointF, QRect, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import (
    QBrush, QColor, QFont, QFontMetrics, QLinearGradient, QPainter, QPainterPath,
    QPen, QRadialGradient,
)
from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QLineEdit, QPushButton, QScrollArea, QSizePolicy,
    QStackedLayout, QVBoxLayout, QWidget,
)

from services import due_state, parse_dt, weather_info

# ---------------------------------------------------------------- theme ---
TEXT = QColor("#EAF1FF")
DIM = QColor("#A4B6D6")
FAINT = QColor("#6E809F")
ACCENT = QColor("#5B8CFF")
GREEN = QColor("#34D399")
AMBER = QColor("#FBBF3C")
RED = QColor("#F87171")
TAG_COLORS = ["#F59E0B", "#34D399", "#8B5CF6", "#38BDF8", "#F472B6", "#2DD4BF"]

FONT_FAMILY = "Microsoft YaHei UI"


class Theme:
    opacity = 0.82
    bg_image = ""
    bg_mode = "fill"


def make_font(size, weight=QFont.Weight.Normal, family=FONT_FAMILY):
    f = QFont(family)
    f.setPixelSize(int(size))
    f.setWeight(weight)
    return f


def with_alpha(color, alpha):
    c = QColor(color)
    c.setAlpha(max(0, min(255, int(alpha))))
    return c


# --------------------------------------------------------------- icons ---
def draw_icon(painter, kind, rect, color, width=None):
    """线性图标，统一 1px 半圆头风格。"""
    painter.save()
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    r = QRectF(rect)
    w = width if width is not None else max(1.2, min(r.width(), r.height()) * 0.15)
    pen = QPen(color, w)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    left, top, rw, rh = r.left(), r.top(), r.width(), r.height()

    if kind == "check":
        path = QPainterPath(QPointF(left + rw * 0.14, top + rh * 0.54))
        path.lineTo(left + rw * 0.40, top + rh * 0.80)
        path.lineTo(left + rw * 0.88, top + rh * 0.22)
        painter.drawPath(path)
    elif kind == "close":
        m = 0.30
        painter.drawLine(QPointF(left + rw * m, top + rh * m),
                         QPointF(left + rw * (1 - m), top + rh * (1 - m)))
        painter.drawLine(QPointF(left + rw * (1 - m), top + rh * m),
                         QPointF(left + rw * m, top + rh * (1 - m)))
    elif kind == "pin":
        painter.drawLine(QPointF(left + rw * 0.20, top + rh * 0.16),
                         QPointF(left + rw * 0.80, top + rh * 0.16))
        painter.drawLine(QPointF(left + rw * 0.50, top + rh * 0.20),
                         QPointF(left + rw * 0.50, top + rh * 0.56))
        path = QPainterPath(QPointF(left + rw * 0.28, top + rh * 0.56))
        path.lineTo(left + rw * 0.72, top + rh * 0.56)
        path.lineTo(QPointF(left + rw * 0.50, top + rh * 0.88))
        path.closeSubpath()
        painter.setBrush(color)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawPath(path)
    elif kind == "clock":
        painter.drawEllipse(QPointF(left + rw / 2, top + rh / 2), rw * 0.38, rh * 0.38)
        painter.drawLine(QPointF(left + rw * 0.50, top + rh * 0.50),
                         QPointF(left + rw * 0.50, top + rh * 0.28))
        painter.drawLine(QPointF(left + rw * 0.50, top + rh * 0.52),
                         QPointF(left + rw * 0.68, top + rh * 0.62))
    elif kind == "sliders":
        ys = (0.26, 0.50, 0.74)
        knobs = (0.38, 0.64, 0.46)
        for y, x in zip(ys, knobs):
            painter.drawLine(QPointF(left + rw * 0.12, top + rh * y),
                             QPointF(left + rw * 0.88, top + rh * y))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        for y, x in zip(ys, knobs):
            painter.drawEllipse(QPointF(left + rw * x, top + rh * y), rw * 0.13, rw * 0.13)
    elif kind == "chevron_left":
        path = QPainterPath(QPointF(left + rw * 0.62, top + rh * 0.22))
        path.lineTo(left + rw * 0.38, top + rh * 0.50)
        path.lineTo(left + rw * 0.62, top + rh * 0.78)
        painter.drawPath(path)
    elif kind == "chevron_right":
        path = QPainterPath(QPointF(left + rw * 0.38, top + rh * 0.22))
        path.lineTo(left + rw * 0.62, top + rh * 0.50)
        path.lineTo(left + rw * 0.38, top + rh * 0.78)
        painter.drawPath(path)
    elif kind == "plus":
        painter.drawLine(QPointF(left + rw * 0.50, top + rh * 0.18),
                         QPointF(left + rw * 0.50, top + rh * 0.82))
        painter.drawLine(QPointF(left + rw * 0.18, top + rh * 0.50),
                         QPointF(left + rw * 0.82, top + rh * 0.50))
    painter.restore()


def _cloud_path(rect):
    left, top, rw, rh = rect.left(), rect.top(), rect.width(), rect.height()
    path = QPainterPath()
    path.addEllipse(QRectF(left + rw * 0.06, top + rh * 0.42, rw * 0.46, rh * 0.46))
    path.addEllipse(QRectF(left + rw * 0.28, top + rh * 0.16, rw * 0.50, rh * 0.60))
    path.addEllipse(QRectF(left + rw * 0.56, top + rh * 0.38, rw * 0.38, rh * 0.42))
    path.addRect(QRectF(left + rw * 0.10, top + rh * 0.60, rw * 0.78, rh * 0.26))
    return path.simplified()


def _draw_sun(painter, rect, color, rays=True):
    cx, cy = rect.center().x(), rect.center().y()
    radius = min(rect.width(), rect.height()) * 0.21
    painter.setPen(Qt.PenStyle.NoPen)
    painter.setBrush(color)
    painter.drawEllipse(QPointF(cx, cy), radius, radius)
    if not rays:
        return
    pen = QPen(color, max(1.0, rect.width() * 0.08))
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    painter.setPen(pen)
    for i in range(8):
        angle = math.radians(i * 45)
        inner = radius * 1.55
        outer = radius * 2.15
        painter.drawLine(
            QPointF(cx + math.cos(angle) * inner, cy + math.sin(angle) * inner),
            QPointF(cx + math.cos(angle) * outer, cy + math.sin(angle) * outer),
        )


def draw_weather(painter, rect, code, color):
    """用矢量绘制天气图标，跨 DPI 清晰。"""
    kind = weather_info(code)[1]
    r = QRectF(rect)
    painter.save()
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

    if kind == "sun":
        _draw_sun(painter, r, color)
    elif kind == "suncloud":
        sun_rect = QRectF(r.left() + r.width() * 0.42, r.top() + r.height() * 0.02,
                          r.width() * 0.56, r.height() * 0.56)
        _draw_sun(painter, sun_rect, with_alpha(color, 220), rays=False)
        cloud = QRectF(r.left(), r.top() + r.height() * 0.28, r.width() * 0.86, r.height() * 0.66)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        painter.drawPath(_cloud_path(cloud))
    else:
        if kind == "cloud":
            cloud = r.adjusted(r.width() * 0.04, r.height() * 0.12, -r.width() * 0.04, -r.height() * 0.22)
        elif kind in ("rain", "snow", "thunder", "fog"):
            cloud = QRectF(r.left(), r.top(), r.width(), r.height() * 0.66)
        else:
            cloud = r
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        painter.drawPath(_cloud_path(cloud))

        pen = QPen(color, max(1.0, r.width() * 0.08))
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        if kind == "rain":
            for x in (0.30, 0.50, 0.70):
                painter.drawLine(QPointF(r.left() + r.width() * x, r.top() + r.height() * 0.72),
                                 QPointF(r.left() + r.width() * (x - 0.06), r.top() + r.height() * 0.94))
        elif kind == "snow":
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(color)
            for x, y in ((0.30, 0.82), (0.50, 0.92), (0.70, 0.80)):
                painter.drawEllipse(QPointF(r.left() + r.width() * x, r.top() + r.height() * y),
                                    r.width() * 0.055, r.width() * 0.055)
        elif kind == "thunder":
            bolt = QPainterPath(QPointF(r.left() + r.width() * 0.54, r.top() + r.height() * 0.66))
            bolt.lineTo(r.left() + r.width() * 0.38, r.top() + r.height() * 0.92)
            bolt.lineTo(r.left() + r.width() * 0.52, r.top() + r.height() * 0.90)
            bolt.lineTo(r.left() + r.width() * 0.44, r.top() + r.height() * 1.0)
            bolt.lineTo(r.left() + r.width() * 0.68, r.top() + r.height() * 0.80)
            bolt.lineTo(r.left() + r.width() * 0.53, r.top() + r.height() * 0.82)
            bolt.closeSubpath()
            painter.setBrush(color)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawPath(bolt)
        elif kind == "fog":
            for i, y in enumerate((0.76, 0.90)):
                painter.drawLine(QPointF(r.left() + r.width() * (0.18 + i * 0.06), r.top() + r.height() * y),
                                 QPointF(r.left() + r.width() * (0.82 - i * 0.06), r.top() + r.height() * y))
    painter.restore()


def draw_star(painter, rect, color):
    r = QRectF(rect)
    cx, cy = r.center().x(), r.center().y()
    outer = min(r.width(), r.height()) / 2
    inner = outer * 0.46
    path = QPainterPath()
    for i in range(10):
        angle = math.radians(-90 + i * 36)
        radius = outer if i % 2 == 0 else inner
        point = QPointF(cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)
        if i == 0:
            path.moveTo(point)
        else:
            path.lineTo(point)
    path.closeSubpath()
    painter.save()
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    painter.setPen(Qt.PenStyle.NoPen)
    painter.setBrush(color)
    painter.drawPath(path)
    painter.restore()


# -------------------------------------------------------------- widgets ---
class GlassCard(QWidget):
    def __init__(self, parent=None, radius=18):
        super().__init__(parent)
        self.radius = radius
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        path = QPainterPath()
        path.addRoundedRect(rect, self.radius, self.radius)
        opacity = Theme.opacity
        gradient = QLinearGradient(rect.topLeft(), rect.bottomLeft())
        gradient.setColorAt(0.0, QColor(34, 51, 92, int(213 * opacity)))
        gradient.setColorAt(1.0, QColor(10, 17, 34, int(226 * opacity)))
        painter.fillPath(path, QBrush(gradient))
        painter.setPen(QPen(QColor(255, 255, 255, int(24 * opacity)), 1))
        painter.drawPath(path)


class IconButton(QWidget):
    clicked = Signal()

    def __init__(self, kind, color=None, parent=None, size=20, ghost=False, active=False):
        super().__init__(parent)
        self.kind = kind
        self.color = QColor(color) if color else None
        self.ghost = ghost
        self.active = active
        self._hover = False
        self.setFixedSize(size, size)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    def set_active(self, active):
        if self.active != active:
            self.active = active
            self.update()

    def enterEvent(self, event):
        self._hover = True
        self.update()

    def leaveEvent(self, event):
        self._hover = False
        self.update()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and self.rect().contains(event.position().toPoint()):
            self.clicked.emit()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if self.ghost:
            if self._hover or self.active:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor(255, 255, 255, 30 if self.active else 18))
                painter.drawEllipse(rect)
            color = QColor(TEXT) if (self._hover or self.active) else QColor(DIM)
        else:
            base = QColor(self.color) if self.color else QColor(DIM)
            if self._hover:
                base = base.lighter(118)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(base)
            painter.drawEllipse(rect)
            color = QColor(255, 255, 255, 245)
        inset = rect.width() * (0.27 if self.kind != "pin" else 0.24)
        draw_icon(painter, self.kind, rect.adjusted(inset, inset, -inset, -inset), color,
                  width=max(1.2, rect.width() * 0.075))


class PillButton(QWidget):
    clicked = Signal()

    def __init__(self, icon_kind, text="", parent=None, height=30):
        super().__init__(parent)
        self.icon_kind = icon_kind
        self.weather_code = None
        self.active = False
        self._text = text
        self._hover = False
        self.setFixedHeight(height)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setFont(make_font(11.5, QFont.Weight.Medium))
        self._fit_width()

    def _fit_width(self):
        width = 12 + 18 + 10
        if self._text:
            width += 6 + self.fontMetrics().horizontalAdvance(self._text)
        self.setFixedWidth(max(38, width))

    def set_text(self, text):
        if text != self._text:
            self._text = text
            self._fit_width()
            self.update()

    def set_weather_code(self, code):
        self.weather_code = code
        self.update()

    def set_active(self, active):
        if self.active != active:
            self.active = active
            self.update()

    def enterEvent(self, event):
        self._hover = True
        self.update()

    def leaveEvent(self, event):
        self._hover = False
        self.update()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and self.rect().contains(event.position().toPoint()):
            self.clicked.emit()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if self._hover or self.active:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(255, 255, 255, 44 if self.active else 22))
            painter.drawRoundedRect(rect, rect.height() / 2, rect.height() / 2)
        icon_rect = QRectF(11, (rect.height() - 17) / 2 + 0.5, 17, 17)
        code = self.weather_code if self.weather_code is not None else 3
        draw_weather(painter, icon_rect.adjusted(1, 1, -1, -1), code,
                     TEXT if (self._hover or self.active) else QColor("#D7E2F7"))
        if self._text:
            painter.setFont(self.font())
            painter.setPen(TEXT if (self._hover or self.active) else QColor("#DCE6F9"))
            painter.drawText(QRectF(34, 0, rect.width() - 40, rect.height()),
                             Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, self._text)


class WeatherIcon(QWidget):
    def __init__(self, code=0, size=16, parent=None):
        super().__init__(parent)
        self._code = code
        self.setFixedSize(size, size)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    def set_code(self, code):
        self._code = code
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        draw_weather(painter, QRectF(self.rect()).adjusted(1, 1, -1, -1), self._code, QColor("#DCE7FB"))


class EditLine(QLineEdit):
    cancelled = Signal()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape:
            self.cancelled.emit()
            return
        super().keyPressEvent(event)


class TodoRow(QWidget):
    changed = Signal()
    delete_requested = Signal(object)
    edit_requested = Signal(object)
    due_requested = Signal(object, object)
    add_requested = Signal()

    def __init__(self, todo, parent=None):
        super().__init__(parent)
        self.todo = todo
        self._hover = False
        self._editing = False
        self._finished = False
        self._row_width = 0
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMinimumHeight(38)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(30, 8, 12, 8)
        layout.setSpacing(8)

        self.label = QLabel(todo.get("text", ""), self)
        self.label.setWordWrap(True)
        self.label.setFont(make_font(13))
        self.label.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
        layout.addWidget(self.label, 1)

        self.right_box = QWidget(self)
        self.right_box.setFixedWidth(100)
        self.right_box.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.right_stack = QStackedLayout(self.right_box)
        self.right_stack.setContentsMargins(0, 0, 0, 0)
        self.right_stack.setStackingMode(QStackedLayout.StackingMode.StackOne)

        self.due_label = QLabel("", self.right_box)
        self.due_label.setFont(make_font(10.5))
        self.due_label.setStyleSheet("color: #8FA3C6; background: transparent;")
        self.due_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        self.right_stack.addWidget(self.due_label)

        self.btn_box = QWidget(self.right_box)
        self.btn_box.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        button_layout = QHBoxLayout(self.btn_box)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(4)
        self.btn_done = IconButton("check", GREEN, self.btn_box, 20)
        self.btn_pin = IconButton("pin", AMBER, self.btn_box, 20)
        self.btn_due = IconButton("clock", QColor("#4C8DFF"), self.btn_box, 20)
        self.btn_delete = IconButton("close", RED, self.btn_box, 20)
        for button in (self.btn_done, self.btn_pin, self.btn_due, self.btn_delete):
            button_layout.addWidget(button)
        button_layout.addStretch(1)
        self.right_stack.addWidget(self.btn_box)
        self.right_stack.setCurrentWidget(self.due_label)
        layout.addWidget(self.right_box, 0)

        self._edit = None
        self._sync_right()
        self._apply_style()
        self._wire()

    # ---- state --------------------------------------------------------
    def _wire(self):
        self.btn_done.clicked.connect(self._toggle_done)
        self.btn_pin.clicked.connect(self._toggle_pin)
        self.btn_delete.clicked.connect(lambda: self.delete_requested.emit(self.todo))
        self.btn_due.clicked.connect(lambda: self.due_requested.emit(self.todo, self.btn_due))
        self._update_due()

    def _apply_style(self):
        done = self.todo.get("done")
        font = make_font(13)
        font.setStrikeOut(bool(done))
        self.label.setFont(font)
        self.label.setStyleSheet(
            "color: %s; background: transparent;" % ("#7F91B0" if done else "#EAF1FF")
        )
        self.btn_pin.set_active(bool(self.todo.get("pinned")))
        self.btn_done.set_active(bool(done))

    def _update_due(self):
        due = parse_dt(self.todo.get("due"))
        if due is None:
            self.due_label.setText("")
            self.btn_due.set_active(False)
            self.btn_due.setToolTip("设置结束时间")
        else:
            self.due_label.setText(due.strftime("%m月%d日 %H:%M"))
            self.btn_due.set_active(True)
            self.btn_due.setToolTip("结束时间：%s" % due.strftime("%Y-%m-%d %H:%M"))
        self.btn_done.setToolTip("取消完成" if self.todo.get("done") else "标记完成")
        self.btn_pin.setToolTip("取消置顶" if self.todo.get("pinned") else "置顶")
        self.btn_delete.setToolTip("删除")
        self._sync_right()
        if self._row_width:
            self.set_row_width(self._row_width)

    def _sync_right(self):
        self.right_stack.setCurrentWidget(self.btn_box if self._hover else self.due_label)

    def set_row_width(self, width):
        self._row_width = width
        text_w = max(80, width - 30 - 12 - 8 - self.right_box.width())
        self.label.setFixedWidth(text_w)
        height = self.label.heightForWidth(text_w)
        if height <= 0:
            height = QFontMetrics(self.label.font()).height()
        self.setFixedHeight(max(38, height + 16))

    def refresh(self):
        self.label.setText(self.todo.get("text", ""))
        self._apply_style()
        self._update_due()
        self.update()

    # ---- actions ------------------------------------------------------
    def _toggle_done(self):
        self.todo["done"] = not self.todo.get("done")
        self._apply_style()
        self.changed.emit()

    def _toggle_pin(self):
        self.todo["pinned"] = not self.todo.get("pinned")
        self._apply_style()
        self.changed.emit()

    def change_due(self, due_iso):
        self.todo["due"] = due_iso
        self._update_due()
        self.changed.emit()

    # ---- editing ------------------------------------------------------
    def start_edit(self):
        if self._editing or self._edit is not None:
            return
        self._editing = True
        edit = EditLine(self.todo.get("text", ""), self)
        edit.setFont(make_font(13))
        edit.setStyleSheet(
            "QLineEdit { background: rgba(255,255,255,0.10); border: 1px solid #5B8CFF;"
            " border-radius: 6px; padding: 2px 8px; color: #FFFFFF; }"
        )
        edit.setMinimumHeight(24)
        edit.selectAll()
        layout = self.layout()
        layout.insertWidget(0, edit, 1)
        self.label.hide()
        self.btn_box.hide()
        self.due_label.hide()
        self._edit = edit
        self._finished = False
        edit.returnPressed.connect(self._finish_edit)
        edit.editingFinished.connect(self._finish_edit)
        edit.cancelled.connect(self._cancel_edit)
        edit.setFocus()

    def _cancel_edit(self):
        self._finished = True
        self._close_edit()

    def _finish_edit(self):
        if self._finished or self._edit is None:
            return
        self._finished = True
        text = self._edit.text().strip()
        self._close_edit()
        if not text:
            if self.todo.get("text"):
                self.delete_requested.emit(self.todo)
            return
        if text != self.todo.get("text"):
            self.todo["text"] = text
            self.label.setText(text)
            self.changed.emit()
        self._update_due()

    def _close_edit(self):
        edit = self._edit
        self._edit = None
        self._editing = False
        if edit is not None:
            self.layout().removeWidget(edit)
            edit.hide()
            edit.deleteLater()
        self.label.show()
        self._hover = self.rect().contains(self.mapFromGlobal(self.cursor().pos()))
        self._update_due()

    # ---- hover / mouse ------------------------------------------------
    def _set_hover(self, hover):
        if self._hover == hover:
            return
        self._hover = hover
        self._sync_right()
        self.update()

    def enterEvent(self, event):
        self._set_hover(True)

    def leaveEvent(self, event):
        QTimer.singleShot(0, self._recheck_hover)

    def _recheck_hover(self):
        pos = self.mapFromGlobal(self.cursor().pos())
        self._set_hover(self.rect().contains(pos))

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.edit_requested.emit(self.todo)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and not self._editing:
            event.ignore()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if self._hover:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(255, 255, 255, 14))
            painter.drawRoundedRect(rect, 9, 9)
        # 状态原点
        state = due_state(self.todo)
        done = self.todo.get("done")
        cx, cy = 16.0, rect.center().y()
        painter.setPen(Qt.PenStyle.NoPen)
        if done:
            painter.setBrush(QColor(255, 255, 255, 90))
            painter.drawEllipse(QPointF(cx, cy), 3.4, 3.4)
        elif state == "overdue":
            draw_star(painter, QRectF(cx - 6, cy - 6, 12, 12), RED)
        elif state == "soon":
            painter.setBrush(AMBER)
            painter.drawRoundedRect(QRectF(cx - 4.5, cy - 4.5, 9, 9), 2, 2)
        else:
            painter.setBrush(QColor(255, 255, 255, 235))
            painter.drawEllipse(QPointF(cx, cy), 3.4, 3.4)


class AddRow(QWidget):
    submitted = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hover = False
        self._edit = None
        self.setFixedHeight(34)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self._font = make_font(12)

    def start_edit(self):
        if self._edit is not None:
            self._edit.setFocus()
            return
        edit = EditLine(self)
        edit.setFont(make_font(13))
        edit.setPlaceholderText("输入待办内容，回车保存")
        edit.setStyleSheet(
            "QLineEdit { background: rgba(255,255,255,0.09); border: 1px solid rgba(91,140,255,0.75);"
            " border-radius: 8px; padding: 5px 10px; color: #FFFFFF; }"
        )
        edit.setGeometry(30, 3, self.width() - 40, 28)
        edit.editingFinished.connect(self._commit)
        edit.cancelled.connect(self._cancel)
        self._edit = edit
        self._hover = True
        edit.show()
        edit.setFocus()
        self.update()

    def _commit(self):
        edit = self._edit
        if edit is None:
            return
        text = edit.text().strip()
        if text:
            self.submitted.emit(text)
            edit.clear()
            edit.setFocus()
        else:
            self._cancel()

    def _cancel(self):
        edit = self._edit
        self._edit = None
        if edit is not None:
            edit.hide()
            edit.deleteLater()
        self._hover = self.rect().contains(self.mapFromGlobal(self.cursor().pos()))
        self.update()

    def enterEvent(self, event):
        self._hover = True
        self.update()

    def leaveEvent(self, event):
        if self._edit is None:
            self._hover = False
            self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.start_edit()

    def resizeEvent(self, event):
        if self._edit is not None:
            self._edit.setGeometry(30, 3, self.width() - 40, 28)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if self._hover and self._edit is None:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(255, 255, 255, 12))
            painter.drawRoundedRect(rect, 9, 9)
        if self._edit is None:
            color = TEXT if self._hover else QColor("#7D8FB0")
            draw_icon(painter, "plus", QRectF(8, (rect.height() - 13) / 2, 13, 13), color)
            painter.setFont(self._font)
            painter.setPen(color)
            painter.drawText(QRectF(28, 0, rect.width() - 34, rect.height()),
                             Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, "添加待办")


class WeatherCard(GlassCard):
    def __init__(self, parent=None):
        super().__init__(parent, radius=18)
        self.setFixedWidth(250)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._data = None
        self._status = ""

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 14)
        layout.setSpacing(6)

        top = QHBoxLayout()
        top.setSpacing(6)
        self.time_label = QLabel("--:--")
        self.time_label.setFont(make_font(34, QFont.Weight.Light, "Segoe UI Light"))
        self.time_label.setStyleSheet("color: #F2F7FF; background: transparent;")
        self.temp_label = QLabel("--°")
        self.temp_label.setFont(make_font(28, QFont.Weight.Light, "Segoe UI Light"))
        self.temp_label.setStyleSheet("color: #F2F7FF; background: transparent;")
        self.temp_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        top.addWidget(self.time_label)
        top.addStretch(1)
        top.addWidget(self.temp_label)
        layout.addLayout(top)

        self.date_label = QLabel("")
        self.date_label.setFont(make_font(12))
        self.date_label.setStyleSheet("color: #A8B9D8; background: transparent;")
        layout.addWidget(self.date_label)

        condition = QHBoxLayout()
        condition.setSpacing(8)
        self.cond_icon = WeatherIcon(0, 18)
        self.cond_label = QLabel("等待天气数据…")
        self.cond_label.setFont(make_font(12.5))
        self.cond_label.setStyleSheet("color: #DCE7FB; background: transparent;")
        self.range_label = QLabel("")
        self.range_label.setFont(make_font(12))
        self.range_label.setStyleSheet("color: #A8B9D8; background: transparent;")
        self.range_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        condition.addWidget(self.cond_icon)
        condition.addWidget(self.cond_label)
        condition.addStretch(1)
        condition.addWidget(self.range_label)
        layout.addLayout(condition)

        divider = QWidget()
        divider.setFixedHeight(1)
        divider.setStyleSheet("background: rgba(255,255,255,0.10);")
        layout.addSpacing(4)
        layout.addWidget(divider)
        layout.addSpacing(2)

        self.forecast_layout = QVBoxLayout()
        self.forecast_layout.setSpacing(2)
        self.forecast_rows = []
        for _ in range(7):
            row = _ForecastRow()
            row.hide()
            self.forecast_rows.append(row)
            self.forecast_layout.addWidget(row)
        layout.addLayout(self.forecast_layout)
        layout.addStretch(1)

        self.status_label = QLabel("")
        self.status_label.setFont(make_font(10.5))
        self.status_label.setStyleSheet("color: #7086A8; background: transparent;")
        layout.addWidget(self.status_label)

        self.set_time(dt.datetime.now())

    def set_time(self, now):
        self.time_label.setText(now.strftime("%H:%M"))
        week = "一二三四五六日"[now.weekday()]
        self.date_label.setText(now.strftime("%m月%d日") + "  星期" + week)

    def set_status(self, text):
        self.status_label.setText(text)

    def set_weather(self, data):
        self._data = data
        current = data.get("current") or {}
        daily = data.get("daily") or []
        self.temp_label.setText("%d°" % int(current.get("temp", 0)))
        self.cond_icon.set_code(current.get("code", 0))
        self.cond_label.setText(weather_info(current.get("code", 0))[0])
        if daily:
            self.range_label.setText("%d° / %d°" % (daily[0]["hi"], daily[0]["lo"]))
        for index, row in enumerate(self.forecast_rows):
            if index < len(daily):
                row.set_day(daily[index])
                row.show()
            else:
                row.hide()
        self.status_label.setText("%s · 更新于 %s" % (
            data.get("city", ""), dt.datetime.fromtimestamp(data.get("ts", 0)).strftime("%H:%M")))
        self.cond_icon.show()
        self.cond_label.show()


class _ForecastRow(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(25)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        self.day_label = QLabel("")
        self.day_label.setFont(make_font(11.5))
        self.day_label.setStyleSheet("color: #B8C7E2; background: transparent;")
        self.day_label.setFixedWidth(64)
        self.icon = WeatherIcon(0, 15)
        self.text_label = QLabel("")
        self.text_label.setFont(make_font(11.5))
        self.text_label.setStyleSheet("color: #DCE7FB; background: transparent;")
        self.temp_label = QLabel("")
        self.temp_label.setFont(make_font(11.5))
        self.temp_label.setStyleSheet("color: #B8C7E2; background: transparent;")
        self.temp_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        layout.addWidget(self.day_label)
        layout.addWidget(self.icon)
        layout.addWidget(self.text_label, 1)
        layout.addWidget(self.temp_label)

    def set_day(self, day):
        try:
            date = dt.date.fromisoformat(day["date"])
            self.day_label.setText("%d月%d日" % (date.month, date.day))
        except (ValueError, KeyError):
            self.day_label.setText(day.get("date", ""))
        self.icon.set_code(day.get("code", 0))
        self.text_label.setText(weather_info(day.get("code", 0))[0])
        self.temp_label.setText("%d° / %d°" % (day.get("hi", 0), day.get("lo", 0)))


# ------------------------------------------------------------- calendar ---
def _tag_color(todo):
    key = todo.get("id") or todo.get("text", "")
    value = sum(ord(ch) * (i + 1) for i, ch in enumerate(key))
    return QColor(TAG_COLORS[value % len(TAG_COLORS)])


class CalendarGrid(QWidget):
    CELL_H = 48

    def __init__(self, parent=None):
        super().__init__(parent)
        self._first = dt.date.today().replace(day=1)
        self._rows = 6
        self._events = {}
        self._weather = {}
        self._hover_date = None
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setMouseTracking(True)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self._refresh_height()

    def set_month(self, first_day):
        self._first = first_day.replace(day=1)
        self._refresh_height()
        self.update()

    def set_data(self, todos, daily):
        events = {}
        for todo in todos:
            due = parse_dt(todo.get("due"))
            if due is None:
                continue
            events.setdefault(due.date(), []).append((due, todo))
        for items in events.values():
            items.sort(key=lambda pair: pair[0])
        self._events = events
        self._weather = {}
        for day in daily or []:
            try:
                self._weather[dt.date.fromisoformat(day["date"])] = day.get("code", 0)
            except (ValueError, KeyError, TypeError):
                continue
        self.update()

    def _refresh_height(self):
        days_in_month = (self._first.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        lead = self._first.weekday()
        self._rows = 5 if (lead + days_in_month.day) <= 35 else 6
        self.setFixedHeight(self._rows * self.CELL_H)

    def _cell_dates(self):
        start = self._first - dt.timedelta(days=self._first.weekday())
        for row in range(self._rows):
            for col in range(7):
                yield row, col, start + dt.timedelta(days=row * 7 + col)

    def mouseMoveEvent(self, event):
        cell_w = self.width() / 7
        row = int(event.position().y() // self.CELL_H)
        col = int(event.position().x() // cell_w) if cell_w else 0
        if 0 <= row < self._rows and 0 <= col < 7:
            date = self._first - dt.timedelta(days=self._first.weekday()) + dt.timedelta(days=row * 7 + col)
        else:
            date = None
        if date != self._hover_date:
            self._hover_date = date
            self.update()

    def leaveEvent(self, event):
        self._hover_date = None
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        width = self.width()
        cell_w = width / 7
        today = dt.date.today()
        font_day = make_font(11)
        font_tag = make_font(9)
        metrics = QFontMetrics(font_tag)
        month = self._first.month

        for row, col, date in self._cell_dates():
            x = col * cell_w
            y = row * self.CELL_H
            rect = QRectF(x + 2, y + 1, cell_w - 4, self.CELL_H - 3)
            in_month = date.month == month
            if date == today:
                painter.setPen(QPen(QColor(91, 140, 255, 170), 1))
                painter.setBrush(QColor(91, 140, 255, 40))
                painter.drawRoundedRect(rect, 9, 9)
            elif self._hover_date == date and in_month:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor(255, 255, 255, 12))
                painter.drawRoundedRect(rect, 9, 9)

            painter.setFont(font_day)
            painter.setPen(TEXT if in_month else with_alpha(FAINT, 150))
            painter.drawText(QRectF(x + 8, y + 5, 24, 16),
                             Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                             str(date.day))

            if in_month and date in self._weather:
                draw_weather(painter, QRectF(x + cell_w - 23, y + 6, 15, 15),
                             self._weather[date], QColor("#CBD9F3"))

            if not in_month:
                continue
            items = self._events.get(date, [])
            if not items:
                continue
            tag_x = x + 5
            tag_w = cell_w - 10
            tag_y = y + 23
            for due, todo in items[:2]:
                color = _tag_color(todo)
                if todo.get("done"):
                    color = QColor(110, 124, 150)
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(with_alpha(color, 225))
                painter.drawRoundedRect(QRectF(tag_x, tag_y, tag_w, 12), 3, 3)
                painter.setFont(font_tag)
                painter.setPen(QColor(255, 255, 255, 245))
                text = "%s %s" % (due.strftime("%H:%M"), todo.get("text", ""))
                text = metrics.elidedText(text, Qt.TextElideMode.ElideRight, int(tag_w) - 8)
                painter.drawText(QRectF(tag_x + 4, tag_y, tag_w - 8, 12),
                                 Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, text)
                tag_y += 13.5
            if len(items) > 2:
                painter.setFont(make_font(8.5))
                painter.setPen(QColor("#93A7C9"))
                painter.drawText(QRectF(tag_x, tag_y - 1, tag_w, 11),
                                 Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                                 "+%d" % (len(items) - 2))


class CalendarCard(GlassCard):
    month_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent, radius=18)
        self._todos = []
        self._daily = []
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(4)

        head = QHBoxLayout()
        head.setSpacing(6)
        self.month_label = QLabel("")
        self.month_label.setFont(make_font(14, QFont.Weight.DemiBold))
        self.month_label.setStyleSheet("color: #EAF1FF; background: transparent;")
        head.addWidget(self.month_label)
        head.addStretch(1)
        self.btn_prev = IconButton("chevron_left", None, self, 24, ghost=True)
        self.btn_next = IconButton("chevron_right", None, self, 24, ghost=True)
        self.btn_today = QPushButton("今天", self)
        self.btn_today.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_today.setFixedHeight(24)
        self.btn_today.setStyleSheet(
            "QPushButton { color: #C9D8F2; background: rgba(255,255,255,0.07);"
            " border: 1px solid rgba(255,255,255,0.10); border-radius: 12px;"
            " padding: 0 10px; font-size: 11px; }"
            "QPushButton:hover { background: rgba(255,255,255,0.14); color: #FFFFFF; }"
        )
        head.addWidget(self.btn_prev)
        head.addWidget(self.btn_next)
        head.addWidget(self.btn_today)
        layout.addLayout(head)

        week = QHBoxLayout()
        week.setSpacing(0)
        for index, name in enumerate("一二三四五六日"):
            label = QLabel(name)
            label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            label.setFont(make_font(10.5))
            label.setStyleSheet("color: %s; background: transparent;" % ("#6E809F" if index >= 5 else "#8FA3C6"))
            week.addWidget(label, 1)
        layout.addLayout(week)

        self.grid = CalendarGrid(self)
        layout.addWidget(self.grid)

        self.set_month(dt.date.today().replace(day=1))
        self.btn_prev.clicked.connect(self._prev_month)
        self.btn_next.clicked.connect(self._next_month)
        self.btn_today.clicked.connect(self._this_month)

    def set_month(self, first_day):
        self.grid.set_month(first_day)
        self.month_label.setText("%d年%d月" % (first_day.year, first_day.month))
        self.updateGeometry()
        self.month_changed.emit()

    def set_data(self, todos, daily):
        self._todos = todos
        self._daily = daily
        self.grid.set_data(todos, daily)

    def _prev_month(self):
        first = self.grid._first
        prev = (first - dt.timedelta(days=1)).replace(day=1)
        self.set_month(prev)

    def _next_month(self):
        first = self.grid._first
        nxt = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        self.set_month(nxt)

    def _this_month(self):
        self.set_month(dt.date.today().replace(day=1))


# ------------------------------------------------------------ due popup ---
class DuePopup(QWidget):
    submitted = Signal(str)

    def __init__(self, todo, parent=None):
        super().__init__(parent, Qt.WindowType.Popup | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setFixedWidth(276)
        self.todo = todo

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(10)

        title = QLabel("结束时间")
        title.setFont(make_font(12.5, QFont.Weight.DemiBold))
        title.setStyleSheet("color: #EAF1FF; background: transparent;")
        layout.addWidget(title)

        chips = QHBoxLayout()
        chips.setSpacing(6)
        now = dt.datetime.now()
        quick = [
            ("今天 18:00", now.replace(hour=18, minute=0, second=0, microsecond=0)),
            ("明天 09:00", (now + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)),
        ]
        for text, value in quick:
            chip = QPushButton(text, self)
            chip.setCursor(Qt.CursorShape.PointingHandCursor)
            chip.setFixedHeight(24)
            chip.setStyleSheet(
                "QPushButton { color: #C9D8F2; background: rgba(255,255,255,0.07);"
                " border: 1px solid rgba(255,255,255,0.10); border-radius: 12px;"
                " padding: 0 10px; font-size: 11px; }"
                "QPushButton:hover { background: rgba(255,255,255,0.16); color: #FFFFFF; }"
            )
            chip.clicked.connect(lambda _=False, v=value: self.edit.setDateTime(v))
            chips.addWidget(chip)
        chips.addStretch(1)
        layout.addLayout(chips)

        from PySide6.QtWidgets import QDateTimeEdit
        self.edit = QDateTimeEdit(self)
        due = parse_dt(todo.get("due")) or (now + dt.timedelta(hours=1)).replace(second=0, microsecond=0)
        self.edit.setDateTime(due)
        self.edit.setDisplayFormat("yyyy-MM-dd  HH:mm")
        self.edit.setCalendarPopup(False)
        self.edit.setFixedHeight(34)
        self.edit.setFont(make_font(12.5))
        self.edit.setStyleSheet(
            "QDateTimeEdit { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);"
            " border-radius: 8px; padding: 4px 10px; color: #EAF1FF; }"
            "QDateTimeEdit::up-button, QDateTimeEdit::down-button { width: 0px; border: none; }"
            "QDateTimeEdit::drop-down { width: 0px; border: none; }"
        )
        layout.addWidget(self.edit)

        buttons = QHBoxLayout()
        buttons.setSpacing(8)
        clear = QPushButton("清除", self)
        clear.setCursor(Qt.CursorShape.PointingHandCursor)
        clear.setFixedHeight(30)
        clear.setStyleSheet(
            "QPushButton { color: #A8B9D8; background: transparent; border: 1px solid rgba(255,255,255,0.14);"
            " border-radius: 8px; padding: 0 14px; font-size: 12px; }"
            "QPushButton:hover { color: #FFFFFF; background: rgba(255,255,255,0.08); }"
        )
        ok = QPushButton("确定", self)
        ok.setCursor(Qt.CursorShape.PointingHandCursor)
        ok.setFixedHeight(30)
        ok.setStyleSheet(
            "QPushButton { color: #FFFFFF; background: #4C8DFF; border: none;"
            " border-radius: 8px; padding: 0 16px; font-size: 12px; }"
            "QPushButton:hover { background: #6AA0FF; }"
        )
        buttons.addWidget(clear)
        buttons.addStretch(1)
        buttons.addWidget(ok)
        layout.addLayout(buttons)

        clear.clicked.connect(self._clear)
        ok.clicked.connect(self._ok)

    def _clear(self):
        self.submitted.emit("")
        self.close()

    def _ok(self):
        value = self.edit.dateTime().toPython().replace(second=0, microsecond=0)
        self.submitted.emit(value.isoformat(timespec="minutes"))
        self.close()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        path = QPainterPath()
        path.addRoundedRect(rect, 14, 14)
        painter.fillPath(path, QBrush(QColor(18, 28, 52, 248)))
        painter.setPen(QPen(QColor(255, 255, 255, 30), 1))
        painter.drawPath(path)

    def show_for(self, anchor):
        self.adjustSize()
        point = anchor.mapToGlobal(anchor.rect().bottomLeft())
        point.setX(point.x() - self.width() + anchor.width())
        screen = self.screen().availableGeometry()
        x = max(screen.left() + 8, min(point.x(), screen.right() - self.width() - 8))
        y = point.y() + 6
        if y + self.height() > screen.bottom() - 8:
            y = anchor.mapToGlobal(anchor.rect().topLeft()).y() - self.height() - 6
        self.move(x, y)
        self.show()
        self.edit.setFocus()
