#!/bin/sh
set -e

echo "==================================="
echo "Sistema (base ponto-eletronico)"
echo "==================================="

echo "Aguardando conexao com o banco de dados..."
sleep 5

echo "Executando migrations..."
node build/ace.js migration:run --force

if [ "${RUN_SEEDERS:-false}" = "true" ]; then
  echo "Executando seeders..."
  node build/ace.js db:seed
fi

echo "Iniciando servidor na porta ${PORT:-3333}..."
exec node build/bin/server.js

