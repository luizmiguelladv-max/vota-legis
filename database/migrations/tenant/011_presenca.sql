-- Migration: Funcionalidade de Marcacao de Presenca
-- Para funcionarios que precisam confirmar presenca periodicamente (ex: guardas noturnos)

-- Adicionar coluna no funcionario para intervalo de presenca
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS
  intervalo_presenca INTEGER DEFAULT NULL;
-- NULL = nao precisa marcar presenca
-- Valor em minutos (ex: 30 = a cada 30 min)

-- Tabela de registros de presenca
CREATE TABLE IF NOT EXISTS registros_presenca (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    precisao_gps INTEGER,
    foto_registro TEXT,
    observacao TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_presenca_funcionario ON registros_presenca(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_presenca_data ON registros_presenca(data_hora);
CREATE INDEX IF NOT EXISTS idx_presenca_funcionario_data ON registros_presenca(funcionario_id, data_hora);

-- Comentarios
COMMENT ON COLUMN funcionarios.intervalo_presenca IS 'Intervalo em minutos para marcar presenca. NULL = nao precisa marcar';
COMMENT ON TABLE registros_presenca IS 'Registros de presenca periodica (rondas, vigilancia)';
