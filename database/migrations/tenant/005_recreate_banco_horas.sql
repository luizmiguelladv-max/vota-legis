-- Drop e Recria tabela banco_horas com estrutura completa
DROP TABLE IF EXISTS banco_horas CASCADE;

CREATE TABLE banco_horas (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,

    data DATE NOT NULL,
    tipo_operacao VARCHAR(20) NOT NULL
        CHECK (tipo_operacao IN ('CREDITO', 'DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO', 'AJUSTE')),

    minutos INTEGER NOT NULL,
    saldo_anterior INTEGER DEFAULT 0,
    saldo_atual INTEGER DEFAULT 0,

    origem VARCHAR(30) DEFAULT 'MANUAL'
        CHECK (origem IN ('AUTOMATICO', 'MANUAL', 'IMPORTACAO')),

    descricao TEXT,
    observacao TEXT,

    -- Colunas de aprovação
    aprovado BOOLEAN DEFAULT false,
    aprovado_por INTEGER REFERENCES funcionarios(id),
    aprovado_em TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_banco_horas_funcionario ON banco_horas(funcionario_id);
CREATE INDEX idx_banco_horas_data ON banco_horas(data);
CREATE INDEX idx_banco_horas_tipo ON banco_horas(tipo_operacao);
CREATE INDEX idx_banco_horas_aprovado ON banco_horas(aprovado);
