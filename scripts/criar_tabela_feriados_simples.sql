-- Script SIMPLES para criar tabela de feriados
-- Execute no Supabase SQL Editor

-- Criar tabela de feriados
CREATE TABLE IF NOT EXISTS santo_andre.feriados (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) DEFAULT 'MUNICIPAL',
    recorrente BOOLEAN DEFAULT FALSE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Criar índice
CREATE INDEX IF NOT EXISTS idx_feriados_data ON santo_andre.feriados(data);

-- Verificar
SELECT 'Tabela feriados criada!' as resultado;
SELECT COUNT(*) as total_feriados FROM santo_andre.feriados;
