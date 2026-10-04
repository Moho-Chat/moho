; moho's additions to electron-builder's NSIS installer. Picked up by
; electron-builder because of where it lives (build/installer.nsh).

; electron-builder's own app check needs these, and leaves them out when
; a project brings its own check - as this one does, below.
!include "getProcessInfo.nsh"
Var pid

; moho's daemon keeps running after the window closes, by design - and so
; keeps nobilis.exe open. An upgrade or an uninstall that cannot replace or
; remove that file leaves the old daemon behind, which is how a new window
; ends up talking to an old daemon. Stopped first, every time.
!macro mohoStopDaemon
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM nobilis.exe'
  Pop $0
  Sleep 500
!macroend

; Once installing has actually begun - after Install is pressed, not when the
; installer opens, or opening it and cancelling would have cut a running moho
; off from its daemon. Then electron-builder's own check for the window.
!macro customCheckAppRunning
  !insertmacro mohoStopDaemon
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

; What the program leaves outside its own folder. Not touched by an upgrade,
; which runs the old uninstaller too (isUpdated): a new version keeps
; everything the old one had.
!macro customUnInstall
  ; Confirmed by now, so stopping it costs nothing that was not agreed to.
  !insertmacro mohoStopDaemon
  ${ifNot} ${isUpdated}
    ; A download cache, nobody's data. Always.
    RMDir /r "$LOCALAPPDATA\moho-updater"
    ; Accounts with their saved sign-ins, history, caches. Asked, because
    ; someone reinstalling wants them back - but asked, because someone
    ; uninstalling may well expect a saved sign-in to go with the program.
    ; No in a silent uninstall.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also remove your moho accounts, their saved sign-ins and the message history kept on this computer?$\r$\n$\r$\nChoose No to keep them for when moho is installed again." \
      /SD IDNO IDNO mohoKeepData
      RMDir /r "$APPDATA\moho"
      RMDir /r "$APPDATA\nobilis"
      RMDir /r "$LOCALAPPDATA\nobilis"
    mohoKeepData:
  ${endIf}
!macroend
