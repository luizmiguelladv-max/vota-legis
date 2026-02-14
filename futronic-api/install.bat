@echo off
REM ============================================
REM Script de instalacao - Futronic API (Windows)
REM ============================================

echo ============================================
echo Instalando Futronic API...
echo ============================================

REM Verifica se Python esta instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo Erro: Python nao encontrado.
    echo Baixe em: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Cria ambiente virtual
echo.
echo [1/3] Criando ambiente virtual...
python -m venv venv

REM Ativa ambiente virtual
echo [2/3] Ativando ambiente virtual...
call venv\Scripts\activate.bat

REM Instala dependencias
echo [3/3] Instalando dependencias Python...
pip install --upgrade pip
pip install -r requirements.txt

echo.
echo ============================================
echo Instalacao concluida!
echo ============================================
echo.
echo Para iniciar o servidor:
echo   venv\Scripts\activate
echo   python main.py
echo.
echo O servidor estara disponivel em:
echo   http://localhost:5001
echo.
echo IMPORTANTE:
echo 1. Instale o driver Futronic FS80H
echo 2. Conecte o leitor USB
echo 3. Reinicie o servico
echo ============================================
pause
