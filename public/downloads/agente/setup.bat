@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

echo.
echo ══════════════════════════════════════════════════════════════
echo    INSTALADOR DO AGENTE GETPONTO v1.3.0
echo    Sincronizador de REPs Control iD / ZKTeco
echo ══════════════════════════════════════════════════════════════
echo.

:: Configuracoes
set "INSTALL_DIR=C:\GetPonto"
set "SERVER_URL=https://getponto.inf.br"
set "NODE_VERSION=20.11.0"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"

:: Verificar se esta rodando como administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [AVISO] Execute como Administrador para instalar o servico do Windows.
    echo         Continuando instalacao sem servico automatico...
    echo.
)

:: Criar diretorio de instalacao
echo [1/6] Criando diretorio de instalacao...
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo       OK - Diretorio criado: %INSTALL_DIR%
) else (
    echo       OK - Diretorio ja existe: %INSTALL_DIR%
)

:: Verificar se Node.js esta instalado
echo.
echo [2/6] Verificando Node.js...
where node >nul 2>&1
if %errorLevel% equ 0 (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
    echo       OK - Node.js !NODE_VER! encontrado
    set "NODE_CMD=node"
    goto :download_agent
)

:: Verificar se Node.js portable existe
if exist "%INSTALL_DIR%\node\node.exe" (
    echo       OK - Node.js portable encontrado
    set "NODE_CMD=%INSTALL_DIR%\node\node.exe"
    goto :download_agent
)

:: Baixar Node.js portable
echo       Node.js nao encontrado. Baixando...
echo.

:: Usar PowerShell para baixar
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%INSTALL_DIR%\node.zip'}" 2>nul

if not exist "%INSTALL_DIR%\node.zip" (
    echo [ERRO] Falha ao baixar Node.js!
    echo        Baixe manualmente de: https://nodejs.org/
    pause
    exit /b 1
)

echo       Extraindo Node.js...
powershell -Command "& {Expand-Archive -Path '%INSTALL_DIR%\node.zip' -DestinationPath '%INSTALL_DIR%' -Force}" 2>nul

:: Renomear pasta extraida
for /d %%D in ("%INSTALL_DIR%\node-v*") do (
    if exist "%%D\node.exe" (
        ren "%%D" "node"
    )
)

del "%INSTALL_DIR%\node.zip" 2>nul
set "NODE_CMD=%INSTALL_DIR%\node\node.exe"
echo       OK - Node.js instalado

:download_agent
echo.
echo [3/6] Baixando agente atualizado...

:: Baixar agente.js do servidor
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%SERVER_URL%/downloads/agente/agente.js' -OutFile '%INSTALL_DIR%\agente.js'}" 2>nul

if not exist "%INSTALL_DIR%\agente.js" (
    echo [ERRO] Falha ao baixar agente.js!
    echo        Verifique sua conexao com a internet.
    pause
    exit /b 1
)
echo       OK - agente.js baixado

:: Criar package.json se nao existir
echo.
echo [4/6] Configurando dependencias...

if not exist "%INSTALL_DIR%\package.json" (
    echo {"name":"getponto-agente","version":"1.3.0","main":"agente.js","dependencies":{"zkteco-js":"^1.0.0"}} > "%INSTALL_DIR%\package.json"
)

:: Instalar dependencias (opcional - zkteco-js)
if exist "%INSTALL_DIR%\node\npm.cmd" (
    echo       Instalando dependencias opcionais...
    cd /d "%INSTALL_DIR%"
    "%INSTALL_DIR%\node\npm.cmd" install --silent 2>nul
) else (
    where npm >nul 2>&1
    if %errorLevel% equ 0 (
        echo       Instalando dependencias opcionais...
        cd /d "%INSTALL_DIR%"
        npm install --silent 2>nul
    )
)
echo       OK - Dependencias configuradas

:: Criar script de inicializacao
echo.
echo [5/6] Criando scripts de inicializacao...

:: Script para iniciar o agente
echo @echo off > "%INSTALL_DIR%\iniciar.bat"
echo cd /d "%INSTALL_DIR%" >> "%INSTALL_DIR%\iniciar.bat"
if "%NODE_CMD%"=="node" (
    echo node agente.js >> "%INSTALL_DIR%\iniciar.bat"
) else (
    echo "%NODE_CMD%" agente.js >> "%INSTALL_DIR%\iniciar.bat"
)

:: Script para iniciar em background (sem janela)
echo Set objShell = CreateObject("WScript.Shell") > "%INSTALL_DIR%\iniciar_background.vbs"
echo objShell.CurrentDirectory = "%INSTALL_DIR%" >> "%INSTALL_DIR%\iniciar_background.vbs"
if "%NODE_CMD%"=="node" (
    echo objShell.Run "node agente.js", 0, False >> "%INSTALL_DIR%\iniciar_background.vbs"
) else (
    echo objShell.Run """%NODE_CMD%"" agente.js", 0, False >> "%INSTALL_DIR%\iniciar_background.vbs"
)

echo       OK - Scripts criados

:: Adicionar ao iniciar do Windows
echo.
echo [6/6] Configurando inicializacao automatica...

:: Criar atalho na pasta Startup
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -Command "& {$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP_FOLDER%\GetPonto Agente.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\iniciar_background.vbs'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()}" 2>nul

if exist "%STARTUP_FOLDER%\GetPonto Agente.lnk" (
    echo       OK - Agente configurado para iniciar com Windows
) else (
    echo       [AVISO] Nao foi possivel configurar inicio automatico
    echo               Execute manualmente: %INSTALL_DIR%\iniciar.bat
)

echo.
echo ══════════════════════════════════════════════════════════════
echo    INSTALACAO CONCLUIDA!
echo ══════════════════════════════════════════════════════════════
echo.
echo    Diretorio: %INSTALL_DIR%
echo.
echo    Para iniciar o agente:
echo      - Modo interativo: %INSTALL_DIR%\iniciar.bat
echo      - Modo background:  %INSTALL_DIR%\iniciar_background.vbs
echo.
echo    O agente sera iniciado automaticamente com o Windows.
echo.
echo ══════════════════════════════════════════════════════════════
echo.

:: Perguntar se quer iniciar agora
set /p INICIAR="Deseja iniciar o agente agora? (S/N): "
if /i "%INICIAR%"=="S" (
    echo.
    echo Iniciando agente...
    echo.
    cd /d "%INSTALL_DIR%"
    if "%NODE_CMD%"=="node" (
        node agente.js
    ) else (
        "%NODE_CMD%" agente.js
    )
)

pause
