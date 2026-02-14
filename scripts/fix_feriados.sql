-- Corrigir tabela feriados
ALTER TABLE santo_andre.feriados ADD COLUMN IF NOT EXISTS descricao VARCHAR(255);
ALTER TABLE santo_andre.feriados ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'MUNICIPAL';
ALTER TABLE santo_andre.feriados ADD COLUMN IF NOT EXISTS recorrente BOOLEAN DEFAULT FALSE;
ALTER TABLE santo_andre.feriados ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;

-- Verificar
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'santo_andre' AND table_name = 'feriados';
