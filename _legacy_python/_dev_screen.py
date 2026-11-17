from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QGuiApplication
import sys
app = QApplication(sys.argv)
for s in QGuiApplication.screens():
    print(s.name(), "geometry", s.geometry(), "available", s.availableGeometry(), "dpr", s.devicePixelRatio())
