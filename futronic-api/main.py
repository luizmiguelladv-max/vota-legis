"""
Biometric API - Microservico Universal de Leitura de Digital
=============================================================

API REST para captura e verificacao de digitais usando qualquer leitor biometrico.
Roda na porta 5001 e e chamado pelo AdonisJS.

Hardware suportado:
1. SDK Futronic nativo (ftrScanAPI.dll) - PRIORIDADE
2. Windows Biometric Framework (WBF) - fallback
3. Simulacao para testes

Leitores Futronic suportados:
- FS80, FS80H, FS88, FS90

Outros leitores (via WBF):
- DigitalPersona (U.are.U 4500, 5160, etc.)
- ZKTeco (ZK4500, ZK7500, etc.)
- Suprema (BioMini, etc.)

Uso:
    python main.py
    ou
    uvicorn main:app --host 0.0.0.0 --port 5001
"""

import os
import sys
import base64
import json
import hashlib
from io import BytesIO
from pathlib import Path
from typing import Optional
from datetime import datetime

# Corrige encoding para Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    os.environ['PYTHONIOENCODING'] = 'utf-8'

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import numpy as np

# Configuracoes
TEMPLATES_DIR = Path("./templates")  # Diretorio para armazenar templates
PORT = 5001
DEVICE_CONNECTED = False  # Status do dispositivo
DEVICE_INFO = {}  # Informacoes do dispositivo

# SDK Futronic
FUTRONIC_SDK_AVAILABLE = False
FUTRONIC_HANDLE = None
ftrScanAPI = None  # Handle para a DLL

# =============================================================
# FABRICANTES DE LEITORES BIOMETRICOS SUPORTADOS
# =============================================================
# O sistema detecta qualquer leitor USB biometrico pelos Vendor IDs conhecidos
# Se tiver driver WBF instalado, funciona automaticamente

BIOMETRIC_VENDORS = {
    # Futronic
    "1491": {"name": "Futronic", "models": {"0020": "Scanner 2.0", "0410": "FS80H", "0411": "FS80", "0401": "FS88"}},
    "0647": {"name": "Futronic", "models": {"0410": "FS80H", "0411": "FS80"}},

    # DigitalPersona / Crossmatch
    "05BA": {"name": "DigitalPersona", "models": {"0007": "U.are.U 4000", "000A": "U.are.U 4500", "0010": "U.are.U 5160"}},
    "1FAE": {"name": "DigitalPersona", "models": {}},

    # ZKTeco
    "1B55": {"name": "ZKTeco", "models": {"0120": "ZK4500", "0200": "ZK7500", "0408": "ZK9500"}},

    # Suprema
    "16D1": {"name": "Suprema", "models": {"0401": "BioMini", "0402": "BioMini Plus"}},

    # SecuGen
    "1162": {"name": "SecuGen", "models": {"0320": "Hamster Plus", "0330": "Hamster Pro 20"}},

    # Nitgen
    "0A86": {"name": "Nitgen", "models": {"1010": "Fingkey Hamster"}},

    # Authentec (Apple TouchID em alguns laptops)
    "08FF": {"name": "AuthenTec", "models": {}},

    # Upek / Validity (Dell, Lenovo laptops)
    "147E": {"name": "Validity/Synaptics", "models": {}},
    "138A": {"name": "Validity", "models": {}},

    # Eikon / UPEK
    "0483": {"name": "Eikon/UPEK", "models": {}},

    # Goodix (laptops modernos)
    "27C6": {"name": "Goodix", "models": {}},
}

# Cria diretorio de templates se nao existir
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

# Inicializa FastAPI
app = FastAPI(
    title="Futronic API",
    description="API de leitura de digital para o sistema de ponto eletronico",
    version="1.0.0"
)

# CORS para permitir chamadas do AdonisJS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Handler global de exceções para evitar que o servidor caia
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Captura qualquer exceção não tratada e retorna JSON em vez de crashar"""
    print(f"[ERRO GLOBAL] {type(exc).__name__}: {exc}")
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
            "message": "Erro interno do servidor. Tente novamente."
        }
    )

# Cache de templates em memoria
templates_cache = {}


# ============================================
# MODELOS DE REQUEST/RESPONSE
# ============================================

class CadastrarRequest(BaseModel):
    """Request para cadastrar digital"""
    funcionario_id: int
    nome: str
    pis: str
    template_base64: Optional[str] = None  # Template ja extraido (opcional)


class VerificarRequest(BaseModel):
    """Request para verificar digital"""
    template_base64: str  # Template da digital capturada


class StatusResponse(BaseModel):
    """Response de status"""
    status: str
    device_connected: bool
    templates_cadastrados: int
    version: str


# ============================================
# FUNCOES AUXILIARES
# ============================================

def load_templates_cache():
    """Carrega cache de templates do disco"""
    global templates_cache
    cache_file = TEMPLATES_DIR / "templates_cache.json"

    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                templates_cache = json.load(f)
            print(f"[Futronic] Cache carregado: {len(templates_cache)} templates")
        except Exception as e:
            print(f"[Futronic] Erro ao carregar cache: {e}")
            templates_cache = {}


def save_templates_cache():
    """Salva cache de templates no disco"""
    cache_file = TEMPLATES_DIR / "templates_cache.json"
    try:
        with open(cache_file, "w") as f:
            json.dump(templates_cache, f)
    except Exception as e:
        print(f"[Futronic] Erro ao salvar cache: {e}")


def compare_templates(template1: bytes, template2: bytes, threshold: float = 0.7) -> tuple:
    """
    Compara dois templates de digital.

    NOTA: Esta e uma implementacao simplificada.
    Em producao, usar o SDK da Futronic para comparacao real.

    Retorna: (match: bool, score: float)
    """
    # Implementacao simplificada usando hash similarity
    # Em producao, usar o matcher do SDK Futronic

    hash1 = hashlib.sha256(template1).hexdigest()
    hash2 = hashlib.sha256(template2).hexdigest()

    # Comparacao simples (em producao usar algoritmo real)
    if hash1 == hash2:
        return True, 1.0

    # Calcula similaridade baseada em bytes comuns
    # Isso e apenas um placeholder - o SDK real faz matching biometrico
    common = sum(1 for a, b in zip(template1, template2) if a == b)
    total = max(len(template1), len(template2))
    score = common / total if total > 0 else 0

    return score >= threshold, score


def extract_vid_pid(device_id: str) -> tuple:
    r"""
    Extrai VID e PID de um Device ID do Windows.
    Ex: USB\VID_1491&PID_0020\FS00000000 -> ('1491', '0020')
    """
    vid, pid = None, None
    device_id = device_id.upper()

    # Busca VID
    if "VID_" in device_id:
        start = device_id.find("VID_") + 4
        vid = device_id[start:start+4]

    # Busca PID
    if "PID_" in device_id:
        start = device_id.find("PID_") + 4
        pid = device_id[start:start+4]

    return vid, pid


def get_vendor_info(vid: str, pid: str) -> dict:
    """
    Retorna informacoes do fabricante baseado no VID/PID.
    """
    if not vid:
        return None

    vid_upper = vid.upper()
    for vendor_vid, vendor_data in BIOMETRIC_VENDORS.items():
        if vendor_vid.upper() == vid_upper:
            model = "Scanner"
            if pid and pid.upper() in vendor_data.get("models", {}):
                model = vendor_data["models"][pid.upper()]
            return {
                "vendor": vendor_data["name"],
                "model": model,
                "vid": vid,
                "pid": pid
            }

    return None


def detect_usb_device_linux():
    """
    Detecta leitores biometricos no Linux usando lsusb/pyusb.
    """
    global DEVICE_CONNECTED, DEVICE_INFO

    devices_found = []

    # Metodo 1: Tenta usar pyusb
    try:
        import usb.core
        import usb.util

        for vendor_vid, vendor_data in BIOMETRIC_VENDORS.items():
            vid_int = int(vendor_vid, 16)
            devices = usb.core.find(find_all=True, idVendor=vid_int)

            for device in devices:
                pid_hex = f"{device.idProduct:04X}"
                model = vendor_data["models"].get(pid_hex.upper(), "Scanner")

                device_data = {
                    "device_id": f"USB:{vendor_vid}:{pid_hex}",
                    "description": f"{vendor_data['name']} {model}",
                    "name": model,
                    "manufacturer": vendor_data["name"],
                    "model": model,
                    "vid": vendor_vid,
                    "pid": pid_hex,
                    "method": "pyusb",
                    "status": "OK"
                }
                devices_found.append(device_data)
                print(f"[Biometric] Encontrado (pyusb): {vendor_data['name']} {model}")

        if devices_found:
            DEVICE_CONNECTED = True
            DEVICE_INFO = devices_found[0]
            DEVICE_INFO["all_devices"] = devices_found
            return True

    except ImportError:
        print("[Biometric] pyusb nao instalado - tentando lsusb")
    except Exception as e:
        print(f"[Biometric] Erro pyusb: {e}")

    # Metodo 2: Tenta usar lsusb (comando do sistema)
    try:
        import subprocess
        result = subprocess.run(["lsusb"], capture_output=True, text=True)

        for line in result.stdout.split("\n"):
            for vendor_vid, vendor_data in BIOMETRIC_VENDORS.items():
                if f":{vendor_vid.lower()}:" in line.lower() or f" {vendor_vid.lower()}:" in line.lower():
                    device_data = {
                        "device_id": line.strip(),
                        "description": f"{vendor_data['name']} Scanner",
                        "name": "Fingerprint Scanner",
                        "manufacturer": vendor_data["name"],
                        "model": "Scanner",
                        "vid": vendor_vid,
                        "pid": "Unknown",
                        "method": "lsusb",
                        "status": "OK"
                    }
                    devices_found.append(device_data)
                    print(f"[Biometric] Encontrado (lsusb): {line.strip()}")

        if devices_found:
            DEVICE_CONNECTED = True
            DEVICE_INFO = devices_found[0]
            DEVICE_INFO["all_devices"] = devices_found
            return True

    except Exception as e:
        print(f"[Biometric] Erro lsusb: {e}")

    return False


def detect_usb_device_macos():
    """
    Detecta leitores biometricos no macOS usando system_profiler.
    """
    global DEVICE_CONNECTED, DEVICE_INFO

    devices_found = []

    try:
        import subprocess
        import re

        # Usa system_profiler para listar dispositivos USB
        result = subprocess.run(
            ["system_profiler", "SPUSBDataType"],
            capture_output=True,
            text=True
        )

        current_device = {}
        for line in result.stdout.split("\n"):
            # Busca por Vendor ID
            if "Vendor ID:" in line:
                match = re.search(r"0x([0-9a-fA-F]+)", line)
                if match:
                    vid = match.group(1).upper()
                    vendor_info = get_vendor_info(vid, None)
                    if vendor_info:
                        current_device = {
                            "vid": vid,
                            "vendor": vendor_info["vendor"]
                        }
            elif "Product ID:" in line and current_device:
                match = re.search(r"0x([0-9a-fA-F]+)", line)
                if match:
                    pid = match.group(1).upper()
                    vendor_info = get_vendor_info(current_device["vid"], pid)
                    device_data = {
                        "device_id": f"USB:{current_device['vid']}:{pid}",
                        "description": f"{current_device['vendor']} Scanner",
                        "name": vendor_info["model"] if vendor_info else "Scanner",
                        "manufacturer": current_device["vendor"],
                        "model": vendor_info["model"] if vendor_info else "Scanner",
                        "vid": current_device["vid"],
                        "pid": pid,
                        "method": "system_profiler",
                        "status": "OK"
                    }
                    devices_found.append(device_data)
                    print(f"[Biometric] Encontrado (macOS): {current_device['vendor']}")
                    current_device = {}

        if devices_found:
            DEVICE_CONNECTED = True
            DEVICE_INFO = devices_found[0]
            DEVICE_INFO["all_devices"] = devices_found
            return True

    except Exception as e:
        print(f"[Biometric] Erro macOS: {e}")

    return False


def detect_usb_device_windows():
    """
    Detecta leitores biometricos no Windows usando WMI.
    """
    global DEVICE_CONNECTED, DEVICE_INFO

    try:
        import wmi
        c = wmi.WMI()

        devices_found = []

        # Busca em todos os dispositivos PnP
        for device in c.Win32_PnPEntity():
            device_id = (device.DeviceID or "").upper()

            if "VID_" not in device_id:
                continue

            vid, pid = extract_vid_pid(device_id)
            vendor_info = get_vendor_info(vid, pid)

            if vendor_info:
                device_data = {
                    "device_id": device.DeviceID,
                    "description": device.Description or f"{vendor_info['vendor']} Scanner",
                    "name": device.Name or "Fingerprint Scanner",
                    "manufacturer": vendor_info["vendor"],
                    "model": vendor_info["model"],
                    "vid": vid,
                    "pid": pid,
                    "method": "wmi-pnp",
                    "status": device.Status
                }
                devices_found.append(device_data)
                print(f"[Biometric] Encontrado: {vendor_info['vendor']} {vendor_info['model']}")
                print(f"[Biometric] Device ID: {device.DeviceID}")

        # Busca adicional em dispositivos biometricos
        try:
            for device in c.query("SELECT * FROM Win32_PnPEntity WHERE PNPClass = 'Biometric'"):
                device_id = (device.DeviceID or "").upper()

                if any(d["device_id"].upper() == device_id for d in devices_found):
                    continue

                vid, pid = extract_vid_pid(device_id)
                vendor_info = get_vendor_info(vid, pid)

                device_data = {
                    "device_id": device.DeviceID,
                    "description": device.Description or "Biometric Scanner",
                    "name": device.Name or "Fingerprint Scanner",
                    "manufacturer": vendor_info["vendor"] if vendor_info else "Desconhecido",
                    "model": vendor_info["model"] if vendor_info else device.Description or "Scanner",
                    "vid": vid,
                    "pid": pid,
                    "method": "wmi-biometric",
                    "status": device.Status
                }
                devices_found.append(device_data)
                print(f"[Biometric] Encontrado (biometric class): {device.Description}")
        except Exception:
            pass

        if devices_found:
            DEVICE_CONNECTED = True
            DEVICE_INFO = devices_found[0]
            DEVICE_INFO["all_devices"] = devices_found
            print(f"[Biometric] Usando: {DEVICE_INFO['manufacturer']} {DEVICE_INFO['model']}")
            return True

        return False

    except ImportError:
        print("[Biometric] wmi nao instalado - execute: pip install WMI pywin32")
        return False
    except Exception as e:
        print(f"[Biometric] Erro WMI: {e}")
        return False


def detect_usb_device():
    """
    Detecta QUALQUER leitor biometrico USB.
    Suporta Windows, Linux e macOS.
    """
    global DEVICE_CONNECTED, DEVICE_INFO

    print(f"[Biometric] Sistema operacional: {sys.platform}")

    # Detecta baseado no sistema operacional
    if sys.platform == "win32":
        result = detect_usb_device_windows()
    elif sys.platform == "darwin":
        result = detect_usb_device_macos()
    elif sys.platform.startswith("linux"):
        result = detect_usb_device_linux()
    else:
        print(f"[Biometric] Sistema {sys.platform} nao suportado")
        result = False

    if not result:
        print("[Biometric] Nenhum leitor biometrico detectado")
        DEVICE_CONNECTED = False
        DEVICE_INFO = {}

    return result


def init_futronic_sdk():
    """
    Inicializa o SDK Futronic nativo (ftrScanAPI.dll).
    Retorna True se o SDK foi carregado e o dispositivo aberto com sucesso.
    """
    global FUTRONIC_SDK_AVAILABLE, FUTRONIC_HANDLE, ftrScanAPI

    if sys.platform != "win32":
        print("[Futronic SDK] Disponivel apenas no Windows")
        return False

    try:
        import ctypes
        from ctypes import c_void_p, c_int, c_bool, byref, create_string_buffer, Structure, POINTER

        # Tenta carregar a DLL do diretorio atual
        dll_path = Path(__file__).parent / "ftrScanAPI.dll"
        if not dll_path.exists():
            # Tenta no System32
            dll_path = Path("C:/Windows/System32/ftrScanAPI.dll")

        if not dll_path.exists():
            print(f"[Futronic SDK] DLL nao encontrada: {dll_path}")
            return False

        print(f"[Futronic SDK] Carregando DLL: {dll_path}")
        ftrScanAPI = ctypes.WinDLL(str(dll_path))

        # Define tipos de retorno das funcoes
        ftrScanAPI.ftrScanOpenDevice.restype = c_void_p
        ftrScanAPI.ftrScanCloseDevice.argtypes = [c_void_p]
        ftrScanAPI.ftrScanGetImageSize.argtypes = [c_void_p, c_void_p]
        ftrScanAPI.ftrScanGetImageSize.restype = c_bool
        ftrScanAPI.ftrScanGetImage.argtypes = [c_void_p, c_int, c_void_p]
        ftrScanAPI.ftrScanGetImage.restype = c_bool
        ftrScanAPI.ftrScanIsFingerPresent.argtypes = [c_void_p, c_void_p]
        ftrScanAPI.ftrScanIsFingerPresent.restype = c_bool

        # Abre o dispositivo
        print("[Futronic SDK] Abrindo dispositivo...")
        handle = ftrScanAPI.ftrScanOpenDevice()

        if not handle:
            print("[Futronic SDK] Falha ao abrir dispositivo (handle nulo)")
            return False

        FUTRONIC_HANDLE = handle
        FUTRONIC_SDK_AVAILABLE = True
        print(f"[Futronic SDK] Dispositivo aberto com sucesso! Handle: {handle}")
        return True

    except OSError as e:
        print(f"[Futronic SDK] Erro ao carregar DLL: {e}")
        return False
    except Exception as e:
        print(f"[Futronic SDK] Erro: {e}")
        import traceback
        traceback.print_exc()
        return False


def close_futronic_sdk():
    """Fecha o dispositivo Futronic."""
    global FUTRONIC_SDK_AVAILABLE, FUTRONIC_HANDLE, ftrScanAPI

    if FUTRONIC_HANDLE and ftrScanAPI:
        try:
            ftrScanAPI.ftrScanCloseDevice(FUTRONIC_HANDLE)
            print("[Futronic SDK] Dispositivo fechado")
        except Exception as e:
            print(f"[Futronic SDK] Erro ao fechar: {e}")

    FUTRONIC_HANDLE = None
    FUTRONIC_SDK_AVAILABLE = False


def capturar_com_futronic_sdk(timeout_seconds: int = 30):
    """
    Captura digital usando o SDK Futronic nativo.
    Aguarda o usuario colocar o dedo no leitor.
    Reconecta automaticamente se necessario.

    Retorna: (image_data, error_message)
    """
    global FUTRONIC_HANDLE, ftrScanAPI, FUTRONIC_SDK_AVAILABLE

    if not FUTRONIC_SDK_AVAILABLE or not FUTRONIC_HANDLE:
        # Tenta reconectar
        print("[Futronic SDK] Tentando reconectar...")
        if init_futronic_sdk():
            print("[Futronic SDK] Reconectado com sucesso!")
        else:
            return None, "SDK Futronic nao inicializado"

    try:
        import ctypes
        from ctypes import c_int, c_bool, byref, create_string_buffer, Structure

        # Estrutura para tamanho da imagem
        class FTRSCAN_IMAGE_SIZE(Structure):
            _fields_ = [
                ("nWidth", c_int),
                ("nHeight", c_int),
                ("nImageSize", c_int)
            ]

        # Estrutura para parametros de frame
        class FTRSCAN_FRAME_PARAMETERS(Structure):
            _fields_ = [
                ("nContrastOnDose2", c_int),
                ("nContrastOnDose4", c_int),
                ("nDose", c_int),
                ("nBrightnessOnDose2", c_int),
                ("nBrightnessOnDose4", c_int),
                ("bFingerPresent", c_bool)
            ]

        # Obtem tamanho da imagem
        img_size = FTRSCAN_IMAGE_SIZE()
        if not ftrScanAPI.ftrScanGetImageSize(FUTRONIC_HANDLE, byref(img_size)):
            # Tenta reconectar e tentar novamente
            print("[Futronic SDK] Falha ao obter tamanho - tentando reconectar...")
            close_futronic_sdk()
            if init_futronic_sdk():
                if not ftrScanAPI.ftrScanGetImageSize(FUTRONIC_HANDLE, byref(img_size)):
                    return None, "Falha ao obter tamanho da imagem"
            else:
                return None, "Falha ao reconectar com o leitor"

        print(f"[Futronic SDK] Tamanho: {img_size.nWidth}x{img_size.nHeight} ({img_size.nImageSize} bytes)")

        # Aguarda o dedo no leitor
        print(f"[Futronic SDK] Aguardando dedo no leitor (timeout: {timeout_seconds}s)...")
        print("[Futronic SDK] COLOQUE O DEDO NO LEITOR...")

        import time
        start_time = time.time()
        frame_params = FTRSCAN_FRAME_PARAMETERS()

        while (time.time() - start_time) < timeout_seconds:
            try:
                # Verifica se tem dedo no leitor
                if ftrScanAPI.ftrScanIsFingerPresent(FUTRONIC_HANDLE, byref(frame_params)):
                    if frame_params.bFingerPresent:
                        print("[Futronic SDK] Dedo detectado! Capturando...")
                        break
            except Exception as e:
                print(f"[Futronic SDK] Erro ao verificar dedo: {e}")
                # Tenta continuar
            time.sleep(0.1)  # Verifica a cada 100ms
        else:
            return None, "Timeout - nenhum dedo detectado"

        # Captura a imagem
        buffer = create_string_buffer(img_size.nImageSize)
        if not ftrScanAPI.ftrScanGetImage(FUTRONIC_HANDLE, 4, buffer):  # Dose 4 = alta qualidade
            return None, "Falha ao capturar imagem"

        print(f"[Futronic SDK] Imagem capturada! {len(buffer.raw)} bytes")

        # Converte para formato de template (a imagem raw pode ser usada como template)
        return buffer.raw, None

    except OSError as e:
        # Erro de acesso ao dispositivo - tenta reconectar na proxima vez
        print(f"[Futronic SDK] Erro de dispositivo: {e}")
        close_futronic_sdk()
        return None, f"Erro de dispositivo: {e}. Tente novamente."
    except Exception as e:
        print(f"[Futronic SDK] Erro na captura: {e}")
        import traceback
        traceback.print_exc()
        return None, str(e)


def init_device():
    """
    Inicializa qualquer leitor biometrico conectado.
    Prioridade: 1) SDK Futronic, 2) WBF, 3) Deteccao USB
    """
    global DEVICE_CONNECTED, DEVICE_INFO

    print("[Biometric] =================================================")
    print("[Biometric] Buscando leitor biometrico USB...")
    print("[Biometric] Fabricantes suportados:")
    vendors_list = list(set(v["name"] for v in BIOMETRIC_VENDORS.values()))
    for vendor in sorted(vendors_list):
        print(f"[Biometric]   - {vendor}")
    print("[Biometric] =================================================")

    # Primeiro, tenta detectar dispositivo USB
    if detect_usb_device():
        print(f"[Biometric] Leitor conectado: {DEVICE_INFO.get('manufacturer', '')} {DEVICE_INFO.get('model', '')}")

        # Se for Futronic, tenta inicializar o SDK nativo
        if DEVICE_INFO.get('manufacturer', '').lower() == 'futronic':
            print("[Biometric] Detectado leitor Futronic - tentando SDK nativo...")
            if init_futronic_sdk():
                print("[Biometric] SDK Futronic inicializado com sucesso!")
                DEVICE_INFO['sdk'] = 'futronic_native'
            else:
                print("[Biometric] SDK Futronic nao disponivel - usando WBF/simulacao")
                DEVICE_INFO['sdk'] = 'wbf_or_simulation'

        return True
    else:
        DEVICE_CONNECTED = False
        DEVICE_INFO = {}
        print("[Biometric] Nenhum leitor biometrico detectado")
        return False


# ============================================
# EVENTOS DE CICLO DE VIDA
# ============================================

@app.on_event("startup")
async def startup_event():
    """Inicializacao do servidor"""
    print("")
    print("=" * 60)
    print("   BIOMETRIC API - Leitor Universal de Digitais")
    print("=" * 60)
    print(f"   Porta: {PORT}")
    print(f"   Sistema: {sys.platform}")
    print("=" * 60)
    print("")

    # Carrega cache de templates
    load_templates_cache()

    # Inicializa dispositivo
    init_device()

    print("")
    if DEVICE_CONNECTED:
        print(f"[Biometric] PRONTO! Leitor {DEVICE_INFO.get('manufacturer', '')} {DEVICE_INFO.get('model', '')} conectado")
    else:
        print("[Biometric] AVISO: Nenhum leitor conectado")
        print("[Biometric] Conecte um leitor USB e use /device/reconnect")
    print("")


# ============================================
# ENDPOINTS
# ============================================

@app.get("/", response_model=StatusResponse)
async def status():
    """Status do servico"""
    return StatusResponse(
        status="online",
        device_connected=DEVICE_CONNECTED,
        templates_cadastrados=len(templates_cache),
        version="1.0.0"
    )


def get_safe_device_info(device_data):
    """Extrai apenas campos serializaveis de device_data"""
    if not device_data:
        return {}
    safe = {}
    safe_keys = ["device_id", "description", "name", "manufacturer", "model", "vid", "pid", "method", "status"]
    for key in safe_keys:
        try:
            if key in device_data:
                value = device_data[key]
                # Ignora campos complexos como 'all_devices'
                if isinstance(value, (str, int, float, bool, type(None))):
                    safe[key] = str(value) if value is not None else ""
                elif isinstance(value, (list, dict)):
                    continue  # Ignora listas e dicts aninhados
                else:
                    safe[key] = str(value)
        except Exception as e:
            print(f"[Biometric] Erro ao processar campo {key}: {e}")
            safe[key] = ""
    return safe


@app.get("/health")
async def health():
    """Health check"""
    return {"status": "healthy", "device": DEVICE_CONNECTED}


@app.get("/device/status")
async def device_status():
    """Status detalhado do dispositivo"""
    try:
        safe_info = get_safe_device_info(DEVICE_INFO) if DEVICE_INFO else {}

        # Informacoes do SDK
        sdk_info = {
            "futronic_sdk_available": FUTRONIC_SDK_AVAILABLE,
            "futronic_handle": str(FUTRONIC_HANDLE) if FUTRONIC_HANDLE else None,
            "sdk_used": DEVICE_INFO.get('sdk', 'none')
        }

        return {
            "connected": DEVICE_CONNECTED,
            "manufacturer": safe_info.get("manufacturer", ""),
            "model": safe_info.get("model", ""),
            "info": safe_info,
            "sdk": sdk_info,
            "driver_installed": DEVICE_CONNECTED,
            "message": "Pronto para uso" if DEVICE_CONNECTED else "Conecte o leitor USB"
        }
    except Exception as e:
        print(f"[Biometric] Erro em /device/status: {e}")
        import traceback
        traceback.print_exc()
        return {
            "connected": DEVICE_CONNECTED,
            "manufacturer": "",
            "model": "",
            "info": {},
            "sdk": {"error": str(e)},
            "driver_installed": DEVICE_CONNECTED,
            "message": str(e)
        }


@app.get("/fabricantes")
async def listar_fabricantes():
    """
    Lista todos os fabricantes de leitores biometricos suportados.
    Util para mostrar na interface quais leitores funcionam.
    """
    # Agrupa por fabricante
    fabricantes = {}
    for vid, data in BIOMETRIC_VENDORS.items():
        nome = data["name"]
        if nome not in fabricantes:
            fabricantes[nome] = {
                "nome": nome,
                "vendor_ids": [],
                "modelos": []
            }
        fabricantes[nome]["vendor_ids"].append(vid)
        for pid, modelo in data.get("models", {}).items():
            if modelo not in fabricantes[nome]["modelos"]:
                fabricantes[nome]["modelos"].append(modelo)

    return {
        "success": True,
        "total": len(fabricantes),
        "fabricantes": list(fabricantes.values()),
        "sistema": sys.platform,
        "instrucoes": {
            "windows": "Instale o driver do fabricante. A maioria funciona automaticamente.",
            "linux": "Pode ser necessario instalar libfprint ou pyusb (pip install pyusb)",
            "macos": "Instale o driver do fabricante. Poucos leitores suportam macOS."
        }
    }


@app.get("/device/all")
async def listar_dispositivos():
    """
    Lista TODOS os leitores biometricos conectados.
    Util se houver mais de um leitor no sistema.
    """
    try:
        if not DEVICE_CONNECTED:
            # Tenta detectar novamente
            detect_usb_device()

        if DEVICE_CONNECTED and "all_devices" in DEVICE_INFO:
            safe_devices = [get_safe_device_info(d) for d in DEVICE_INFO["all_devices"]]
            return {
                "success": True,
                "total": len(safe_devices),
                "dispositivos": safe_devices,
                "em_uso": get_safe_device_info(DEVICE_INFO)
            }
        elif DEVICE_CONNECTED:
            safe_device = get_safe_device_info(DEVICE_INFO)
            return {
                "success": True,
                "total": 1,
                "dispositivos": [safe_device],
                "em_uso": safe_device
            }
        else:
            return {
                "success": False,
                "total": 0,
                "dispositivos": [],
                "message": "Nenhum leitor biometrico detectado"
            }
    except Exception as e:
        print(f"[Biometric] Erro em /device/all: {e}")
        return {
            "success": False,
            "total": 0,
            "dispositivos": [],
            "message": str(e)
        }


@app.post("/device/reconnect")
async def device_reconnect():
    """Tenta reconectar ao dispositivo"""
    try:
        init_device()
        return {
            "success": DEVICE_CONNECTED,
            "device_info": get_safe_device_info(DEVICE_INFO),
            "message": "Dispositivo conectado" if DEVICE_CONNECTED else "Dispositivo nao encontrado"
        }
    except Exception as e:
        print(f"[Biometric] Erro em /device/reconnect: {e}")
        return {
            "success": False,
            "device_info": {},
            "message": str(e)
        }


def capturar_com_wbf(timeout_seconds: int = 30):
    """
    Captura digital usando Windows Biometric Framework.
    Funciona com qualquer leitor que tenha driver WBF instalado.
    Aguarda o usuario colocar o dedo no leitor.
    """
    try:
        import ctypes
        from ctypes import wintypes

        # Carrega a DLL do Windows Biometric Framework
        try:
            winbio = ctypes.WinDLL("winbio.dll")
        except OSError:
            return None, "WBF_NOT_AVAILABLE"

        # Define tipos de retorno
        winbio.WinBioOpenSession.restype = ctypes.c_int32
        winbio.WinBioCaptureSample.restype = ctypes.c_int32
        winbio.WinBioCloseSession.restype = ctypes.c_int32

        # Constantes WBF
        WINBIO_TYPE_FINGERPRINT = 0x00000008
        WINBIO_POOL_SYSTEM = 0x00000001
        WINBIO_FLAG_DEFAULT = 0x00000000

        # Abre sessao biometrica
        session_handle = ctypes.c_uint32()

        print("[WBF] Abrindo sessao biometrica...")
        hr = winbio.WinBioOpenSession(
            WINBIO_TYPE_FINGERPRINT,
            WINBIO_POOL_SYSTEM,
            WINBIO_FLAG_DEFAULT,
            None,
            0,
            None,
            ctypes.byref(session_handle)
        )

        # Converte para unsigned se negativo
        if hr < 0:
            hr = hr & 0xFFFFFFFF

        if hr != 0:
            error_msg = f"Erro ao abrir sessao WinBio: 0x{hr:08X}"
            if hr == 0x80098003 or hr == 0x80070490:
                error_msg = "WBF_NO_DEVICE"  # Nenhum leitor WBF
            elif hr == 0x800704DD:
                error_msg = "WBF_SERVICE_DISABLED"  # Servico desabilitado
            elif hr == 0x80070005:
                error_msg = "WBF_ACCESS_DENIED"  # Acesso negado
            return None, error_msg

        print(f"[WBF] Sessao aberta: {session_handle.value}")
        print(f"[WBF] Aguardando digital... (timeout: {timeout_seconds}s)")
        print("[WBF] COLOQUE O DEDO NO LEITOR...")

        try:
            # Variaveis para captura
            unit_id = ctypes.c_uint32()
            sample_ptr = ctypes.c_void_p()
            sample_size = ctypes.c_size_t()
            reject_detail = ctypes.c_uint32()

            # WinBioCaptureSample - funcao BLOQUEANTE que aguarda o dedo
            hr = winbio.WinBioCaptureSample(
                session_handle,
                0x00000001,  # WINBIO_PURPOSE_VERIFY
                0x01,        # WINBIO_DATA_FLAG_RAW
                ctypes.byref(unit_id),
                ctypes.byref(sample_ptr),
                ctypes.byref(sample_size),
                ctypes.byref(reject_detail)
            )

            # Converte para unsigned se negativo
            if hr < 0:
                hr = hr & 0xFFFFFFFF

            if hr == 0 and sample_ptr.value and sample_size.value > 0:
                # Copia os dados da amostra
                sample_data = ctypes.string_at(sample_ptr.value, sample_size.value)
                print(f"[WBF] Digital capturada! Tamanho: {len(sample_data)} bytes")

                # Libera recursos
                try:
                    winbio.WinBioFree(sample_ptr)
                except:
                    pass
                winbio.WinBioCloseSession(session_handle)

                return sample_data, None

            else:
                winbio.WinBioCloseSession(session_handle)

                # Traduz codigos de erro
                if hr == 0x8009802F:
                    return None, "Captura cancelada pelo usuario"
                elif hr == 0x80098005:
                    return None, f"Qualidade ruim - tente novamente (codigo: {reject_detail.value})"
                elif hr == 0x800704C7:
                    return None, "Timeout - nenhuma digital detectada"
                elif hr == 0x80098001:
                    return None, "WBF_NO_DEVICE"
                else:
                    return None, f"WBF_ERROR_0x{hr:08X}"

        except Exception as e:
            try:
                winbio.WinBioCloseSession(session_handle)
            except:
                pass
            return None, str(e)

    except Exception as e:
        return None, f"WBF_EXCEPTION: {str(e)}"


@app.post("/capturar")
async def capturar_digital():
    """
    Captura uma digital do leitor.
    Aguarda o usuario colocar o dedo no leitor (funcao bloqueante).

    Prioridade de captura:
    1. SDK Futronic nativo (ftrScanAPI.dll) - para leitores Futronic
    2. Windows Biometric Framework (WBF) - para outros leitores
    3. Simulacao - se nenhum SDK disponivel

    Suporta:
    - Futronic (FS80, FS80H, FS88, FS90) via SDK nativo
    - DigitalPersona, ZKTeco, Suprema via WBF
    """
    try:
        if not DEVICE_CONNECTED:
            return {
                "success": False,
                "error": "Leitor nao conectado",
                "message": "Conecte o leitor biometrico USB e use /device/reconnect"
            }

        print("[Biometric] Iniciando captura de digital...")
        print(f"[Biometric] Leitor: {DEVICE_INFO.get('manufacturer', '')} {DEVICE_INFO.get('model', '')}")
        print(f"[Biometric] SDK disponivel: {DEVICE_INFO.get('sdk', 'nenhum')}")

        # =====================================================
        # Se for Futronic mas SDK não está disponível, tenta reconectar
        # =====================================================
        if DEVICE_INFO.get('manufacturer', '').lower() == 'futronic' and not FUTRONIC_SDK_AVAILABLE:
            print("[Biometric] SDK Futronic não disponível - tentando reconectar...")
            if init_futronic_sdk():
                print("[Biometric] SDK Futronic reconectado com sucesso!")
                DEVICE_INFO['sdk'] = 'futronic_native'
            else:
                print("[Biometric] Falha ao reconectar SDK Futronic")

        # =====================================================
        # PRIORIDADE 1: SDK Futronic nativo
        # =====================================================
        if FUTRONIC_SDK_AVAILABLE:
            print("[Biometric] Usando SDK Futronic nativo...")
            import asyncio
            import concurrent.futures

            try:
                loop = asyncio.get_event_loop()
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = loop.run_in_executor(executor, capturar_com_futronic_sdk, 30)
                    sample_data, error = await asyncio.wait_for(future, timeout=35)

                if sample_data and not error:
                    template_b64 = base64.b64encode(sample_data).decode('utf-8')
                    print(f"[Biometric] Sucesso! Template capturado: {len(sample_data)} bytes")

                    return {
                        "success": True,
                        "template_base64": template_b64,
                        "quality": 85,
                        "message": "Digital capturada com sucesso (SDK Futronic)!",
                        "device_info": get_safe_device_info(DEVICE_INFO),
                        "simulated": False,
                        "sdk_used": "futronic_native"
                    }
                elif error:
                    print(f"[Biometric] Erro SDK Futronic: {error}")
                    if "Timeout" in str(error):
                        return {
                            "success": False,
                            "error": error,
                            "message": "Coloque o dedo no leitor e tente novamente"
                        }
                    # Continua para tentar WBF

            except asyncio.TimeoutError:
                return {
                    "success": False,
                    "error": "Timeout - nenhuma digital detectada em 30 segundos",
                    "message": "Coloque o dedo no leitor e tente novamente"
                }
            except Exception as e:
                print(f"[Biometric] Erro SDK Futronic: {e}")
                # Continua para tentar WBF

        # =====================================================
        # PRIORIDADE 2: Windows Biometric Framework
        # =====================================================
        if sys.platform == "win32":
            import asyncio
            import concurrent.futures

            try:
                print("[Biometric] Tentando Windows Biometric Framework...")
                loop = asyncio.get_event_loop()
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = loop.run_in_executor(executor, capturar_com_wbf, 30)
                    sample_data, error = await asyncio.wait_for(future, timeout=35)

                if sample_data and not error:
                    template_b64 = base64.b64encode(sample_data).decode('utf-8')
                    print(f"[Biometric] Sucesso! Template gerado: {len(sample_data)} bytes")

                    return {
                        "success": True,
                        "template_base64": template_b64,
                        "quality": 80,
                        "message": "Digital capturada com sucesso!",
                        "device_info": get_safe_device_info(DEVICE_INFO),
                        "simulated": False
                    }
                elif error:
                    print(f"[Biometric] Erro WBF: {error}")

                    # Verifica se e um erro de driver WBF nao disponivel
                    wbf_driver_errors = [
                        "WBF_NO_DEVICE",
                        "WBF_NOT_AVAILABLE",
                        "WBF_SERVICE_DISABLED",
                        "WBF_ACCESS_DENIED",
                        "0x80070005",  # ACCESS_DENIED
                        "0x80098003",  # No WBF device
                        "0x80070490",  # Element not found
                    ]

                    is_wbf_missing = any(err in str(error) for err in wbf_driver_errors)

                    # NAO usa simulacao - retorna erro
                    return {
                        "success": False,
                        "error": error,
                        "message": "Falha na captura. Coloque o dedo no leitor e tente novamente.",
                        "wbf_error": True,
                        "hint": "Se o problema persistir, verifique se o SDK Futronic esta funcionando"
                    }

            except asyncio.TimeoutError:
                return {
                    "success": False,
                    "error": "Timeout - nenhuma digital detectada em 30 segundos",
                    "message": "Coloque o dedo no leitor e tente novamente"
                }
            except Exception as e:
                print(f"[Biometric] Erro na captura: {e}")
                # NAO usa simulacao - retorna erro
                return {
                    "success": False,
                    "error": str(e),
                    "message": "Erro na captura. Coloque o dedo no leitor e tente novamente."
                }

        # Para outros sistemas operacionais - NAO usa simulacao
        print("[Biometric] Nenhum SDK disponivel para captura real")
        return {
            "success": False,
            "error": "Nenhum SDK de captura disponivel",
            "message": "SDK Futronic ou WBF nao disponivel. Verifique a instalacao."
        }

    except Exception as e:
        print(f"[Biometric] Erro em /capturar: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/cadastrar")
async def cadastrar_digital(request: CadastrarRequest):
    """
    Cadastra uma digital no sistema.

    Pode receber o template ja capturado (template_base64) ou
    capturar uma nova digital do leitor.
    """
    try:
        print(f"[Futronic] Cadastrando: {request.nome} (ID: {request.funcionario_id})")

        template_data = None

        if request.template_base64:
            # Template ja fornecido
            template_data = base64.b64decode(request.template_base64)
        elif DEVICE_CONNECTED:
            # Captura do leitor
            # TODO: Implementar captura real
            return {
                "success": False,
                "error": "Forneca o template_base64 ou use o modo simulacao"
            }
        else:
            return {
                "success": False,
                "error": "Leitor nao conectado e template nao fornecido"
            }

        # Salva template no cache
        templates_cache[str(request.funcionario_id)] = {
            "nome": request.nome,
            "pis": request.pis,
            "template": request.template_base64,
            "cadastrado_em": datetime.now().isoformat()
        }
        save_templates_cache()

        # Salva template em arquivo separado (backup)
        template_file = TEMPLATES_DIR / f"{request.funcionario_id}.bin"
        with open(template_file, "wb") as f:
            f.write(template_data)

        print(f"[Futronic] Cadastrado com sucesso: {request.nome}")

        return {
            "success": True,
            "funcionario_id": request.funcionario_id,
            "nome": request.nome,
            "message": "Digital cadastrada com sucesso"
        }

    except Exception as e:
        print(f"[Futronic] Erro ao cadastrar: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/verificar")
async def verificar_digital(request: VerificarRequest):
    """
    Verifica uma digital contra as cadastradas.

    Retorna o funcionario correspondente se encontrar match.
    """
    try:
        if not templates_cache:
            return {
                "success": False,
                "error": "Nenhuma digital cadastrada"
            }

        # Decodifica template da requisicao
        query_template = base64.b64decode(request.template_base64)

        # Compara com todas as digitais cadastradas
        best_match = None
        best_score = 0.0

        for func_id, data in templates_cache.items():
            cached_template = base64.b64decode(data["template"])

            # Compara templates
            is_match, score = compare_templates(query_template, cached_template)

            if is_match and score > best_score:
                best_score = score
                best_match = {
                    "funcionario_id": int(func_id),
                    "nome": data["nome"],
                    "pis": data["pis"],
                    "score": score
                }

        if best_match:
            print(f"[Futronic] Identificado: {best_match['nome']} (score: {best_score:.2%})")
            return {
                "success": True,
                "funcionario_id": best_match["funcionario_id"],
                "nome": best_match["nome"],
                "pis": best_match["pis"],
                "confidence": best_score
            }
        else:
            print(f"[Futronic] Nao identificado (melhor score: {best_score:.2%})")
            return {
                "success": False,
                "error": "Digital nao reconhecida"
            }

    except Exception as e:
        print(f"[Futronic] Erro ao verificar: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/remover/{funcionario_id}")
async def remover_digital(funcionario_id: int):
    """Remove uma digital cadastrada"""
    try:
        func_id_str = str(funcionario_id)

        # Remove do cache
        if func_id_str in templates_cache:
            del templates_cache[func_id_str]
            save_templates_cache()

        # Remove arquivo de template
        template_file = TEMPLATES_DIR / f"{funcionario_id}.bin"
        if template_file.exists():
            template_file.unlink()

        print(f"[Futronic] Removido: ID {funcionario_id}")

        return {
            "success": True,
            "message": f"Digital {funcionario_id} removida"
        }

    except Exception as e:
        print(f"[Futronic] Erro ao remover: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/listar")
async def listar_digitais():
    """Lista todas as digitais cadastradas"""
    digitais = []
    for func_id, data in templates_cache.items():
        digitais.append({
            "funcionario_id": int(func_id),
            "nome": data["nome"],
            "pis": data["pis"],
            "cadastrado_em": data.get("cadastrado_em")
        })

    return {
        "success": True,
        "total": len(digitais),
        "digitais": digitais
    }


@app.post("/sincronizar")
async def sincronizar():
    """Recarrega o cache de templates do disco"""
    load_templates_cache()
    return {
        "success": True,
        "templates_carregados": len(templates_cache)
    }


# ============================================
# ENDPOINTS DE SIMULACAO (para testes)
# ============================================

@app.post("/simular/captura")
async def simular_captura():
    """
    Simula uma captura de digital.

    Retorna um template fake para testes quando o leitor
    nao esta conectado.
    """
    # Gera template simulado
    fake_template = os.urandom(256)  # 256 bytes aleatorios
    template_b64 = base64.b64encode(fake_template).decode('utf-8')

    return {
        "success": True,
        "template_base64": template_b64,
        "message": "Template simulado (nao usar em producao)",
        "simulated": True
    }


@app.post("/simular/verificacao")
async def simular_verificacao(funcionario_id: int = 1):
    """
    Simula uma verificacao bem-sucedida.

    Retorna o funcionario especificado se estiver cadastrado.
    """
    func_id_str = str(funcionario_id)

    if func_id_str in templates_cache:
        data = templates_cache[func_id_str]
        return {
            "success": True,
            "funcionario_id": funcionario_id,
            "nome": data["nome"],
            "pis": data["pis"],
            "confidence": 0.95,
            "simulated": True
        }
    else:
        return {
            "success": False,
            "error": f"Funcionario {funcionario_id} nao cadastrado",
            "simulated": True
        }


# ============================================
# MAIN
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
