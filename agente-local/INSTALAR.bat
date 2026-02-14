@echo off
setlocal enabledelayedexpansion
title Instalador GetPonto - Agente Local
color 0A

echo.
echo  ============================================================
echo     INSTALADOR AUTOMATICO - AGENTE LOCAL GETPONTO
echo  ============================================================
echo.
echo  Este instalador baixa e configura tudo automaticamente:
echo    [x] Node.js (se nao estiver instalado)
echo    [x] Agente GetPonto
echo    [x] Inicia automaticamente com Windows
echo    [x] Roda em segundo plano
echo.
echo  EXECUTE COMO ADMINISTRADOR
echo.
pause

set "INSTALL_PATH=%ProgramData%\GetPonto-Agente"

:: Verificar se Node.js esta instalado
echo.
echo [1/6] Verificando Node.js...
where node >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('node --version') do echo   OK - Node.js %%i encontrado
    goto :skip_node
)

echo   Node.js nao encontrado. Baixando...
echo.

:: Baixar Node.js
set "NODE_URL=https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"
set "NODE_INSTALLER=%TEMP%\node-installer.msi"

echo   Baixando Node.js (pode demorar)...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%'"

if not exist "%NODE_INSTALLER%" (
    echo   ERRO: Falha ao baixar Node.js
    echo   Baixe manualmente em: https://nodejs.org
    pause
    exit /b 1
)

echo   Instalando Node.js...
msiexec /i "%NODE_INSTALLER%" /qn /norestart

:: Aguardar instalacao
timeout /t 10 /nobreak >nul

:: Atualizar PATH
set "PATH=%PATH%;C:\Program Files\nodejs"

:skip_node

:: Criar pasta de instalacao
echo.
echo [2/6] Criando pasta de instalacao...
if not exist "%INSTALL_PATH%" mkdir "%INSTALL_PATH%"
echo   Pasta: %INSTALL_PATH%

:: Baixar arquivos do agente
echo.
echo [3/6] Baixando agente GetPonto...

powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://getponto.inf.br/downloads/agente/agente.js' -OutFile '%INSTALL_PATH%\agente.js'"
echo   OK - agente.js

powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://getponto.inf.br/downloads/agente/package.json' -OutFile '%INSTALL_PATH%\package.json'"
echo   OK - package.json

:: Instalar dependencias
echo.
echo [4/6] Instalando dependencias...
cd /d "%INSTALL_PATH%"
call npm install --production 2>nul
echo   OK - Dependencias instaladas

:: Criar script de inicializacao em segundo plano
echo.
echo [5/6] Configurando inicializacao automatica...

:: Script que roda em segundo plano (sem janela)
echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_PATH%\IniciarOculto.vbs"
echo WshShell.Run "cmd /c cd /d %INSTALL_PATH% && node agente.js", 0, False >> "%INSTALL_PATH%\IniciarOculto.vbs"

:: Script para iniciar manualmente (com janela)
echo @echo off > "%INSTALL_PATH%\Iniciar.bat"
echo title Agente GetPonto >> "%INSTALL_PATH%\Iniciar.bat"
echo cd /d "%INSTALL_PATH%" >> "%INSTALL_PATH%\Iniciar.bat"
echo node agente.js >> "%INSTALL_PATH%\Iniciar.bat"
echo pause >> "%INSTALL_PATH%\Iniciar.bat"

:: Adicionar ao Startup do Windows (iniciar com sistema)
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy "%INSTALL_PATH%\IniciarOculto.vbs" "%STARTUP_FOLDER%\GetPonto-Agente.vbs" >nul 2>nul
echo   OK - Configurado para iniciar com Windows

:: Criar atalhos
echo.
echo [6/6] Criando atalhos...

:: Atalho na area de trabalho
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\GetPonto Agente.lnk'); $Shortcut.TargetPath = '%INSTALL_PATH%\Iniciar.bat'; $Shortcut.WorkingDirectory = '%INSTALL_PATH%'; $Shortcut.Save()"
echo   OK - Atalho criado na area de trabalho

echo.
echo  ============================================================
color 0A
echo     INSTALACAO CONCLUIDA!
echo  ============================================================
echo.
echo  O agente foi configurado para:
echo    - Iniciar automaticamente com o Windows
echo    - Rodar em segundo plano (sem janela)
echo.
echo  Para configurar, execute "GetPonto Agente" na area de trabalho
echo  e informe sua API Key na primeira vez.
echo.
echo  Apos configurar, o agente funcionara automaticamente.
echo.

set /p "INICIAR=Deseja configurar o agente agora? (S/N): "
if /i "%INICIAR%"=="S" (
    echo.
    echo Iniciando agente para configuracao...
    cd /d "%INSTALL_PATH%"
    node agente.js
)

pause
