@echo off
title Ponto Eletronico - Encerrando Servicos

echo.
echo ==============================================================
echo      ENCERRANDO TODOS OS SERVICOS
echo ==============================================================
echo.

echo [1/2] Encerrando Node.js (AdonisJS)...
taskkill /F /IM node.exe /T >nul 2>&1
if %errorlevel% equ 0 (
    echo       OK - Node.js encerrado
) else (
    echo       Nenhum processo Node.js encontrado
)

echo [2/2] Encerrando Python (APIs)...
taskkill /F /IM python.exe /T >nul 2>&1
if %errorlevel% equ 0 (
    echo       OK - Python encerrado
) else (
    echo       Nenhum processo Python encontrado
)

echo.
echo ==============================================================
echo   TODOS OS SERVICOS FORAM ENCERRADOS
echo ==============================================================
echo.

timeout /t 3
