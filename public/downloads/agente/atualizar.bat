@echo off
setlocal

set "INSTALL_DIR=C:\GetPonto"
set "SERVER_URL=https://getponto.inf.br"

echo.
echo ========================================
echo    ATUALIZADOR DO AGENTE GETPONTO
echo ========================================
echo.

:: Verificar se diretorio existe
if not exist "%INSTALL_DIR%" (
    echo ERRO: Diretorio %INSTALL_DIR% nao encontrado!
    echo Execute o INSTALAR.bat primeiro.
    pause
    exit /b 1
)

:: Parar agente se estiver rodando
echo [1/3] Parando agente em execucao...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo       OK

:: Baixar nova versao (com timestamp para evitar cache)
echo.
echo [2/3] Baixando agente atualizado...
for /f "tokens=*" %%t in ('powershell -Command "Get-Date -UFormat %%s"') do set "TIMESTAMP=%%t"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%SERVER_URL%/downloads/agente/agente.js?t=%TIMESTAMP%' -OutFile '%INSTALL_DIR%\agente.js'"

if not exist "%INSTALL_DIR%\agente.js" (
    echo ERRO: Falha ao baixar agente.js!
    pause
    exit /b 1
)
echo       OK - agente.js atualizado

:: Atualizar script de inicializacao com flag --insecure-http-parser
echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_DIR%\IniciarOculto.vbs"
echo WshShell.Run "cmd /c cd /d %INSTALL_DIR% && node --insecure-http-parser agente.js", 0, False >> "%INSTALL_DIR%\IniciarOculto.vbs"

:: Reiniciar agente em background
echo.
echo [3/3] Reiniciando agente em segundo plano...
cd /d "%INSTALL_DIR%"
start "" /b node --insecure-http-parser agente.js
echo       OK - Agente iniciado

echo.
echo ========================================
echo    ATUALIZACAO CONCLUIDA!
echo ========================================
echo.
echo    O agente esta rodando em segundo plano.
echo    Verifique o log em: %INSTALL_DIR%\agente.log
echo.

timeout /t 5
