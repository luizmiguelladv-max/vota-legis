-- Tabela de aprovações de espelho de ponto
CREATE TABLE IF NOT EXISTS espelho_aprovacoes (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    competencia CHAR(7) NOT NULL,  -- Formato: 2024-12
    
    -- Status
    status VARCHAR(20) DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'REJEITADO', 'FECHADO')),
    
    -- Solicitação
    solicitado_em TIMESTAMPTZ,
    solicitado_por INTEGER,  -- Funcionário que solicitou
    
    -- Aprovação
    aprovador_id INTEGER,
    aprovado_em TIMESTAMPTZ,
    motivo_rejeicao TEXT,
    
    -- Assinatura
    assinatura_funcionario TEXT,  -- Base64 da assinatura digital
    assinatura_em TIMESTAMPTZ,
    
    -- Totalizadores
    horas_trabalhadas INTEGER DEFAULT 0,  -- Em minutos
    horas_extras INTEGER DEFAULT 0,
    horas_noturnas INTEGER DEFAULT 0,
    banco_horas_saldo INTEGER DEFAULT 0,
    faltas INTEGER DEFAULT 0,
    atrasos INTEGER DEFAULT 0,
    
    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_espelho_competencia UNIQUE (funcionario_id, competencia)
);

CREATE INDEX IF NOT EXISTS idx_espelho_funcionario ON espelho_aprovacoes(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_espelho_competencia ON espelho_aprovacoes(competencia);
CREATE INDEX IF NOT EXISTS idx_espelho_status ON espelho_aprovacoes(status);
CREATE INDEX IF NOT EXISTS idx_espelho_aprovador ON espelho_aprovacoes(aprovador_id);

-- Tabela de histórico de pendências/ajustes do espelho
CREATE TABLE IF NOT EXISTS espelho_pendencias (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    competencia CHAR(7) NOT NULL,
    
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('FALTA_ENTRADA', 'FALTA_SAIDA', 'ATRASO', 'SAIDA_ANTECIPADA', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA', 'AJUSTE_PENDENTE')),
    
    descricao TEXT,
    minutos_afetados INTEGER DEFAULT 0,
    
    -- Resolução
    resolvido BOOLEAN DEFAULT FALSE,
    resolvido_por INTEGER,
    resolvido_em TIMESTAMPTZ,
    justificativa TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pendencias_funcionario ON espelho_pendencias(funcionario_id, competencia);
