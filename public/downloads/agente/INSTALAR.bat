@echo off
setlocal enabledelayedexpansion
title Instalador GetPonto - Agente Local
color 0A

echo.
echo  ============================================================
echo     INSTALADOR AUTOMATICO - AGENTE LOCAL GETPONTO
echo  ============================================================
echo.
echo  Este instalador configura o agente para:
echo    - Rodar automaticamente com o Windows
echo    - Funcionar em segundo plano (sem janela)
echo    - Sincronizar REPs Control iD / ZKTeco
echo.
pause

set "INSTALL_PATH=C:\ProgramData\GetPonto-Agente"
set "SERVER_URL=https://getponto.inf.br"

:: Verificar se Node.js esta instalado
echo.
echo [1/5] Verificando Node.js...
where node >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('node --version') do echo   OK - Node.js %%i encontrado
    goto :skip_node
)

echo   Node.js nao encontrado. Baixando...
set "NODE_URL=https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"
set "NODE_INSTALLER=%TEMP%\node-installer.msi"

powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%'"

if not exist "%NODE_INSTALLER%" (
    echo   ERRO: Falha ao baixar Node.js
    echo   Baixe manualmente em: https://nodejs.org
    pause
    exit /b 1
)

echo   Instalando Node.js (aguarde)...
msiexec /i "%NODE_INSTALLER%" /qn /norestart
timeout /t 15 /nobreak >nul
set "PATH=%PATH%;C:\Program Files\nodejs"

:skip_node

:: Criar pasta de instalacao
echo.
echo [2/5] Criando pasta de instalacao...
if not exist "%INSTALL_PATH%" mkdir "%INSTALL_PATH%"
echo   Pasta: %INSTALL_PATH%

:: Baixar arquivos do agente (com timestamp para evitar cache)
echo.
echo [3/5] Baixando agente GetPonto...
for /f "tokens=*" %%t in ('powershell -Command "Get-Date -UFormat %%s"') do set "TIMESTAMP=%%t"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%SERVER_URL%/downloads/agente/agente.js?t=%TIMESTAMP%' -OutFile '%INSTALL_PATH%\agente.js'"

if not exist "%INSTALL_PATH%\agente.js" (
    echo   ERRO: Falha ao baixar agente.js
    pause
    exit /b 1
)
echo   OK - agente.js baixado

:: Criar script de inicializacao em segundo plano (sem janela)
echo.
echo [4/5] Configurando inicializacao automatica...

:: Script VBS que roda sem janela
echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_PATH%\IniciarOculto.vbs"
echo WshShell.Run "cmd /c cd /d %INSTALL_PATH% && node --insecure-http-parser agente.js", 0, False >> "%INSTALL_PATH%\IniciarOculto.vbs"

:: Copiar para Startup do Windows
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%INSTALL_PATH%\IniciarOculto.vbs" "%STARTUP_FOLDER%\GetPonto-Agente.vbs" >nul 2>nul
echo   OK - Configurado para iniciar com Windows (sem janela)

:: Configurar API Key
echo.
echo [5/5] Configuracao do agente...
echo.

if exist "%INSTALL_PATH%\config.json" (
    echo   Configuracao existente encontrada.
    set /p "RECONFIG=Deseja reconfigurar? (S/N): "
    if /i not "!RECONFIG!"=="S" goto :start_agent
)

set /p "API_KEY=Digite a API Key da entidade: "
if "%API_KEY%"=="" (
    echo   ERRO: API Key obrigatoria!
    pause
    exit /b 1
)

set /p "SERVIDOR=Servidor [%SERVER_URL%]: "
if "%SERVIDOR%"=="" set "SERVIDOR=%SERVER_URL%"

:: Criar config.json
echo {"servidor":"%SERVIDOR%","apiKey":"%API_KEY%","intervalo":60,"ultimoNsr":{}} > "%INSTALL_PATH%\config.json"
echo   OK - Configuracao salva

:start_agent
echo.
echo  ============================================================
color 0A
echo     INSTALACAO CONCLUIDA!
echo  ============================================================
echo.
echo  O agente foi configurado para:
echo    - Iniciar automaticamente com o Windows
echo    - Rodar em segundo plano (sem janela)
echo    - Sincronizar REPs a cada 60 segundos
echo.
echo  Pasta de instalacao: %INSTALL_PATH%
echo.

set /p "INICIAR=Deseja iniciar o agente agora? (S/N): "
if /i "%INICIAR%"=="S" (
    echo.
    echo Iniciando agente em segundo plano...
    cscript //nologo "%INSTALL_PATH%\IniciarOculto.vbs"
    timeout /t 3 /nobreak >nul

    :: Verificar se iniciou
    tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
    if %errorlevel%==0 (
        echo   OK - Agente rodando em segundo plano!
    ) else (
        echo   AVISO: Verifique o log em %INSTALL_PATH%\agente.log
    )
)

echo.
echo  Para verificar se esta rodando: tasklist ^| findstr node
echo  Para ver o log: type "%INSTALL_PATH%\agente.log"
echo.
pause
