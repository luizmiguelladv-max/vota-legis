@echo off
title Sistema Ponto Eletronico - Iniciando...
color 0A

echo ============================================
echo   SISTEMA DE PONTO ELETRONICO - PMSA
echo ============================================
echo.

cd /d "C:\Users\Luiz Miguel\Dropbox\Sistemas\Empresa LhSystem\NodeJS\ponto-eletronico"

echo [1/3] Iniciando Proxy REP (porta 3334)...
start "Proxy REP" cmd /k "node --insecure-http-parser scripts/rep-proxy.mjs"

timeout /t 2 /nobreak >nul

echo [2/3] Iniciando Servico de Sincronizacao (a cada 5 min)...
start "Sincronizacao REP" cmd /k "node --insecure-http-parser scripts/servico-sincronizacao.mjs"

timeout /t 2 /nobreak >nul

echo [3/3] Iniciando Servidor AdonisJS (porta 3333)...
start "Servidor AdonisJS" cmd /k "npm run dev"

echo.
echo ============================================
echo   Sistema iniciado com sucesso!
echo ============================================
echo.
echo   - Servidor: http://localhost:3333
echo   - Proxy REP: http://localhost:3334
echo   - Sincronizacao: a cada 5 minutos
echo.
echo   Tres janelas foram abertas:
echo   - Proxy REP (mantenha aberta)
echo   - Sincronizacao REP (mantenha aberta)
echo   - Servidor AdonisJS (mantenha aberta)
echo.
echo   Pressione qualquer tecla para fechar esta janela...
pause >nul
