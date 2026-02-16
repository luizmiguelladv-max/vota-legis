@echo off
title Instalador GetPonto Agente

echo.
echo ======================================================
echo    INSTALADOR AGENTE LOCAL GETPONTO
echo ======================================================
echo.
echo Este instalador vai:
echo   - Baixar e instalar Node.js (se necessario)
echo   - Baixar o agente GetPonto
echo   - Criar atalho na area de trabalho
echo.
echo IMPORTANTE: Execute como ADMINISTRADOR
echo.
pause

powershell -ExecutionPolicy Bypass -File "%~dp0GetPonto-Instalador.ps1"

if errorlevel 1 (
    echo.
    echo ERRO na instalacao!
    pause
)
