# Futronic API

Microservico Python para leitura de digitais usando o leitor Futronic FS80H.

## Hardware Suportado

- **Futronic FS80H** (USB Fingerprint Scanner)
  - Interface: USB 2.0
  - Sensor: Area type
  - Resolucao: 500 DPI
  - Area de captura: 16x18mm

## Instalacao

### Windows

```cmd
install.bat
```

### Linux

```bash
chmod +x install.sh
./install.sh
```

## Execucao

### Windows

```cmd
venv\Scripts\activate
python main.py
```

### Linux

```bash
source venv/bin/activate
python main.py
```

O servidor estara disponivel em: http://localhost:5001

## Endpoints

| Endpoint | Metodo | Descricao |
|----------|--------|-----------|
| `/` | GET | Status do servico |
| `/health` | GET | Health check |
| `/device/status` | GET | Status do dispositivo |
| `/device/reconnect` | POST | Tenta reconectar ao leitor |
| `/capturar` | POST | Captura uma digital do leitor |
| `/cadastrar` | POST | Cadastra uma digital |
| `/verificar` | POST | Verifica digital contra cadastradas |
| `/remover/:id` | DELETE | Remove digital cadastrada |
| `/listar` | GET | Lista digitais cadastradas |
| `/sincronizar` | POST | Recarrega cache de templates |
| `/simular/captura` | POST | Simula captura (para testes) |
| `/simular/verificacao` | POST | Simula verificacao (para testes) |

## Exemplo de Uso

### Cadastrar Digital

```bash
curl -X POST http://localhost:5001/cadastrar \
  -H "Content-Type: application/json" \
  -d '{
    "funcionario_id": 1,
    "nome": "Joao Silva",
    "pis": "12345678901",
    "template_base64": "base64_do_template..."
  }'
```

### Verificar Digital

```bash
curl -X POST http://localhost:5001/verificar \
  -H "Content-Type: application/json" \
  -d '{
    "template_base64": "base64_do_template..."
  }'
```

## Estrutura de Diretorios

```
futronic-api/
├── main.py              # Servidor FastAPI
├── requirements.txt     # Dependencias Python
├── install.sh           # Script de instalacao (Linux)
├── install.bat          # Script de instalacao (Windows)
├── templates/           # Templates de digitais
│   └── *.bin           # Arquivos de template
└── venv/               # Ambiente virtual Python
```

## SDK Futronic

Para captura real de digitais, e necessario:

1. **Windows**: Instalar driver Futronic FS80H
2. **Linux**: Instalar libusb e regras udev

### Regras udev (Linux)

O script `install.sh` cria automaticamente o arquivo `/etc/udev/rules.d/99-futronic.rules`:

```
SUBSYSTEM=="usb", ATTRS{idVendor}=="0b38", ATTRS{idProduct}=="0003", MODE="0666", GROUP="plugdev"
```

## Integracao com AdonisJS

Use o servico TypeScript:

```typescript
import { futronicService } from '#services/futronic_service'

// Verificar disponibilidade
const disponivel = await futronicService.isAvailable()

// Cadastrar digital
const resultado = await futronicService.cadastrarDigital(
  funcionarioId,
  nome,
  pis,
  templateBase64
)

// Verificar digital
const match = await futronicService.verificarDigital(templateBase64)
if (match.success) {
  console.log(`Identificado: ${match.nome}`)
}
```

## Notas

- O leitor **ainda nao chegou**, entao a implementacao atual usa simulacao
- Quando o SDK Futronic estiver disponivel, a funcao `init_device()` sera atualizada
- Os endpoints de simulacao (`/simular/*`) sao apenas para testes
