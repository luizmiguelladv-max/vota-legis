#!/bin/bash
# =============================================================================
# Script de Instalação - DeepFace API
# Sistema de Ponto Eletrônico
# =============================================================================
#
# Este script instala o microserviço DeepFace para reconhecimento facial.
#
# Uso:
#   chmod +x install.sh
#   ./install.sh
#
# =============================================================================

set -e

echo "=============================================="
echo "  DeepFace API - Instalação"
echo "=============================================="
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Diretório atual
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verifica se é root
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Aviso: Executando como root. Recomendado usar usuário normal.${NC}"
fi

# 1. Verifica Python
echo -e "${GREEN}[1/6]${NC} Verificando Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    echo "  Python encontrado: $PYTHON_VERSION"
else
    echo -e "${RED}Erro: Python 3 não encontrado!${NC}"
    echo "Instale com: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# 2. Verifica pip
echo -e "${GREEN}[2/6]${NC} Verificando pip..."
if command -v pip3 &> /dev/null; then
    echo "  pip encontrado"
else
    echo "  Instalando pip..."
    sudo apt install -y python3-pip
fi

# 3. Cria ambiente virtual
echo -e "${GREEN}[3/6]${NC} Criando ambiente virtual..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "  Ambiente virtual criado"
else
    echo "  Ambiente virtual já existe"
fi

# 4. Ativa ambiente virtual e instala dependências
echo -e "${GREEN}[4/6]${NC} Instalando dependências (pode demorar)..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 5. Cria diretório de faces
echo -e "${GREEN}[5/6]${NC} Criando diretórios..."
mkdir -p faces
echo "  Diretório 'faces' criado"

# 6. Cria serviço systemd
echo -e "${GREEN}[6/6]${NC} Configurando serviço systemd..."

SERVICE_FILE="/etc/systemd/system/deepface-api.service"
WORKING_DIR="$SCRIPT_DIR"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"

# Detecta usuário atual (não root)
if [ "$EUID" -eq 0 ]; then
    CURRENT_USER="${SUDO_USER:-$USER}"
else
    CURRENT_USER="$USER"
fi

sudo tee $SERVICE_FILE > /dev/null << EOF
[Unit]
Description=DeepFace API - Reconhecimento Facial
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$WORKING_DIR
ExecStart=$VENV_PYTHON -m uvicorn main:app --host 0.0.0.0 --port 5000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

echo "  Serviço criado: $SERVICE_FILE"

# Recarrega systemd e inicia serviço
sudo systemctl daemon-reload
sudo systemctl enable deepface-api
sudo systemctl start deepface-api

echo ""
echo "=============================================="
echo -e "${GREEN}  Instalação concluída!${NC}"
echo "=============================================="
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status deepface-api   # Ver status"
echo "  sudo systemctl restart deepface-api  # Reiniciar"
echo "  sudo journalctl -u deepface-api -f   # Ver logs"
echo ""
echo "API disponível em: http://localhost:5000"
echo ""

# Testa se está funcionando
sleep 3
if curl -s http://localhost:5000/health > /dev/null 2>&1; then
    echo -e "${GREEN}API está funcionando!${NC}"
    curl -s http://localhost:5000/ | python3 -m json.tool
else
    echo -e "${YELLOW}API ainda está inicializando (o primeiro start demora mais)${NC}"
    echo "Aguarde alguns segundos e teste: curl http://localhost:5000/"
fi
