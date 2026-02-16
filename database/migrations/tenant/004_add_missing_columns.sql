-- Script para adicionar colunas faltantes na tabela banco_horas
-- Execute este SQL diretamente no banco de dados do município

-- Adiciona coluna aprovado se não existir
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado BOOLEAN DEFAULT false;

-- Adiciona coluna aprovado_por se não existir
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado_por INTEGER REFERENCES funcionarios(id);

-- Adiciona coluna aprovado_em se não existir
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;

-- Cria índice se não existir
CREATE INDEX IF NOT EXISTS idx_banco_horas_aprovado ON banco_horas(aprovado);

-- Verifica as colunas
SELECT column_name FROM information_schema.columns WHERE table_name = 'banco_horas';
