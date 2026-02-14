-- Tabela de Notificações (já deveria existir da migration anterior, mas garantindo)
CREATE TABLE IF NOT EXISTS notificacoes (
    id SERIAL PRIMARY KEY,
    
    -- Destinatário
    funcionario_id INTEGER REFERENCES funcionarios(id) ON DELETE CASCADE,
    usuario_id INTEGER,
    
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
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_funcionario ON notificacoes(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_lida ON notificacoes(lida);
CREATE INDEX IF NOT EXISTS idx_notificacoes_created ON notificacoes(created_at DESC);
