-- Adiciona colunas de aprovação na tabela banco_horas
-- Este script adiciona suporte a workflow de aprovação para lançamentos do banco de horas

-- Coluna para indicar se o lançamento está aprovado
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado BOOLEAN DEFAULT false;

-- Quem aprovou
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado_por INTEGER REFERENCES funcionarios(id);

-- Quando foi aprovado
ALTER TABLE banco_horas ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;

-- Índice para buscas por status de aprovação
CREATE INDEX IF NOT EXISTS idx_banco_horas_aprovado ON banco_horas(aprovado);
