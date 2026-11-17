import sys
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication
from services import WeatherService

app = QApplication(sys.argv)
svc = WeatherService()
svc.updated.connect(lambda d: (print("OK", d["city"], d["current"], len(d["daily"]), d["daily"][0]), app.quit()))
svc.failed.connect(lambda m: (print("FAIL", m), app.quit()))
QTimer.singleShot(200, lambda: svc.set_city("宜宾"))
QTimer.singleShot(20000, lambda: (print("timeout"), app.quit()))
app.exec()
