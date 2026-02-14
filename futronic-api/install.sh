#!/bin/bash
# ============================================
# Script de instalacao - Futronic API (Linux)
# ============================================

echo "============================================"
echo "Instalando Futronic API..."
echo "============================================"

# Verifica se Python esta instalado
if ! command -v python3 &> /dev/null; then
    echo "Erro: Python 3 nao encontrado. Instale com:"
    echo "  sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# Cria ambiente virtual
echo ""
echo "[1/4] Criando ambiente virtual..."
python3 -m venv venv

# Ativa ambiente virtual
echo "[2/4] Ativando ambiente virtual..."
source venv/bin/activate

# Instala dependencias
echo "[3/4] Instalando dependencias Python..."
pip install --upgrade pip
pip install -r requirements.txt

# Instala libusb (necessario para comunicacao USB)
echo "[4/4] Instalando dependencias do sistema..."
if command -v apt &> /dev/null; then
    sudo apt update
    sudo apt install -y libusb-1.0-0-dev libudev-dev
elif command -v yum &> /dev/null; then
    sudo yum install -y libusb1-devel
fi

# Configura permissoes udev para acesso ao leitor USB
echo ""
echo "Configurando permissoes USB..."
sudo tee /etc/udev/rules.d/99-futronic.rules << 'EOF'
# Futronic FS80H
SUBSYSTEM=="usb", ATTRS{idVendor}=="0b38", ATTRS{idProduct}=="0003", MODE="0666", GROUP="plugdev"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger

echo ""
echo "============================================"
echo "Instalacao concluida!"
echo "============================================"
echo ""
echo "Para iniciar o servidor:"
echo "  source venv/bin/activate"
echo "  python main.py"
echo ""
echo "O servidor estara disponivel em:"
echo "  http://localhost:5001"
echo ""
echo "IMPORTANTE: Conecte o leitor Futronic FS80H"
echo "e reinicie o servico para detecta-lo."
echo "============================================"
