@echo off
chcp 65001 > nul
title Hello MD Editor — 개발 모드

cd /d "%~dp0"

:: 혹시 5174 포트가 이미 사용 중이면 해제
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5174 "') do (
  taskkill /F /PID %%a > nul 2>&1
)

echo.
echo  Hello MD Editor 개발 버전을 시작합니다...
echo  (이 창을 닫으면 앱과 서버가 함께 종료됩니다)
echo.

npm run dev

pause
