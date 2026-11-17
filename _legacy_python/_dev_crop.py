import sys
from PySide6.QtGui import QImage
from PySide6.QtCore import Qt
img = QImage(r"D:\Tools\Todos\_shots\screen.png")
# calendar header band: logical y 370..440 -> physical 555..660, x 40..940 -> 60..1410
crop = img.copy(60, 540, 1360, 160).scaled(2720, 320, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
crop.save(r"D:\Tools\Todos\_shots\crop_header.png")
# also calendar full
img.copy(60, 540, 1360, 600).save(r"D:\Tools\Todos\_shots\crop_cal.png")
print("ok")
