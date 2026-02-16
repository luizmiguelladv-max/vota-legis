-- Script para criar as tabelas feriados, tipos_ocorrencia e usuarios no schema santo_andre
-- Execute este script no Supabase SQL Editor

-- Tabela de Feriados
CREATE TABLE IF NOT EXISTS santo_andre.feriados (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) DEFAULT 'MUNICIPAL', -- NACIONAL, ESTADUAL, MUNICIPAL, PONTO_FACULTATIVO
    recorrente BOOLEAN DEFAULT FALSE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Tipos de Ocorrência
CREATE TABLE IF NOT EXISTS santo_andre.tipos_ocorrencia (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20),
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    abona BOOLEAN DEFAULT FALSE, -- Se abona a falta
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela de Usuários do Município (diferente de usuarios_master que é central)
CREATE TABLE IF NOT EXISTS santo_andre.usuarios (
    id SERIAL PRIMARY KEY,
    login VARCHAR(100) NOT NULL UNIQUE,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    senha VARCHAR(255) NOT NULL,
    perfil VARCHAR(50) DEFAULT 'VISUALIZADOR', -- ADMIN, RH, OPERADOR, VISUALIZADOR
    ativo BOOLEAN DEFAULT TRUE,
    ultimo_acesso TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Inserir alguns feriados nacionais de exemplo
INSERT INTO santo_andre.feriados (data, descricao, tipo, recorrente) VALUES 
('2025-01-01', 'Confraternização Universal', 'NACIONAL', TRUE),
('2025-04-21', 'Tiradentes', 'NACIONAL', TRUE),
('2025-05-01', 'Dia do Trabalho', 'NACIONAL', TRUE),
('2025-09-07', 'Independência do Brasil', 'NACIONAL', TRUE),
('2025-10-12', 'Nossa Senhora Aparecida', 'NACIONAL', TRUE),
('2025-11-02', 'Finados', 'NACIONAL', TRUE),
('2025-11-15', 'Proclamação da República', 'NACIONAL', TRUE),
('2025-12-25', 'Natal', 'NACIONAL', TRUE)
ON CONFLICT DO NOTHING;

-- Inserir alguns tipos de ocorrência comuns
INSERT INTO santo_andre.tipos_ocorrencia (codigo, nome, descricao, abona) VALUES 
('FJ', 'Falta Justificada', 'Falta com justificativa aceita', TRUE),
('FI', 'Falta Injustificada', 'Falta sem justificativa', FALSE),
('AT', 'Atestado Médico', 'Afastamento por atestado médico', TRUE),
('FE', 'Férias', 'Período de férias', TRUE),
('LM', 'Licença Maternidade', 'Licença maternidade', TRUE),
('LP', 'Licença Paternidade', 'Licença paternidade', TRUE),
('LT', 'Licença para Tratamento de Saúde', 'Licença médica prolongada', TRUE),
('LN', 'Luto/Nojo', 'Licença por falecimento de familiar', TRUE),
('AB', 'Abono', 'Abono de falta', TRUE),
('SE', 'Serviço Externo', 'Trabalho fora da lotação', TRUE),
('VI', 'Viagem', 'Viagem a serviço', TRUE),
('TR', 'Treinamento/Capacitação', 'Participação em curso ou treinamento', TRUE)
ON CONFLICT DO NOTHING;

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_feriados_data ON santo_andre.feriados(data);
CREATE INDEX IF NOT EXISTS idx_tipos_ocorrencia_ativo ON santo_andre.tipos_ocorrencia(ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_login ON santo_andre.usuarios(login);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo ON santo_andre.usuarios(ativo);

SELECT 'Tabelas criadas com sucesso!' as resultado;
