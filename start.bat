@echo off
title FotoDown - server lokal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [!] Python tidak ditemukan di PATH.
  echo     Install Python dulu, atau jalankan lewat XAMPP/Laragon ^(taruh folder ini di htdocs^).
  pause
  exit /b 1
)

echo ============================================
echo   FotoDown berjalan di  http://localhost:8080
echo   Tutup jendela ini untuk mematikan server.
echo ============================================
start "" "http://localhost:8080/index.html"
python -m http.server 8080
pause
