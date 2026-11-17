import datetime as dt
import os
import sys

sys.path.insert(0, r"D:\Tools\Todos")
os.chdir(r"D:\Tools\Todos")
try:
    os.remove(r"D:\Tools\Todos\data.json")
except OSError:
    pass

from PySide6.QtCore import QRectF, QTimer, Qt
from PySide6.QtGui import QColor, QGuiApplication, QPainter, QPixmap
from PySide6.QtWidgets import QApplication, QWidget

from main import MainWindow

OUT = r"D:\Tools\Todos\_shots"
os.makedirs(OUT, exist_ok=True)
WALL = r"C:\Windows\Web\Wallpaper\Spotlight\img14.jpg"

app = QApplication(sys.argv)
app.setStyle("Fusion")


class Stage(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint)
        self.pix = QPixmap(WALL)

    def paintEvent(self, event):
        p = QPainter(self)
        scaled = self.pix.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                                 Qt.TransformationMode.SmoothTransformation)
        p.drawPixmap(0, 0, scaled)


stage = Stage()
stage.setGeometry(QGuiApplication.primaryScreen().geometry())
stage.show()

win = MainWindow()
win.store.settings["calendar"] = False
win.store.settings["always_on_top"] = True
win.store.todos = [
    {"id": "a1", "text": "周三上午9点参加部门会议", "done": False, "pinned": False,
     "due": (dt.datetime.now().replace(hour=9, minute=0, second=0) + dt.timedelta(days=1)).isoformat(timespec="minutes")},
    {"id": "a2", "text": "周四下午5点前往金融中心参加培训课程", "done": False, "pinned": True, "due": None},
    {"id": "a3", "text": "购物清单：生日蛋糕、红酒、水果、百事可乐、牛排", "done": False, "pinned": False,
     "due": (dt.datetime.now() + dt.timedelta(minutes=20)).isoformat(timespec="minutes")},
    {"id": "a4", "text": "周日晚上8点赶飞机飞往上海出差", "done": False, "pinned": False,
     "due": (dt.datetime.now() - dt.timedelta(hours=2)).isoformat(timespec="minutes")},
    {"id": "a5", "text": "每天背10个单词", "done": True, "pinned": False, "due": None},
]
win._apply_settings()
win._rebuild_list()
win._relayout()
win.move(60, 50)
win.show()


def capture(name, margin=24):
    app.processEvents()
    scr = QGuiApplication.primaryScreen()
    pm = scr.grabWindow(0)
    dpr = pm.devicePixelRatio() or 1.0
    g = win.geometry()
    x = max(0, int((g.x() - margin) * dpr))
    y = max(0, int((g.y() - margin) * dpr))
    w = min(pm.width() - x, int((g.width() + margin * 2) * dpr))
    h = min(pm.height() - y, int((g.height() + margin * 2) * dpr))
    pm.copy(x, y, w, h).save(os.path.join(OUT, name))
    print(name, win.size(), g, flush=True)


def step1():
    capture("10_default.png")
    win.toggle_weather(True)


def step2():
    capture("11_weather.png")
    win.store.settings["calendar"] = True
    win._apply_settings()


def step3():
    capture("12_calendar.png")
    win.store.settings["calendar"] = False
    win.store.settings["bg_image"] = WALL
    win.store.settings["bg_mode"] = "fill"
    win._apply_settings()


def step4():
    capture("13_bg_fill.png")
    win.store.settings["bg_mode"] = "tile"
    win._apply_settings()


def step5():
    capture("14_bg_tile.png")
    win.store.settings["bg_image"] = ""
    win.store.settings["bg_mode"] = "fill"
    win._apply_settings()
    win.toggle_weather(False)
    # hover state
    win._rows[1]._set_hover(True)
    win._rows[1].btn_done.show()
    win._rows[1].btn_pin.show()
    win._rows[1].btn_due.show()
    win._rows[1].btn_delete.show()


def step6():
    capture("15_hover.png")
    win.open_settings()


def step7():
    dlg = win._settings_dialog
    if dlg:
        dlg.move(300, 120)
        app.processEvents()
        scr = QGuiApplication.primaryScreen()
        pm = scr.grabWindow(0)
        dpr = pm.devicePixelRatio() or 1.0
        g = dlg.geometry()
        pm.copy(int(g.x() * dpr) - 20, int(g.y() * dpr) - 20,
                int((g.width() + 40) * dpr), int((g.height() + 40) * dpr)).save(
            os.path.join(OUT, "16_settings.png"))
        print("settings", dlg.size(), flush=True)
        dlg.close()
    QTimer.singleShot(300, app.quit)


QTimer.singleShot(3000, step1)
QTimer.singleShot(3800, step2)
QTimer.singleShot(4600, step3)
QTimer.singleShot(5400, step4)
QTimer.singleShot(6200, step5)
QTimer.singleShot(7000, step6)
QTimer.singleShot(7800, step7)
app.exec()
