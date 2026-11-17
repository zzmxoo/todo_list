import io

p = r"D:\Tools\Todos\ui_widgets.py"
s = io.open(p, encoding="utf-8").read()

s = s.replace("""from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QLineEdit, QPushButton, QScrollArea, QSizePolicy,
    QVBoxLayout, QWidget,
)""", """from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QLineEdit, QPushButton, QScrollArea, QSizePolicy,
    QStackedLayout, QVBoxLayout, QWidget,
)""")

old = '''        layout = QHBoxLayout(self)
        layout.setContentsMargins(30, 8, 10, 8)
        layout.setSpacing(8)

        self.label = QLabel(todo.get("text", ""), self)
        self.label.setWordWrap(True)
        self.label.setFont(make_font(13))
        self.label.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
        layout.addWidget(self.label, 1)

        self.due_label = QLabel("", self)
        self.due_label.setFont(make_font(10.5))
        self.due_label.setStyleSheet("color: #8FA3C6; background: transparent;")
        layout.addWidget(self.due_label, 0)

        self.btn_box = QWidget(self)
        self.btn_box.setFixedWidth(92)
        self.btn_box.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        button_layout = QHBoxLayout(self.btn_box)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(4)
        self.btn_done = IconButton("check", GREEN, self.btn_box, 20)
        self.btn_pin = IconButton("pin", AMBER, self.btn_box, 20)
        self.btn_due = IconButton("clock", QColor("#4C8DFF"), self.btn_box, 20)
        self.btn_delete = IconButton("close", RED, self.btn_box, 20)
        for button in (self.btn_done, self.btn_pin, self.btn_due, self.btn_delete):
            button.hide()
            button_layout.addWidget(button)
        layout.addWidget(self.btn_box, 0)
'''
new = '''        layout = QHBoxLayout(self)
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
'''
assert old in s
s = s.replace(old, new)

old2 = '''        self._edit = None
        self._apply_style()
        self._wire()'''
new2 = '''        self._edit = None
        self._sync_right()
        self._apply_style()
        self._wire()'''
assert old2 in s
s = s.replace(old2, new2)

old3 = '''    def _update_due(self):
        due = parse_dt(self.todo.get("due"))
        if due is None:
            self.due_label.hide()
            self.btn_due.set_active(False)
            self.btn_due.setToolTip("设置结束时间")
        else:
            self.due_label.setText(due.strftime("%m月%d日 %H:%M"))
            self.due_label.show()
            self.btn_due.set_active(True)
            self.btn_due.setToolTip("结束时间：%s" % due.strftime("%Y-%m-%d %H:%M"))
        self.btn_done.setToolTip("取消完成" if self.todo.get("done") else "标记完成")
        self.btn_pin.setToolTip("取消置顶" if self.todo.get("pinned") else "置顶")
        self.btn_delete.setToolTip("删除")
        if self._row_width:
            self.set_row_width(self._row_width)
'''
new3 = '''    def _update_due(self):
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
'''
assert old3 in s
s = s.replace(old3, new3)

old4 = '''    def set_row_width(self, width):
        self._row_width = width
        due_hidden = self.due_label.isHidden()
        due_w = 0 if due_hidden else self.due_label.sizeHint().width()
        spacing = 8 if due_hidden else 16
        text_w = max(80, width - 40 - spacing - self.btn_box.width() - due_w)
        self.label.setFixedWidth(text_w)
        height = self.label.heightForWidth(text_w)
        if height <= 0:
            height = QFontMetrics(self.label.font()).height()
        self.setFixedHeight(max(38, height + 16))
'''
new4 = '''    def set_row_width(self, width):
        self._row_width = width
        text_w = max(80, width - 30 - 12 - 8 - self.right_box.width())
        self.label.setFixedWidth(text_w)
        height = self.label.heightForWidth(text_w)
        if height <= 0:
            height = QFontMetrics(self.label.font()).height()
        self.setFixedHeight(max(38, height + 16))
'''
assert old4 in s
s = s.replace(old4, new4)

old5 = '''    def _set_hover(self, hover):
        if self._hover == hover:
            return
        self._hover = hover
        if not self._editing:
            for button in (self.btn_done, self.btn_pin, self.btn_due, self.btn_delete):
                button.setVisible(hover)
        self.update()
'''
new5 = '''    def _set_hover(self, hover):
        if self._hover == hover:
            return
        self._hover = hover
        self._sync_right()
        self.update()
'''
assert old5 in s
s = s.replace(old5, new5)

old6 = '''        self.label.show()
        self._update_due()
        if self._hover:
            self.btn_box.show()
        else:
            self.btn_box.hide()
'''
new6 = '''        self.label.show()
        self._hover = self.rect().contains(self.mapFromGlobal(self.cursor().pos()))
        self._update_due()
'''
assert old6 in s
s = s.replace(old6, new6)

io.open(p, "w", encoding="utf-8").write(s)
print("ui patched")
