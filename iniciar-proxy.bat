@echo off
title Proxy REP - Ponto Eletronico
color 0E

echo ============================================
echo   PROXY REP - Control iD
echo ============================================
echo.

cd /d "C:\Users\Luiz Miguel\Dropbox\Sistemas\Empresa LhSystem\NodeJS\ponto-eletronico"

echo Iniciando proxy na porta 3334...
echo.
echo NAO FECHE ESTA JANELA!
echo.

node --insecure-http-parser scripts/rep-proxy.mjs

echo.
echo Proxy encerrado. Pressione qualquer tecla para fechar...
pause >nul
