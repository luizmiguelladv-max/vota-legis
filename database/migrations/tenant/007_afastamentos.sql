-- Tabela de Afastamentos
CREATE TABLE IF NOT EXISTS afastamentos (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Tipo de afastamento
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'FERIAS', 'FERIAS_ABONO', 
        'ATESTADO_MEDICO', 'ATESTADO_ACOMPANHANTE',
        'LICENCA_MATERNIDADE', 'LICENCA_PATERNIDADE', 'LICENCA_MEDICA', 'LICENCA_CASAMENTO', 'LICENCA_OBITO', 'LICENCA_JUDICIAL',
        'SUSPENSAO', 'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA',
        'AFASTAMENTO_INSS', 'SERVICO_MILITAR', 'FOLGA_COMPENSATORIA'
    )),
    
    -- Período
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    dias_uteis INTEGER,
    dias_corridos INTEGER,
    
    -- Detalhes
    cid VARCHAR(10),  -- Para atestados médicos
    motivo TEXT,
    observacao TEXT,
    
    -- Documentação
    documento_url TEXT,  -- Upload do documento
    
    -- Aprovação
    status VARCHAR(20) DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO')),
    aprovado_por INTEGER,
    aprovado_em TIMESTAMPTZ,
    motivo_rejeicao TEXT,
    
    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_afastamentos_funcionario ON afastamentos(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_afastamentos_tipo ON afastamentos(tipo);
CREATE INDEX IF NOT EXISTS idx_afastamentos_datas ON afastamentos(data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_afastamentos_status ON afastamentos(status);

-- Tabela de controle de Férias
CREATE TABLE IF NOT EXISTS ferias_periodos (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Período aquisitivo
    periodo_aquisitivo_inicio DATE NOT NULL,
    periodo_aquisitivo_fim DATE NOT NULL,
    
    -- Direito
    dias_direito INTEGER DEFAULT 30,
    dias_gozados INTEGER DEFAULT 0,
    dias_vendidos INTEGER DEFAULT 0,
    dias_saldo INTEGER GENERATED ALWAYS AS (dias_direito - dias_gozados - dias_vendidos) STORED,
    
    -- Status
    status VARCHAR(20) DEFAULT 'DISPONIVEL' CHECK (status IN ('DISPONIVEL', 'PROGRAMADO', 'GOZADO', 'VENCIDO')),
    
    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ferias_funcionario ON ferias_periodos(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_ferias_periodo ON ferias_periodos(periodo_aquisitivo_inicio, periodo_aquisitivo_fim);
