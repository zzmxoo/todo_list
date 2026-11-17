import sys
from PySide6.QtGui import QImage
img = QImage(r"D:\Tools\Todos\_shots\03_calendar.png")
print("size", img.width(), img.height(), "dpr", img.devicePixelRatio())
print("center-bottom", img.pixelColor(img.width()//2, img.height()-20).getRgb())
for y in range(0, img.height(), 60):
    c = img.pixelColor(700, y)
    print(y, c.getRgb())
