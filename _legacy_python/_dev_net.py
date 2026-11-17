import sys
from PySide6.QtCore import QUrl, QTimer
from PySide6.QtWidgets import QApplication
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply

app = QApplication(sys.argv)
nam = QNetworkAccessManager()
req = QNetworkRequest(QUrl("https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=116.4&current=temperature_2m,weather_code"))
req.setRawHeader(b"User-Agent", b"TodoWidget/1.0")
reply = nam.get(req)

def done():
    print("error:", reply.error(), reply.errorString())
    print("data:", bytes(reply.readAll())[:200])
    app.quit()

reply.finished.connect(done)
QTimer.singleShot(15000, lambda: (print("timeout"), app.quit()))
app.exec()
