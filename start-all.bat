@echo off
title Ponto Eletronico - Iniciador

echo.
echo ==============================================================
echo      SISTEMA DE PONTO ELETRONICO - INICIALIZACAO
echo      Prefeitura Municipal de Santo Andre/PB
echo ==============================================================
echo.

cd /d "%~dp0"

echo [1/4] Encerrando processos anteriores...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Iniciando Futronic API (porta 5001)...
cd /d "%~dp0futronic-api"
if exist "python32\python.exe" goto FUTRONIC_32
goto FUTRONIC_VENV

:FUTRONIC_32
start "Futronic API" cmd /k "title Futronic API - Porta 5001 && python32\python.exe main.py"
goto FUTRONIC_DONE

:FUTRONIC_VENV
echo      AVISO: Python 32 bits nao encontrado, usando venv padrao...
start "Futronic API" cmd /k "title Futronic API - Porta 5001 && venv\Scripts\python.exe main.py"

:FUTRONIC_DONE
timeout /t 3 /nobreak >nul

cd /d "%~dp0"
if not exist "deepface-api\main.py" goto SKIP_DEEPFACE

echo [3/4] Iniciando DeepFace API (porta 5000)...
cd /d "%~dp0deepface-api"
if not exist "venv\Scripts\python.exe" goto DEEPFACE_NO_VENV
start "DeepFace API" cmd /k "title DeepFace API - Porta 5000 && venv\Scripts\python.exe main.py"
timeout /t 3 /nobreak >nul
goto ADONIS

:DEEPFACE_NO_VENV
echo      AVISO: venv do DeepFace nao encontrado, pulando...
goto ADONIS

:SKIP_DEEPFACE
echo [3/4] DeepFace API nao configurada, pulando...

:ADONIS
cd /d "%~dp0"
echo [4/4] Iniciando servidor AdonisJS (porta 3333)...
start "AdonisJS Server" cmd /k "title AdonisJS - Porta 3333 && npm run dev"

echo.
echo ==============================================================
echo   Aguardando servicos iniciarem...
echo ==============================================================
timeout /t 8 /nobreak >nul

echo.
echo ==============================================================
echo   SERVICOS INICIADOS COM SUCESSO!
echo ==============================================================
echo.
echo   AdonisJS:     http://localhost:3333
echo   Futronic API: http://localhost:5001
echo   DeepFace API: http://localhost:5000
echo.
echo ==============================================================

start "" "http://localhost:3333"

echo Pressione qualquer tecla para fechar esta janela...
echo (Os servicos continuarao rodando em segundo plano)
pause >nul
