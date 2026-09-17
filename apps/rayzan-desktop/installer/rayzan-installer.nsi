Unicode true
RequestExecutionLevel user

!define APP_NAME "Rayzan"
!define APP_VERSION "0.0.0"
!define APP_PUBLISHER "Rayzan"
!define APP_EXE "Rayzan.exe"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "..\release\Rayzan-0.0.0-win-x64-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\Rayzan"
InstallDirRegKey HKCU "Software\Rayzan" "InstallDir"
Icon "..\resources\rayzan-app-icon.ico"
UninstallIcon "..\resources\rayzan-app-icon.ico"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install Rayzan" SEC_INSTALL
  SetOutPath "$INSTDIR"
  File /r "..\release-installer-icon\win-unpacked\*"

  WriteRegStr HKCU "Software\Rayzan" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "DisplayName" "Rayzan"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "UninstallString" '"$INSTDIR\Uninstall Rayzan.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Rayzan"
  CreateShortcut "$SMPROGRAMS\Rayzan\Rayzan.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\Rayzan.lnk" "$INSTDIR\${APP_EXE}"
  WriteUninstaller "$INSTDIR\Uninstall Rayzan.exe"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Rayzan\Rayzan.lnk"
  RMDir "$SMPROGRAMS\Rayzan"
  Delete "$DESKTOP\Rayzan.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayzan"
  DeleteRegKey HKCU "Software\Rayzan"
  RMDir /r "$INSTDIR"
SectionEnd
