"""
DeepFace API - Microservico de Reconhecimento Facial
=====================================================

API REST para reconhecimento facial usando DeepFace.
Roda na porta 5000 e e chamado pelo AdonisJS.

Modelos disponiveis (em ordem de precisao):
- ArcFace: 99.5% (recomendado, bom equilibrio)
- Facenet512: 99.65% (mais preciso, mais lento)
- VGG-Face: 98.78% (mais rapido, menos preciso)

Uso:
    python main.py
    ou
    uvicorn main:app --host 0.0.0.0 --port 5000
"""

import os
import sys
import base64
import json
import shutil

# Corrige encoding para Windows (evita erros com emojis do DeepFace)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    os.environ['PYTHONIOENCODING'] = 'utf-8'
from io import BytesIO
from pathlib import Path
from typing import Optional
import numpy as np
from PIL import Image

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from deepface import DeepFace

# Configurações
FACES_DIR = Path("./faces")  # Diretório para armazenar faces cadastradas
MODEL_NAME = "ArcFace"  # Modelo de reconhecimento (ArcFace = 99.5% precisão)
DETECTOR_BACKEND = "opencv"  # Detector de faces (opencv é mais rápido)
DISTANCE_METRIC = "cosine"  # Métrica de distância
THRESHOLD = 0.68  # Threshold para match (menor = mais restritivo)

# Cria diretório de faces se não existir
FACES_DIR.mkdir(parents=True, exist_ok=True)

# Inicializa FastAPI
app = FastAPI(
    title="DeepFace API",
    description="API de reconhecimento facial para o sistema de ponto eletrônico",
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

# Cache de embeddings para performance
embeddings_cache = {}


class RegisterRequest(BaseModel):
    """Request para cadastrar face"""
    funcionario_id: int
    nome: str
    pis: str
    foto_base64: str


class RecognizeRequest(BaseModel):
    """Request para reconhecer face"""
    foto_base64: str


class StatusResponse(BaseModel):
    """Response de status"""
    status: str
    model: str
    faces_cadastradas: int
    version: str


def base64_to_image(base64_string: str) -> np.ndarray:
    """Converte base64 para numpy array (formato que DeepFace espera)"""
    # Remove prefixo data:image/...;base64, se existir
    if "base64," in base64_string:
        base64_string = base64_string.split("base64,")[1]

    image_data = base64.b64decode(base64_string)
    image = Image.open(BytesIO(image_data))

    # Converte para RGB se necessário
    if image.mode != "RGB":
        image = image.convert("RGB")

    return np.array(image)


def save_face_image(funcionario_id: int, image_array: np.ndarray) -> str:
    """Salva imagem da face no diretório"""
    face_path = FACES_DIR / f"{funcionario_id}.jpg"
    image = Image.fromarray(image_array)
    image.save(face_path, "JPEG", quality=95)
    return str(face_path)


def load_embeddings_cache():
    """Carrega cache de embeddings do disco"""
    global embeddings_cache
    cache_file = FACES_DIR / "embeddings_cache.json"

    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                embeddings_cache = json.load(f)
            print(f"[DeepFace] Cache carregado: {len(embeddings_cache)} faces")
        except Exception as e:
            print(f"[DeepFace] Erro ao carregar cache: {e}")
            embeddings_cache = {}


def save_embeddings_cache():
    """Salva cache de embeddings no disco"""
    cache_file = FACES_DIR / "embeddings_cache.json"
    try:
        with open(cache_file, "w") as f:
            json.dump(embeddings_cache, f)
    except Exception as e:
        print(f"[DeepFace] Erro ao salvar cache: {e}")


def get_embedding(image_array: np.ndarray) -> list:
    """Extrai embedding (vetor facial) de uma imagem"""
    try:
        result = DeepFace.represent(
            img_path=image_array,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True
        )
        return result[0]["embedding"]
    except Exception as e:
        print(f"[DeepFace] Erro ao extrair embedding: {e}")
        raise


@app.on_event("startup")
async def startup_event():
    """Inicializacao do servidor"""
    print("[DeepFace] Iniciando servidor...")
    print(f"[DeepFace] Modelo: {MODEL_NAME}")
    print(f"[DeepFace] Detector: {DETECTOR_BACKEND}")
    print(f"[DeepFace] Threshold: {THRESHOLD}")

    # Carrega cache
    load_embeddings_cache()

    # Pre-carrega o modelo (primeira execucao e mais lenta)
    print("[DeepFace] Carregando modelo (pode demorar na primeira vez)...")
    try:
        # Cria uma imagem dummy para forcar carregamento do modelo
        dummy = np.zeros((100, 100, 3), dtype=np.uint8)
        dummy[30:70, 30:70] = [255, 200, 150]  # Cor de pele aproximada
        DeepFace.represent(
            img_path=dummy,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False
        )
        print("[DeepFace] Modelo carregado com sucesso!")
    except Exception as e:
        # Trata erro de forma segura (evita problemas de encoding)
        error_msg = str(e).encode('ascii', 'replace').decode('ascii')
        print(f"[DeepFace] Aviso no pre-carregamento: {error_msg}")
        print("[DeepFace] O modelo sera carregado na primeira requisicao.")

    print("[DeepFace] Servidor pronto!")


@app.get("/", response_model=StatusResponse)
async def status():
    """Status do serviço"""
    faces_count = len(list(FACES_DIR.glob("*.jpg")))
    return StatusResponse(
        status="online",
        model=MODEL_NAME,
        faces_cadastradas=faces_count,
        version="1.0.0"
    )


@app.get("/health")
async def health():
    """Health check"""
    return {"status": "healthy"}


@app.post("/cadastrar")
async def cadastrar_face(request: RegisterRequest):
    """
    Cadastra uma nova face no sistema.

    - Recebe foto em base64
    - Extrai embedding facial
    - Salva imagem e embedding
    """
    try:
        print(f"[DeepFace] Cadastrando: {request.nome} (ID: {request.funcionario_id})")

        # Converte base64 para imagem
        image_array = base64_to_image(request.foto_base64)

        # Extrai embedding
        embedding = get_embedding(image_array)

        # Salva imagem
        face_path = save_face_image(request.funcionario_id, image_array)

        # Salva no cache
        embeddings_cache[str(request.funcionario_id)] = {
            "nome": request.nome,
            "pis": request.pis,
            "embedding": embedding,
            "face_path": face_path
        }
        save_embeddings_cache()

        print(f"[DeepFace] Cadastrado com sucesso: {request.nome}")

        return {
            "success": True,
            "funcionario_id": request.funcionario_id,
            "nome": request.nome,
            "message": "Face cadastrada com sucesso"
        }

    except Exception as e:
        print(f"[DeepFace] Erro ao cadastrar: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/reconhecer")
async def reconhecer_face(request: RecognizeRequest):
    """
    Reconhece uma face contra as cadastradas.

    - Recebe foto em base64
    - Extrai embedding
    - Compara com faces cadastradas
    - Retorna match com maior confiança
    """
    try:
        if not embeddings_cache:
            return {
                "success": False,
                "error": "Nenhuma face cadastrada"
            }

        # Converte base64 para imagem
        image_array = base64_to_image(request.foto_base64)

        # Extrai embedding da face a reconhecer
        try:
            query_embedding = get_embedding(image_array)
        except Exception as e:
            return {
                "success": False,
                "error": "Nenhuma face detectada na imagem"
            }

        # Compara com todas as faces cadastradas
        best_match = None
        best_distance = float("inf")

        query_embedding = np.array(query_embedding)

        for func_id, data in embeddings_cache.items():
            cached_embedding = np.array(data["embedding"])

            # Calcula distância coseno
            if DISTANCE_METRIC == "cosine":
                # Distância coseno: 1 - similaridade
                similarity = np.dot(query_embedding, cached_embedding) / (
                    np.linalg.norm(query_embedding) * np.linalg.norm(cached_embedding)
                )
                distance = 1 - similarity
            else:
                # Distância euclidiana
                distance = np.linalg.norm(query_embedding - cached_embedding)

            if distance < best_distance:
                best_distance = distance
                best_match = {
                    "funcionario_id": int(func_id),
                    "nome": data["nome"],
                    "pis": data["pis"],
                    "distance": float(distance)
                }

        # Verifica se passou no threshold
        if best_match and best_distance < THRESHOLD:
            confidence = 1 - (best_distance / THRESHOLD)  # Normaliza para 0-1
            confidence = max(0, min(1, confidence))  # Garante entre 0 e 1

            print(f"[DeepFace] Reconhecido: {best_match['nome']} (distância: {best_distance:.4f}, confiança: {confidence:.2%})")

            return {
                "success": True,
                "funcionario_id": best_match["funcionario_id"],
                "nome": best_match["nome"],
                "pis": best_match["pis"],
                "confidence": confidence,
                "distance": best_distance
            }
        else:
            print(f"[DeepFace] Não reconhecido (melhor distância: {best_distance:.4f}, threshold: {THRESHOLD})")
            return {
                "success": False,
                "error": "Face não reconhecida",
                "best_distance": float(best_distance) if best_match else None
            }

    except Exception as e:
        print(f"[DeepFace] Erro ao reconhecer: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/remover/{funcionario_id}")
async def remover_face(funcionario_id: int):
    """Remove uma face cadastrada"""
    try:
        func_id_str = str(funcionario_id)

        # Remove do cache
        if func_id_str in embeddings_cache:
            del embeddings_cache[func_id_str]
            save_embeddings_cache()

        # Remove arquivo de imagem
        face_path = FACES_DIR / f"{funcionario_id}.jpg"
        if face_path.exists():
            face_path.unlink()

        print(f"[DeepFace] Removido: ID {funcionario_id}")

        return {
            "success": True,
            "message": f"Face {funcionario_id} removida"
        }

    except Exception as e:
        print(f"[DeepFace] Erro ao remover: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/listar")
async def listar_faces():
    """Lista todas as faces cadastradas"""
    faces = []
    for func_id, data in embeddings_cache.items():
        faces.append({
            "funcionario_id": int(func_id),
            "nome": data["nome"],
            "pis": data["pis"]
        })

    return {
        "success": True,
        "total": len(faces),
        "faces": faces
    }


@app.post("/sincronizar")
async def sincronizar():
    """
    Recarrega o cache de embeddings do disco.
    Útil se as imagens foram adicionadas manualmente.
    """
    load_embeddings_cache()
    return {
        "success": True,
        "faces_carregadas": len(embeddings_cache)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
