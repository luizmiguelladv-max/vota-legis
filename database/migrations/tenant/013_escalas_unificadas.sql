-- ============================================================================
-- MIGRAÇÃO: Unificar escalas, folgas e plantões
-- Data: 24/01/2026
-- Aplicar em TODOS os schemas de tenant!
-- ============================================================================

CREATE TABLE IF NOT EXISTS escalas (
  id SERIAL PRIMARY KEY,
  funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  turno VARCHAR(20),
  horario_inicio TIME,
  horario_fim TIME,
  setor_id INTEGER,
  substituido_por INTEGER REFERENCES funcionarios(id) ON DELETE SET NULL,
  substitui_id INTEGER,
  motivo VARCHAR(500),
  observacao TEXT,
  status VARCHAR(20) DEFAULT 'ATIVO',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalas_funcionario ON escalas(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_escalas_data ON escalas(data);
CREATE INDEX IF NOT EXISTS idx_escalas_tipo ON escalas(tipo);
CREATE INDEX IF NOT EXISTS idx_escalas_funcionario_data ON escalas(funcionario_id, data);

-- Migrar folgas_programadas
INSERT INTO escalas (funcionario_id, data, tipo, motivo, created_by, created_at)
SELECT funcionario_id, data, 
  CASE WHEN tipo = 'COMPENSACAO' THEN 'COMPENSACAO' ELSE 'FOLGA' END,
  motivo, created_by, created_at
FROM folgas_programadas
ON CONFLICT DO NOTHING;

-- Migrar plantoes
INSERT INTO escalas (funcionario_id, data, tipo, turno, substituido_por, motivo, status, created_at)
SELECT funcionario_id, data, 'PLANTAO', turno, substituido_por, motivo_alteracao,
  COALESCE(status, 'ATIVO'), created_at
FROM plantoes
ON CONFLICT DO NOTHING;
