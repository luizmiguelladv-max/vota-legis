-- Migração: Adicionar colunas GPS na tabela registros_ponto
-- Para usar com bancos de municípios existentes

-- Adicionar coluna latitude
ALTER TABLE registros_ponto ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8);

-- Adicionar coluna longitude
ALTER TABLE registros_ponto ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

-- Adicionar coluna precisao_gps (em metros)
ALTER TABLE registros_ponto ADD COLUMN IF NOT EXISTS precisao_gps INTEGER;

-- Adicionar coluna foto_registro (base64 da selfie)
ALTER TABLE registros_ponto ADD COLUMN IF NOT EXISTS foto_registro TEXT;

-- Atualizar constraint de origem para incluir novas origens
ALTER TABLE registros_ponto DROP CONSTRAINT IF EXISTS registros_ponto_origem_check;
ALTER TABLE registros_ponto ADD CONSTRAINT registros_ponto_origem_check
    CHECK (origem IN ('EQUIPAMENTO', 'MANUAL', 'IMPORTACAO', 'APP_MOBILE', 'FACIAL'));

-- Índice para buscas por localização (opcional)
CREATE INDEX IF NOT EXISTS idx_registros_ponto_gps ON registros_ponto(latitude, longitude)
    WHERE latitude IS NOT NULL;
