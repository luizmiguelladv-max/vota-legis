"""
Teste do SDK Futronic - Carrega DLL e tenta abrir o dispositivo
"""
import ctypes
from ctypes import c_void_p, c_int, c_bool, byref, create_string_buffer
from pathlib import Path
import sys

print("=" * 60)
print("  Teste SDK Futronic - ftrScanAPI.dll")
print("=" * 60)

# Verifica se a DLL existe
dll_path = Path(__file__).parent / "ftrScanAPI.dll"
print(f"\n1. Verificando DLL...")
print(f"   Caminho: {dll_path}")
print(f"   Existe: {dll_path.exists()}")

if not dll_path.exists():
    print("\n   ERRO: DLL nao encontrada!")
    sys.exit(1)

# Carrega a DLL
print(f"\n2. Carregando DLL...")
try:
    ftrScanAPI = ctypes.WinDLL(str(dll_path))
    print("   OK - DLL carregada!")
except Exception as e:
    print(f"   ERRO ao carregar DLL: {e}")
    sys.exit(1)

# Define tipos de retorno
print(f"\n3. Configurando funcoes...")
try:
    ftrScanAPI.ftrScanOpenDevice.restype = c_void_p
    ftrScanAPI.ftrScanCloseDevice.argtypes = [c_void_p]
    ftrScanAPI.ftrScanGetImageSize.argtypes = [c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
    ftrScanAPI.ftrScanGetImageSize.restype = c_bool
    ftrScanAPI.ftrScanIsFingerPresent.argtypes = [c_void_p, ctypes.POINTER(c_bool)]
    ftrScanAPI.ftrScanIsFingerPresent.restype = c_bool
    ftrScanAPI.ftrScanGetImage.argtypes = [c_void_p, c_int, c_void_p]
    ftrScanAPI.ftrScanGetImage.restype = c_bool
    print("   OK - Funcoes configuradas!")
except Exception as e:
    print(f"   ERRO: {e}")
    sys.exit(1)

# Abre o dispositivo
print(f"\n4. Abrindo dispositivo...")
try:
    handle = ftrScanAPI.ftrScanOpenDevice()
    print(f"   Handle retornado: {handle}")

    if handle:
        print("   OK - Dispositivo aberto!")

        # Tenta obter o tamanho da imagem
        print(f"\n5. Obtendo tamanho da imagem...")
        width = ctypes.c_int()
        height = ctypes.c_int()

        result = ftrScanAPI.ftrScanGetImageSize(handle, byref(width), byref(height))
        print(f"   Resultado: {result}")
        print(f"   Largura: {width.value}")
        print(f"   Altura: {height.value}")

        # Verifica se tem dedo
        print(f"\n6. Verificando se ha dedo no leitor...")
        present = c_bool()
        result = ftrScanAPI.ftrScanIsFingerPresent(handle, byref(present))
        print(f"   Resultado: {result}")
        print(f"   Dedo presente: {present.value}")

        # Fecha o dispositivo
        print(f"\n7. Fechando dispositivo...")
        ftrScanAPI.ftrScanCloseDevice(handle)
        print("   OK - Dispositivo fechado!")

    else:
        # Tenta obter o erro
        print("   FALHA - Handle nulo!")
        print("   Possíveis causas:")
        print("   - Driver nao instalado")
        print("   - Dispositivo em uso por outro programa")
        print("   - Dispositivo nao conectado")

except Exception as e:
    print(f"   ERRO: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("  Teste finalizado")
print("=" * 60)
