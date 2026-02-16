@echo off
chcp 65001 >nul
title Instalador de Serviço GetPonto

echo ═══════════════════════════════════════════════════
echo    INSTALAR AGENTE COMO SERVIÇO WINDOWS
echo ═══════════════════════════════════════════════════
echo.

REM Verificar se está rodando como admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Execute como Administrador!
    echo.
    echo Clique com botão direito e selecione "Executar como administrador"
    pause
    exit /b 1
)

REM Instalar pm2 globalmente
echo Instalando PM2...
call npm install -g pm2 pm2-windows-startup

REM Iniciar agente com PM2
echo Iniciando agente...
call pm2 start agente.js --name "getponto-agente"

REM Configurar inicialização automática
echo Configurando inicialização automática...
call pm2 save
call pm2-startup install

echo.
echo ═══════════════════════════════════════════════════
echo    SERVIÇO INSTALADO COM SUCESSO!
echo ═══════════════════════════════════════════════════
echo.
echo O agente será iniciado automaticamente com o Windows.
echo.
echo Comandos úteis:
echo   pm2 status          - Ver status
echo   pm2 logs            - Ver logs
echo   pm2 restart all     - Reiniciar
echo   pm2 stop all        - Parar
echo.
pause
