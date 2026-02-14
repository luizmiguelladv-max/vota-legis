@echo off
chcp 65001 >nul
title Instalador Agente GetPonto

echo ═══════════════════════════════════════════════════
echo    INSTALADOR AGENTE LOCAL GETPONTO
echo ═══════════════════════════════════════════════════
echo.

REM Verificar se Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js não encontrado!
    echo.
    echo Baixe e instale o Node.js em: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js encontrado
echo.

REM Instalar dependências
echo Instalando dependências...
call npm install --production
echo.

REM Verificar se config.json existe
if not exist config.json (
    echo Criando arquivo de configuração...
    echo { > config.json
    echo   "servidor": "https://getponto.inf.br", >> config.json
    echo   "apiKey": "", >> config.json
    echo   "entidadeId": null, >> config.json
    echo   "intervalo": 60, >> config.json
    echo   "equipamentos": [] >> config.json
    echo } >> config.json
)

echo.
echo ═══════════════════════════════════════════════════
echo    INSTALAÇÃO CONCLUÍDA!
echo ═══════════════════════════════════════════════════
echo.
echo PRÓXIMOS PASSOS:
echo.
echo 1. Edite o arquivo config.json com sua API Key
echo 2. Execute iniciar.bat para rodar o agente
echo.
pause
