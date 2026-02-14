# DeepFace API - Reconhecimento Facial

Microserviço de reconhecimento facial para o Sistema de Ponto Eletrônico.

## Características

- **Precisão**: 99.5% (modelo ArcFace)
- **Custo**: 100% gratuito (roda local)
- **Latência**: ~200ms por reconhecimento
- **Sem limites**: Quantidade ilimitada de transações

## Requisitos

- Python 3.8+
- 2GB RAM mínimo
- ~500MB de disco para modelos

## Instalação (Linux)

```bash
# Acesse a pasta
cd deepface-api

# Torne o script executável
chmod +x install.sh

# Execute a instalação
./install.sh
```

O script irá:
1. Criar ambiente virtual Python
2. Instalar dependências (DeepFace, FastAPI, etc.)
3. Configurar serviço systemd
4. Iniciar automaticamente na porta 5000

## Instalação Manual

```bash
# Cria ambiente virtual
python3 -m venv venv

# Ativa ambiente
source venv/bin/activate

# Instala dependências
pip install -r requirements.txt

# Inicia servidor
python main.py
```

## Docker

```bash
# Build
docker build -t deepface-api .

# Run
docker run -d -p 5000:5000 -v ./faces:/app/faces deepface-api
```

## Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Status do serviço |
| GET | `/health` | Health check |
| POST | `/cadastrar` | Cadastra nova face |
| POST | `/reconhecer` | Reconhece face |
| DELETE | `/remover/{id}` | Remove face cadastrada |
| GET | `/listar` | Lista faces cadastradas |
| POST | `/sincronizar` | Recarrega cache |

## Exemplo de Uso

### Cadastrar Face

```bash
curl -X POST http://localhost:5000/cadastrar \
  -H "Content-Type: application/json" \
  -d '{
    "funcionario_id": 1,
    "nome": "João Silva",
    "pis": "12345678901",
    "foto_base64": "data:image/jpeg;base64,..."
  }'
```

### Reconhecer Face

```bash
curl -X POST http://localhost:5000/reconhecer \
  -H "Content-Type: application/json" \
  -d '{"foto_base64": "data:image/jpeg;base64,..."}'
```

## Comandos Úteis (systemd)

```bash
# Ver status
sudo systemctl status deepface-api

# Reiniciar
sudo systemctl restart deepface-api

# Ver logs
sudo journalctl -u deepface-api -f

# Parar
sudo systemctl stop deepface-api
```

## Integração com AdonisJS

O AdonisJS se comunica com esta API através do serviço `deepface_service.ts`.

Endpoints no AdonisJS:
- `GET /api/deepface/status` - Status
- `POST /api/deepface/cadastrar/:id` - Cadastrar
- `POST /api/deepface/reconhecer` - Reconhecer
- `POST /api/deepface/sincronizar` - Sincronizar todas as fotos

## Modelos Disponíveis

O DeepFace suporta vários modelos. Altere `MODEL_NAME` em `main.py`:

| Modelo | Precisão | Velocidade |
|--------|----------|------------|
| ArcFace | 99.5% | Média (padrão) |
| Facenet512 | 99.65% | Lenta |
| VGG-Face | 98.78% | Rápida |
| OpenFace | 93.80% | Muito rápida |

## Troubleshooting

### Erro: "No face detected"
- Verifique se a imagem contém um rosto visível
- Aumente a iluminação
- Centralize o rosto na imagem

### Erro: "Model download failed"
- Verifique conexão com internet (primeiro uso)
- Os modelos são baixados automaticamente (~300MB)

### Lentidão no primeiro reconhecimento
- Normal: o modelo é carregado na primeira chamada
- Subsequentes são muito mais rápidos
