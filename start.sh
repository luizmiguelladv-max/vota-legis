#!/bin/sh
set -e

echo "==================================="
echo "Sistema de Votacao Legislativa"
echo "==================================="

# Wait for database to be ready
echo "Aguardando conexao com o banco de dados..."
sleep 5

# Run migrations
echo "Executando migrations..."
node ace migration:run --force

# Run seeders (only if needed)
if [ "$RUN_SEEDERS" = "true" ]; then
    echo "Executando seeders..."
    node ace db:seed
fi

# Start the server
echo "Iniciando servidor na porta ${PORT:-3333}..."
exec node bin/server.js
