"""设置窗口。"""
from __future__ import annotations

import os

from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QBrush, QColor, QFont, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import (
    QButtonGroup, QCheckBox, QDialog, QFileDialog, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QVBoxLayout, QWidget,
)

from ui_widgets import make_font


class ImageThumb(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._pix = QPixmap()
        self.setFixedSize(64, 44)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

    def set_path(self, path):
        self._pix = QPixmap(path) if path and os.path.exists(path) else QPixmap()
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        path = QPainterPath()
        path.addRoundedRect(rect, 8, 8)
        painter.setClipPath(path)
        if self._pix.isNull():
            painter.fillPath(path, QBrush(QColor(255, 255, 255, 12)))
            painter.setClipping(False)
            painter.setPen(QPen(QColor(255, 255, 255, 40), 1, Qt.PenStyle.DashLine))
            painter.drawPath(path)
            painter.setFont(make_font(10))
            painter.setPen(QColor("#7086A8"))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "无图片")
        else:
            scaled = self._pix.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                                      Qt.TransformationMode.SmoothTransformation)
            x = max(0, (scaled.width() - self.width()) // 2)
            y = max(0, (scaled.height() - self.height()) // 2)
            painter.drawPixmap(self.rect(), scaled, scaled.rect().adjusted(x, y, -x, -y))


class SettingsDialog(QDialog):
    changed = Signal()
    city_changed = Signal(str)
    exit_requested = Signal()

    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.settings = settings
        self._drag_pos = None
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setFixedWidth(448)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 18, 22, 18)
        layout.setSpacing(12)

        title_row = QHBoxLayout()
        title = QLabel("设置")
        title.setFont(make_font(16, QFont.Weight.DemiBold))
        title.setStyleSheet("color: #F2F7FF; background: transparent;")
        subtitle = QLabel("桌面待办")
        subtitle.setFont(make_font(11))
        subtitle.setStyleSheet("color: #7086A8; background: transparent;")
        title_row.addWidget(title)
        title_row.addWidget(subtitle)
        title_row.addStretch(1)
        layout.addLayout(title_row)

        layout.addWidget(self._section("外观"))
        layout.addLayout(self._opacity_row())
        layout.addLayout(self._image_row())
        layout.addLayout(self._mode_row())

        layout.addSpacing(4)
        layout.addWidget(self._section("功能"))
        self.calendar_check = self._checkbox("日历模式（在下方显示月历）", bool(settings.get("calendar")))
        self.calendar_check.toggled.connect(self._on_calendar)
        layout.addWidget(self.calendar_check)
        self.top_check = self._checkbox("窗口置顶显示", bool(settings.get("always_on_top")))
        self.top_check.toggled.connect(self._on_top)
        layout.addWidget(self.top_check)
        layout.addLayout(self._city_row())

        layout.addSpacing(6)
        footer = QHBoxLayout()
        quit_btn = QPushButton("退出程序")
        quit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        quit_btn.setFixedHeight(32)
        quit_btn.setStyleSheet(
            "QPushButton { color: #F08A8A; background: transparent; border: 1px solid rgba(240,138,138,0.35);"
            " border-radius: 8px; padding: 0 14px; font-size: 12px; }"
            "QPushButton:hover { background: rgba(240,138,138,0.12); }"
        )
        done_btn = QPushButton("完成")
        done_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        done_btn.setFixedHeight(32)
        done_btn.setStyleSheet(
            "QPushButton { color: #FFFFFF; background: #4C8DFF; border: none;"
            " border-radius: 8px; padding: 0 22px; font-size: 12.5px; }"
            "QPushButton:hover { background: #6AA0FF; }"
        )
        done_btn.clicked.connect(self.accept)
        quit_btn.clicked.connect(self.exit_requested.emit)
        footer.addWidget(quit_btn)
        footer.addStretch(1)
        footer.addWidget(done_btn)
        layout.addLayout(footer)

        self._thumb.set_path(settings.get("bg_image", ""))
        self._sync_mode_buttons()
        self.adjustSize()

    # ---- builders -----------------------------------------------------
    @staticmethod
    def _section(text):
        label = QLabel(text)
        label.setFont(make_font(11, QFont.Weight.DemiBold))
        label.setStyleSheet("color: #7186A9; background: transparent;")
        return label

    def _row_label(self, text):
        label = QLabel(text)
        label.setFont(make_font(12.5))
        label.setStyleSheet("color: #D6E1F4; background: transparent;")
        return label

    def _opacity_row(self):
        row = QHBoxLayout()
        row.setSpacing(10)
        row.addWidget(self._row_label("背景透明度"))
        self.opacity_slider = QSlider(Qt.Orientation.Horizontal)
        self.opacity_slider.setRange(25, 100)
        self.opacity_slider.setValue(int(float(self.settings.get("opacity", 0.82)) * 100))
        self.opacity_slider.setFixedHeight(22)
        self.opacity_slider.setStyleSheet(
            "QSlider::groove:horizontal { height: 4px; background: rgba(255,255,255,0.14); border-radius: 2px; }"
            "QSlider::sub-page:horizontal { background: #4C8DFF; border-radius: 2px; }"
            "QSlider::handle:horizontal { width: 14px; height: 14px; margin: -5px 0;"
            " border-radius: 7px; background: #FFFFFF; }"
        )
        self.opacity_slider.valueChanged.connect(self._on_opacity)
        row.addWidget(self.opacity_slider, 1)
        self.opacity_value = QLabel("%d%%" % self.opacity_slider.value())
        self.opacity_value.setFont(make_font(11.5))
        self.opacity_value.setStyleSheet("color: #A8B9D8; background: transparent;")
        self.opacity_value.setFixedWidth(38)
        self.opacity_value.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.opacity_value)
        return row

    def _image_row(self):
        row = QHBoxLayout()
        row.setSpacing(10)
        row.addWidget(self._row_label("背景图片"))
        self._thumb = ImageThumb()
        row.addWidget(self._thumb)
        pick = QPushButton("选择图片…")
        pick.setCursor(Qt.CursorShape.PointingHandCursor)
        pick.setFixedHeight(28)
        pick.setStyleSheet(
            "QPushButton { color: #D6E1F4; background: rgba(255,255,255,0.07);"
            " border: 1px solid rgba(255,255,255,0.10); border-radius: 8px;"
            " padding: 0 12px; font-size: 11.5px; }"
            "QPushButton:hover { background: rgba(255,255,255,0.14); }"
        )
        pick.clicked.connect(self._pick_image)
        clear = QPushButton("清除")
        clear.setCursor(Qt.CursorShape.PointingHandCursor)
        clear.setFixedHeight(28)
        clear.setStyleSheet(
            "QPushButton { color: #9FB0CC; background: transparent; border: none;"
            " padding: 0 6px; font-size: 11.5px; }"
            "QPushButton:hover { color: #FFFFFF; }"
        )
        clear.clicked.connect(self._clear_image)
        row.addWidget(pick)
        row.addWidget(clear)
        row.addStretch(1)
        return row

    def _mode_row(self):
        row = QHBoxLayout()
        row.setSpacing(10)
        row.addWidget(self._row_label("图片显示"))
        self.mode_group = QButtonGroup(self)
        self.mode_group.setExclusive(True)
        self.mode_buttons = {}
        for key, text in (("stretch", "拉伸"), ("tile", "平铺"), ("fill", "填充")):
            button = QPushButton(text)
            button.setCheckable(True)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setFixedHeight(28)
            button.setStyleSheet(
                "QPushButton { color: #A8B9D8; background: rgba(255,255,255,0.05);"
                " border: 1px solid rgba(255,255,255,0.09); border-radius: 8px;"
                " padding: 0 14px; font-size: 11.5px; }"
                "QPushButton:hover { background: rgba(255,255,255,0.10); }"
                "QPushButton:checked { color: #FFFFFF; background: rgba(76,141,255,0.9);"
                " border-color: rgba(76,141,255,0.9); }"
            )
            button.clicked.connect(lambda _=False, k=key: self._on_mode(k))
            self.mode_group.addButton(button)
            self.mode_buttons[key] = button
            row.addWidget(button)
        row.addStretch(1)
        return row

    def _checkbox(self, text, checked):
        box = QCheckBox(text)
        box.setChecked(checked)
        box.setCursor(Qt.CursorShape.PointingHandCursor)
        box.setFont(make_font(12.5))
        box.setStyleSheet(
            "QCheckBox { color: #D6E1F4; background: transparent; spacing: 8px; }"
            "QCheckBox::indicator { width: 16px; height: 16px; border-radius: 5px;"
            " border: 1px solid rgba(255,255,255,0.28); background: rgba(255,255,255,0.05); }"
            "QCheckBox::indicator:hover { border-color: rgba(120,160,255,0.8); }"
            "QCheckBox::indicator:checked { background: #4C8DFF; border-color: #4C8DFF; }"
        )
        return box

    def _city_row(self):
        row = QHBoxLayout()
        row.setSpacing(10)
        row.addWidget(self._row_label("天气城市"))
        self.city_edit = QLineEdit(self.settings.get("city", ""))
        self.city_edit.setPlaceholderText("例如：北京 / 宜宾")
        self.city_edit.setFixedHeight(30)
        self.city_edit.setFont(make_font(12.5))
        self.city_edit.setStyleSheet(
            "QLineEdit { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);"
            " border-radius: 8px; padding: 3px 10px; color: #EAF1FF; }"
            "QLineEdit:focus { border-color: #4C8DFF; }"
        )
        self.city_edit.returnPressed.connect(self._submit_city)
        row.addWidget(self.city_edit, 1)
        locate = QPushButton("定位")
        locate.setCursor(Qt.CursorShape.PointingHandCursor)
        locate.setFixedHeight(30)
        locate.setStyleSheet(
            "QPushButton { color: #FFFFFF; background: rgba(76,141,255,0.85); border: none;"
            " border-radius: 8px; padding: 0 14px; font-size: 11.5px; }"
            "QPushButton:hover { background: #4C8DFF; }"
        )
        locate.clicked.connect(self._submit_city)
        row.addWidget(locate)
        return row

    # ---- events -------------------------------------------------------
    def _on_opacity(self, value):
        self.opacity_value.setText("%d%%" % value)
        self.settings["opacity"] = value / 100.0
        self.changed.emit()

    def _pick_image(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "选择背景图片", os.path.expanduser("~"),
            "图片 (*.png *.jpg *.jpeg *.bmp *.webp);;所有文件 (*.*)")
        if not path:
            return
        self.settings["bg_image"] = path
        self._thumb.set_path(path)
        self.changed.emit()

    def _clear_image(self):
        if not self.settings.get("bg_image"):
            return
        self.settings["bg_image"] = ""
        self._thumb.set_path("")
        self.changed.emit()

    def _on_mode(self, mode):
        self.settings["bg_mode"] = mode
        self.changed.emit()

    def _sync_mode_buttons(self):
        mode = self.settings.get("bg_mode", "fill")
        button = self.mode_buttons.get(mode)
        if button is not None:
            button.setChecked(True)

    def _on_calendar(self, checked):
        self.settings["calendar"] = checked
        self.changed.emit()

    def _on_top(self, checked):
        self.settings["always_on_top"] = checked
        self.changed.emit()

    def _submit_city(self):
        city = self.city_edit.text().strip()
        if city:
            self.settings["city"] = city
            self.settings["latitude"] = None
            self.settings["longitude"] = None
            self.city_changed.emit(city)

    # ---- chrome -------------------------------------------------------
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        path = QPainterPath()
        path.addRoundedRect(rect, 18, 18)
        painter.fillPath(path, QBrush(QColor(16, 26, 48, 250)))
        painter.setPen(QPen(QColor(255, 255, 255, 26), 1))
        painter.drawPath(path)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and event.position().y() < 62:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_pos is not None and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._drag_pos = None
