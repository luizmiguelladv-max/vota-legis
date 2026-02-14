# DeepFace API - Dockerfile
# Build: docker build -t deepface-api .
# Run: docker run -d -p 5000:5000 -v ./faces:/app/faces deepface-api

FROM python:3.11-slim

# Instala dependências do sistema
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia requirements primeiro (cache de camadas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia código
COPY main.py .

# Cria diretório de faces
RUN mkdir -p /app/faces

# Expõe porta
EXPOSE 5000

# Comando de inicialização
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
