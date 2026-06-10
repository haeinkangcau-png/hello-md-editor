; Custom NSIS hooks for "Hi MD Editor"
; 목적: 과거 product 이름("Hello MD Editor")으로 등록된 레지스트리 잔재가
;       Windows "연결 프로그램(Open with)" 목록에 계속 남는 문제 정리.
; 이 앱이 만든 키만 삭제하므로 다른 프로그램에는 영향 없음.

!macro customInstall
  ; --- 이전 product 이름("Hello MD Editor") 잔재 제거 ---
  DeleteRegKey HKCU "Software\Classes\Applications\Hello MD Editor.exe"
  DeleteRegKey HKLM "Software\Classes\Applications\Hello MD Editor.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Hello MD Editor.exe"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Hello MD Editor.exe"
!macroend

!macro customUnInstall
  ; 제거 시 현재 앱의 Open-With 등록도 정리
  DeleteRegKey HKCU "Software\Classes\Applications\Hi MD Editor.exe"
  DeleteRegKey HKLM "Software\Classes\Applications\Hi MD Editor.exe"
!macroend
