-- Tabela de planos SaaS
CREATE TABLE IF NOT EXISTS planos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    
    -- Limites
    max_funcionarios INTEGER NOT NULL,
    max_equipamentos INTEGER DEFAULT 5,
    max_usuarios INTEGER DEFAULT 10,
    
    -- Preços
    preco_mensal DECIMAL(10,2) NOT NULL,
    preco_anual DECIMAL(10,2),  -- Com desconto
    
    -- Recursos incluídos
    recursos JSONB DEFAULT '{
        "banco_horas": true,
        "hora_extra": true,
        "adicional_noturno": true,
        "afastamentos": true,
        "notificacoes": true,
        "esocial": false,
        "geolocalizacao": false,
        "app_mobile": false,
        "suporte_prioritario": false,
        "api_integracao": false
    }'::jsonb,
    
    -- Destaque
    destaque BOOLEAN DEFAULT FALSE,
    ordem INTEGER DEFAULT 0,
    ativo BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Planos padrão
INSERT INTO planos (nome, slug, max_funcionarios, preco_mensal, preco_anual, destaque, ordem, recursos) VALUES
('Starter', 'starter', 10, 49.00, 490.00, FALSE, 1, 
 '{"banco_horas": true, "hora_extra": true, "adicional_noturno": true, "afastamentos": false, "notificacoes": false, "esocial": false, "geolocalizacao": false, "app_mobile": false, "suporte_prioritario": false, "api_integracao": false}'),

('Basic', 'basic', 50, 149.00, 1490.00, FALSE, 2,
 '{"banco_horas": true, "hora_extra": true, "adicional_noturno": true, "afastamentos": true, "notificacoes": true, "esocial": false, "geolocalizacao": false, "app_mobile": false, "suporte_prioritario": false, "api_integracao": false}'),

('Pro', 'pro', 200, 399.00, 3990.00, TRUE, 3,
 '{"banco_horas": true, "hora_extra": true, "adicional_noturno": true, "afastamentos": true, "notificacoes": true, "esocial": true, "geolocalizacao": true, "app_mobile": false, "suporte_prioritario": true, "api_integracao": false}'),

('Business', 'business', 500, 799.00, 7990.00, FALSE, 4,
 '{"banco_horas": true, "hora_extra": true, "adicional_noturno": true, "afastamentos": true, "notificacoes": true, "esocial": true, "geolocalizacao": true, "app_mobile": true, "suporte_prioritario": true, "api_integracao": true}'),

('Enterprise', 'enterprise', 99999, 0, 0, FALSE, 5,
 '{"banco_horas": true, "hora_extra": true, "adicional_noturno": true, "afastamentos": true, "notificacoes": true, "esocial": true, "geolocalizacao": true, "app_mobile": true, "suporte_prioritario": true, "api_integracao": true}')
ON CONFLICT (slug) DO NOTHING;

-- Tabela de assinaturas
CREATE TABLE IF NOT EXISTS assinaturas (
    id SERIAL PRIMARY KEY,
    municipio_id INTEGER NOT NULL REFERENCES municipios(id) ON DELETE CASCADE,
    plano_id INTEGER NOT NULL REFERENCES planos(id),
    
    -- Período
    data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
    data_fim DATE,
    periodo VARCHAR(10) DEFAULT 'MENSAL' CHECK (periodo IN ('MENSAL', 'ANUAL')),
    
    -- Pagamento
    status VARCHAR(20) DEFAULT 'ATIVA' CHECK (status IN ('TRIAL', 'ATIVA', 'SUSPENSA', 'CANCELADA', 'VENCIDA')),
    ultimo_pagamento TIMESTAMPTZ,
    proximo_vencimento DATE,
    
    -- Trial
    trial_inicio DATE,
    trial_fim DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_municipio ON assinaturas(municipio_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_status ON assinaturas(status);

-- Tabela de leads (interessados)
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    email VARCHAR(200) NOT NULL,
    telefone VARCHAR(20),
    empresa VARCHAR(200),
    funcionarios INTEGER,
    plano_interesse VARCHAR(50),
    mensagem TEXT,
    origem VARCHAR(50),  -- landing_page, indicacao, google, etc.
    
    status VARCHAR(20) DEFAULT 'NOVO' CHECK (status IN ('NOVO', 'CONTATO', 'DEMO', 'NEGOCIACAO', 'CONVERTIDO', 'PERDIDO')),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
