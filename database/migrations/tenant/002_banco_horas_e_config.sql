-- ============================================
-- MIGRATION: Sistema Dual (Público/Privado) + Banco de Horas
-- Data: 2024-12-16
-- ============================================

-- ============================================
-- CONFIGURAÇÃO DO TENANT (TIPO DE EMPRESA)
-- ============================================
CREATE TABLE IF NOT EXISTS configuracao_tenant (
    id SERIAL PRIMARY KEY,
    tipo_empresa VARCHAR(20) DEFAULT 'PUBLICO' CHECK (tipo_empresa IN ('PUBLICO', 'PRIVADO')),
    
    -- Terminologia customizada (JSON)
    terminologia JSONB DEFAULT '{
        "unidade_gestora": "Unidade Gestora",
        "secretaria": "Secretaria",
        "lotacao": "Lotação",
        "funcionario": "Funcionário",
        "matricula": "Matrícula"
    }'::jsonb,
    
    -- Configurações visuais
    logo_url VARCHAR(500),
    cor_primaria VARCHAR(7) DEFAULT '#0d6efd',
    cor_secundaria VARCHAR(7) DEFAULT '#6c757d',
    
    -- Módulos ativos
    modulos_ativos JSONB DEFAULT '{
        "banco_horas": true,
        "hora_extra": true,
        "adicional_noturno": true,
        "gelocalizacao": false,
        "app_mobile": false
    }'::jsonb,
    
    -- Configurações trabalhistas
    percentual_hora_extra_50 DECIMAL(5,2) DEFAULT 50.00,
    percentual_hora_extra_100 DECIMAL(5,2) DEFAULT 100.00,
    percentual_adicional_noturno DECIMAL(5,2) DEFAULT 20.00,
    horario_noturno_inicio TIME DEFAULT '22:00',
    horario_noturno_fim TIME DEFAULT '05:00',
    interjornada_minima INTEGER DEFAULT 660, -- 11 horas em minutos
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insere configuração padrão se não existir
INSERT INTO configuracao_tenant (id, tipo_empresa) 
VALUES (1, 'PUBLICO') 
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- BANCO DE HORAS - CONFIGURAÇÃO
-- ============================================
CREATE TABLE IF NOT EXISTS banco_horas_config (
    id SERIAL PRIMARY KEY,
    
    -- Período de compensação
    periodo_compensacao VARCHAR(20) DEFAULT 'SEMESTRAL' 
        CHECK (periodo_compensacao IN ('MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL')),
    
    -- Limites
    limite_acumulo_positivo INTEGER DEFAULT 2400, -- 40 horas em minutos
    limite_acumulo_negativo INTEGER DEFAULT 600,  -- 10 horas em minutos
    
    -- Conversão
    converter_he_50_para_banco BOOLEAN DEFAULT true,
    converter_he_100_para_banco BOOLEAN DEFAULT false,
    fator_conversao_he_50 DECIMAL(3,2) DEFAULT 1.50, -- 1h extra = 1.5h banco
    fator_conversao_he_100 DECIMAL(3,2) DEFAULT 2.00, -- 1h extra 100% = 2h banco
    
    -- Vencimento
    dias_aviso_vencimento INTEGER DEFAULT 30,
    acao_vencimento VARCHAR(20) DEFAULT 'PAGAR' 
        CHECK (acao_vencimento IN ('PAGAR', 'PERDER', 'TRANSFERIR')),
    
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insere configuração padrão
INSERT INTO banco_horas_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- BANCO DE HORAS - MOVIMENTAÇÕES
-- ============================================
CREATE TABLE IF NOT EXISTS banco_horas (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Data e tipo
    data DATE NOT NULL,
    tipo_operacao VARCHAR(20) NOT NULL 
        CHECK (tipo_operacao IN ('CREDITO', 'DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO', 'AJUSTE')),
    
    -- Valores em minutos
    minutos INTEGER NOT NULL, -- positivo para crédito, negativo para débito
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

-- ============================================
-- SALDO CONSOLIDADO DE BANCO DE HORAS
-- ============================================
CREATE TABLE IF NOT EXISTS banco_horas_saldo (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Período
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    
    -- Saldos em minutos
    saldo_inicial INTEGER DEFAULT 0,
    creditos INTEGER DEFAULT 0,
    debitos INTEGER DEFAULT 0,
    compensacoes INTEGER DEFAULT 0,
    pagamentos INTEGER DEFAULT 0,
    saldo_final INTEGER DEFAULT 0,
    
    -- Controle
    fechado BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(funcionario_id, ano, mes)
);

CREATE INDEX IF NOT EXISTS idx_banco_horas_saldo_funcionario ON banco_horas_saldo(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_banco_horas_saldo_periodo ON banco_horas_saldo(ano, mes);

-- ============================================
-- TIPOS DE VÍNCULO ADICIONAIS (SETOR PRIVADO)
-- ============================================
INSERT INTO tipos_vinculo (codigo, nome, descricao, ativo) VALUES
    ('CLT', 'CLT', 'Contrato por tempo indeterminado - CLT', true),
    ('PJ', 'Pessoa Jurídica', 'Prestador de serviço PJ', true),
    ('TEMPORARIO', 'Temporário', 'Contrato temporário', true),
    ('APRENDIZ', 'Aprendiz', 'Jovem Aprendiz', true),
    ('TERCEIRIZADO', 'Terceirizado', 'Funcionário de empresa terceirizada', true),
    ('INTERMITENTE', 'Intermitente', 'Trabalho intermitente', true),
    ('HOME_OFFICE', 'Home Office', 'Trabalho remoto integral', true)
ON CONFLICT (codigo) DO NOTHING;

-- ============================================
-- HISTÓRICO DE CONFIGURAÇÕES DO FUNCIONÁRIO
-- ============================================
CREATE TABLE IF NOT EXISTS funcionario_configuracoes (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Configuração
    chave VARCHAR(50) NOT NULL,
    valor TEXT,
    
    -- Período de vigência
    data_inicio DATE NOT NULL,
    data_fim DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funcionario_config_funcionario ON funcionario_configuracoes(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_config_chave ON funcionario_configuracoes(chave);

-- ============================================
-- CENTRO DE CUSTO (PARA SETOR PRIVADO)
-- ============================================
CREATE TABLE IF NOT EXISTS centros_custo (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(200) NOT NULL,
    descricao TEXT,
    lotacao_id INTEGER REFERENCES lotacoes(id),
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_centros_custo_ativo ON centros_custo(ativo);
CREATE INDEX IF NOT EXISTS idx_centros_custo_lotacao ON centros_custo(lotacao_id);

-- Adiciona centro de custo ao funcionário
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS centro_custo_id INTEGER REFERENCES centros_custo(id);

-- ============================================
-- SOLICITAÇÕES DE AJUSTE (WORKFLOW)
-- ============================================
CREATE TABLE IF NOT EXISTS solicitacoes_ajuste (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    
    -- Tipo de solicitação
    tipo VARCHAR(30) NOT NULL 
        CHECK (tipo IN ('AJUSTE_PONTO', 'JUSTIFICATIVA_FALTA', 'BANCO_HORAS', 'FERIAS', 'ABONO')),
    
    -- Dados da solicitação
    data_referencia DATE NOT NULL,
    hora_original TIME,
    hora_solicitada TIME,
    justificativa TEXT NOT NULL,
    
    -- Anexos
    anexo_url VARCHAR(500),
    
    -- Status
    status VARCHAR(20) DEFAULT 'PENDENTE' 
        CHECK (status IN ('PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO')),
    
    -- Aprovação
    aprovador_id INTEGER REFERENCES funcionarios(id),
    data_aprovacao TIMESTAMPTZ,
    motivo_rejeicao TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_funcionario ON solicitacoes_ajuste(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON solicitacoes_ajuste(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_tipo ON solicitacoes_ajuste(tipo);

-- ============================================
-- ALERTAS E NOTIFICAÇÕES
-- ============================================
CREATE TABLE IF NOT EXISTS notificacoes (
    id SERIAL PRIMARY KEY,
    
    -- Destinatário
    funcionario_id INTEGER REFERENCES funcionarios(id) ON DELETE CASCADE,
    usuario_id INTEGER, -- para notificações de sistema
    
    -- Conteúdo
    titulo VARCHAR(200) NOT NULL,
    mensagem TEXT NOT NULL,
    tipo VARCHAR(30) DEFAULT 'INFO' 
        CHECK (tipo IN ('INFO', 'ALERTA', 'URGENTE', 'SUCESSO', 'ERRO')),
    categoria VARCHAR(30) DEFAULT 'SISTEMA'
        CHECK (categoria IN ('SISTEMA', 'PONTO', 'BANCO_HORAS', 'FERIAS', 'APROVACAO')),
    
    -- Link de ação
    action_url VARCHAR(500),
    
    -- Status
    lida BOOLEAN DEFAULT false,
    lida_em TIMESTAMPTZ,
    
    -- Canais enviados
    enviado_email BOOLEAN DEFAULT false,
    enviado_push BOOLEAN DEFAULT false,
    enviado_whatsapp BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_funcionario ON notificacoes(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida);
CREATE INDEX IF NOT EXISTS idx_notificacoes_created ON notificacoes(created_at);
