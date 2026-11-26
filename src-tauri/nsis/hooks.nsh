; 卸载时清理开机启动项，避免登录时尝试拉起已删除的 exe。
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DesktopTodo"
!macroend
