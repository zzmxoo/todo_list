import datetime as dt
import os, sys
sys.path.insert(0, r"D:\Tools\Todos")
os.chdir(r"D:\Tools\Todos")
from PySide6.QtCore import QTimer
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QApplication
from main import MainWindow

app = QApplication(sys.argv)
win = MainWindow()
win.store.settings["calendar"] = True
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
win._restore_position()
win.show()
win.toggle_weather(True)

def shot():
    print("win", win.geometry(), win.size(), "visible", win.isVisible(), flush=True)
    scr = QGuiApplication.primaryScreen()
    pm = scr.grabWindow(0)
    pm.save(r"D:\Tools\Todos\_shots\screen.png")
    print("screen shot", pm.size(), "dpr", pm.devicePixelRatio(), flush=True)
    app.quit()

QTimer.singleShot(5000, shot)
app.exec()
