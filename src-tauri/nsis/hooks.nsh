; 卸载时清理开机启动项；升级安装的静默卸载（/UPDATE）不能删。
;
; 注意：Tauri 的 installer.nsi 没有 !include LogicLib，这里不能用 ${If} / ${IfNot}，
; 否则 makensis 会报 “macro "_If" requires 4 parameter(s)”。升级判断用 $UpdateMode。
!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $UpdateMode 1 nsis_hook_keep_autostart
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DesktopTodo"
  nsis_hook_keep_autostart:
!macroend
