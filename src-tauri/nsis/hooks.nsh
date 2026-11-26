; 卸载时清理开机启动项；升级安装的静默卸载阶段不能删。
!macro NSIS_HOOK_POSTUNINSTALL
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DesktopTodo"
  ${EndIf}
!macroend
