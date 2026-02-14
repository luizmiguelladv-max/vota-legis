-- Script para recriar tabela banco_horas com estrutura correta
-- Execute isso manualmente se a migration não criou as colunas

-- Remove tabela existente (se houver dados, faça backup antes!)
DROP TABLE IF EXISTS banco_horas CASCADE;

-- Recria a tabela
CREATE TABLE banco_horas (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Data e tipo
    data DATE NOT NULL,
    tipo_operacao VARCHAR(20) NOT NULL 
        CHECK (tipo_operacao IN ('CREDITO', 'DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO', 'AJUSTE')),
    
    -- Valores em minutos
    minutos INTEGER NOT NULL,
    saldo_anterior INTEGER DEFAULT 0,
    saldo_atual INTEGER DEFAULT 0,
    
    -- Origem
    origem VARCHAR(30) DEFAULT 'AUTOMATICO' 
        CHECK (origem IN ('AUTOMATICO', 'MANUAL', 'IMPORTACAO')),
    espelho_ponto_id INTEGER REFERENCES espelhos_ponto(id),
    
    -- Detalhes
    descricao TEXT,
    observacao TEXT,
    
    -- Aprovação
    aprovado BOOLEAN DEFAULT false,
    aprovado_por INTEGER REFERENCES funcionarios(id),
    aprovado_em TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banco_horas_funcionario ON banco_horas(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_banco_horas_data ON banco_horas(data);
CREATE INDEX IF NOT EXISTS idx_banco_horas_tipo ON banco_horas(tipo_operacao);
CREATE INDEX IF NOT EXISTS idx_banco_horas_aprovado ON banco_horas(aprovado);
