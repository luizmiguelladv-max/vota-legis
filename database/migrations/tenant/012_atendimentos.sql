-- Migration: Tabelas de Atendimentos (Visitas Domiciliares, Agentes de Saude)

-- Tabela de configuracoes de atendimento (metas por cargo/lotacao/funcionario)
CREATE TABLE IF NOT EXISTS atendimentos_config (
    id SERIAL PRIMARY KEY,
    cargo_id INTEGER REFERENCES cargos(id),
    lotacao_id INTEGER REFERENCES lotacoes(id),
    funcionario_id INTEGER REFERENCES funcionarios(id),
    tipo_atendimento VARCHAR(50) DEFAULT 'DOMICILIAR', -- DOMICILIAR, EXTERNO, VISITA
    meta_diaria INTEGER DEFAULT 0,
    meta_semanal INTEGER DEFAULT 0,
    meta_mensal INTEGER DEFAULT 0,
    tempo_minimo_minutos INTEGER DEFAULT 5,
    tempo_maximo_minutos INTEGER DEFAULT 120,
    exige_gps BOOLEAN DEFAULT true,
    exige_foto BOOLEAN DEFAULT false,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de atendimentos realizados
CREATE TABLE IF NOT EXISTS atendimentos (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    tipo_atendimento VARCHAR(50) DEFAULT 'DOMICILIAR', -- DOMICILIAR, EXTERNO, VISITA

    -- Dados do atendido
    nome_atendido VARCHAR(255),
    cpf_atendido VARCHAR(14),
    telefone_atendido VARCHAR(20),

    -- Endereco
    endereco VARCHAR(500),
    numero VARCHAR(20),
    complemento VARCHAR(100),
    bairro VARCHAR(100),
    cidade VARCHAR(100),
    cep VARCHAR(10),

    -- Horarios
    data_hora_inicio TIMESTAMPTZ NOT NULL,
    data_hora_fim TIMESTAMPTZ,
    duracao_minutos INTEGER,

    -- Localizacao GPS
    latitude_inicio DECIMAL(10, 8),
    longitude_inicio DECIMAL(11, 8),
    precisao_gps_inicio INTEGER,
    latitude_fim DECIMAL(10, 8),
    longitude_fim DECIMAL(11, 8),
    precisao_gps_fim INTEGER,

    -- Fotos
    foto_inicio TEXT,
    foto_fim TEXT,

    -- Status e observacoes
    status VARCHAR(20) DEFAULT 'EM_ANDAMENTO', -- EM_ANDAMENTO, FINALIZADO, CANCELADO
    observacoes TEXT,
    motivo_cancelamento TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_atendimentos_funcionario ON atendimentos(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_data ON atendimentos(data_hora_inicio);
CREATE INDEX IF NOT EXISTS idx_atendimentos_status ON atendimentos(status);
CREATE INDEX IF NOT EXISTS idx_atendimentos_func_data ON atendimentos(funcionario_id, data_hora_inicio);

CREATE INDEX IF NOT EXISTS idx_atendimentos_config_cargo ON atendimentos_config(cargo_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_config_lotacao ON atendimentos_config(lotacao_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_config_func ON atendimentos_config(funcionario_id);

-- Comentarios
COMMENT ON TABLE atendimentos_config IS 'Configuracoes de metas de atendimento por cargo, lotacao ou funcionario';
COMMENT ON TABLE atendimentos IS 'Registros de atendimentos domiciliares e externos';
COMMENT ON COLUMN atendimentos.tipo_atendimento IS 'Tipo: DOMICILIAR (visita em casa), EXTERNO (atendimento externo), VISITA (visita tecnica)';
COMMENT ON COLUMN atendimentos.status IS 'Status: EM_ANDAMENTO, FINALIZADO, CANCELADO';
