-- ============================================
-- SCHEMA DO BANCO MUNICIPAL (TENANT)
-- Sistema de Ponto Eletrônico - Portaria 671/2021
-- ============================================

-- Unidades Gestoras (órgãos)
CREATE TABLE IF NOT EXISTS unidades_gestoras (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(200) NOT NULL,
    cnpj VARCHAR(18) UNIQUE,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unidades_gestoras_ativo ON unidades_gestoras(ativo);

-- Secretarias
CREATE TABLE IF NOT EXISTS secretarias (
    id SERIAL PRIMARY KEY,
    unidade_gestora_id INTEGER NOT NULL REFERENCES unidades_gestoras(id),
    codigo VARCHAR(20) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unidade_gestora_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_secretarias_unidade ON secretarias(unidade_gestora_id);
CREATE INDEX IF NOT EXISTS idx_secretarias_ativo ON secretarias(ativo);

-- Lotações
CREATE TABLE IF NOT EXISTS lotacoes (
    id SERIAL PRIMARY KEY,
    secretaria_id INTEGER NOT NULL REFERENCES secretarias(id),
    codigo VARCHAR(20) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    endereco TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(secretaria_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_lotacoes_secretaria ON lotacoes(secretaria_id);
CREATE INDEX IF NOT EXISTS idx_lotacoes_ativo ON lotacoes(ativo);

-- Tipos de Vínculo
CREATE TABLE IF NOT EXISTS tipos_vinculo (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tipos_vinculo_ativo ON tipos_vinculo(ativo);

-- Cargos
CREATE TABLE IF NOT EXISTS cargos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(200) NOT NULL,
    tipo_vinculo_id INTEGER REFERENCES tipos_vinculo(id),
    carga_horaria_semanal INTEGER DEFAULT 40,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cargos_tipo_vinculo ON cargos(tipo_vinculo_id);
CREATE INDEX IF NOT EXISTS idx_cargos_ativo ON cargos(ativo);

-- Jornadas de Trabalho
CREATE TABLE IF NOT EXISTS jornadas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    carga_horaria_diaria INTEGER NOT NULL DEFAULT 480, -- em minutos (8h = 480)
    carga_horaria_semanal INTEGER DEFAULT 2400, -- em minutos (40h = 2400)
    tolerancia_entrada INTEGER DEFAULT 10, -- tolerancia entrada em minutos
    tolerancia_saida INTEGER DEFAULT 10, -- tolerancia saida em minutos
    -- Novos campos para suporte a plantao e horario corrido
    tipo VARCHAR(20) DEFAULT 'NORMAL', -- NORMAL, PLANTAO, CORRIDA
    horas_plantao INTEGER, -- horas trabalhadas por plantao (12, 24)
    horas_folga INTEGER, -- horas de folga apos plantao (36, 72)
    tem_intervalo BOOLEAN DEFAULT true, -- se tem intervalo para refeicao
    duracao_intervalo INTEGER DEFAULT 60, -- duracao do intervalo em minutos
    marcacoes_dia INTEGER DEFAULT 4, -- 2 = sem intervalo, 4 = com intervalo
    horario_entrada TIME, -- horario padrao de entrada
    horario_inicio_intervalo TIME, -- horario padrao inicio intervalo
    horario_fim_intervalo TIME, -- horario padrao fim intervalo
    horario_saida TIME, -- horario padrao de saida
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jornadas_ativo ON jornadas(ativo);

-- Horários da Jornada (por dia da semana)
CREATE TABLE IF NOT EXISTS jornada_horarios (
    id SERIAL PRIMARY KEY,
    jornada_id INTEGER NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=Dom, 1=Seg, ..., 6=Sab
    entrada_1 TIME,
    saida_1 TIME,
    entrada_2 TIME,
    saida_2 TIME,
    folga BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(jornada_id, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_jornada_horarios_jornada ON jornada_horarios(jornada_id);

-- Funcionários
CREATE TABLE IF NOT EXISTS funcionarios (
    id SERIAL PRIMARY KEY,
    matricula VARCHAR(20) UNIQUE NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    pis VARCHAR(20),
    nome VARCHAR(200) NOT NULL,
    data_nascimento DATE,
    sexo CHAR(1) CHECK (sexo IN ('M', 'F')),

    -- Relacionamentos
    lotacao_id INTEGER REFERENCES lotacoes(id),
    cargo_id INTEGER REFERENCES cargos(id),
    tipo_vinculo_id INTEGER REFERENCES tipos_vinculo(id),
    jornada_id INTEGER REFERENCES jornadas(id),

    -- Datas de vínculo
    data_admissao DATE NOT NULL,
    data_demissao DATE,

    -- Biometria
    foto_url VARCHAR(500),
    template_biometrico BYTEA,

    -- Controle
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funcionarios_matricula ON funcionarios(matricula);
CREATE INDEX IF NOT EXISTS idx_funcionarios_cpf ON funcionarios(cpf);
CREATE INDEX IF NOT EXISTS idx_funcionarios_nome ON funcionarios(nome);
CREATE INDEX IF NOT EXISTS idx_funcionarios_lotacao ON funcionarios(lotacao_id);
CREATE INDEX IF NOT EXISTS idx_funcionarios_cargo ON funcionarios(cargo_id);
CREATE INDEX IF NOT EXISTS idx_funcionarios_jornada ON funcionarios(jornada_id);
CREATE INDEX IF NOT EXISTS idx_funcionarios_ativo ON funcionarios(ativo);

-- Histórico de Jornadas do Funcionário
CREATE TABLE IF NOT EXISTS funcionario_jornadas (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    jornada_id INTEGER NOT NULL REFERENCES jornadas(id),
    data_inicio DATE NOT NULL,
    data_fim DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funcionario_jornadas_funcionario ON funcionario_jornadas(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_jornadas_periodo ON funcionario_jornadas(data_inicio, data_fim);

-- Equipamentos (Relógios de Ponto)
CREATE TABLE IF NOT EXISTS equipamentos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    modelo VARCHAR(50),
    fabricante VARCHAR(50) DEFAULT 'Control iD',
    numero_serie VARCHAR(50) UNIQUE,

    -- Configuração de rede
    ip VARCHAR(45) UNIQUE NOT NULL,
    porta INTEGER DEFAULT 80,
    usuario VARCHAR(50),
    senha VARCHAR(100),

    -- Localização
    lotacao_id INTEGER REFERENCES lotacoes(id),

    -- Status
    status VARCHAR(20) DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE')),
    ultimo_ping TIMESTAMPTZ,
    ultima_sincronizacao TIMESTAMPTZ,

    -- Controle
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipamentos_ip ON equipamentos(ip);
CREATE INDEX IF NOT EXISTS idx_equipamentos_lotacao ON equipamentos(lotacao_id);
CREATE INDEX IF NOT EXISTS idx_equipamentos_status ON equipamentos(status);
CREATE INDEX IF NOT EXISTS idx_equipamentos_ativo ON equipamentos(ativo);

-- Registros de Ponto
CREATE TABLE IF NOT EXISTS registros_ponto (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    equipamento_id INTEGER REFERENCES equipamentos(id),

    -- Data e hora do registro
    data_hora TIMESTAMPTZ NOT NULL,
    tipo VARCHAR(10) CHECK (tipo IN ('ENTRADA', 'SAIDA')),

    -- Origem do registro
    origem VARCHAR(20) DEFAULT 'EQUIPAMENTO' CHECK (origem IN ('EQUIPAMENTO', 'MANUAL', 'IMPORTACAO', 'APP_MOBILE', 'FACIAL')),

    -- NSR (Número Sequencial do Registro) - Portaria 671
    nsr BIGINT,

    -- Justificativa (para registros manuais)
    justificativa TEXT,
    justificado_por INTEGER REFERENCES funcionarios(id),
    justificado_em TIMESTAMPTZ,

    -- GPS - Localização do registro (App Mobile)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    precisao_gps INTEGER,
    foto_registro TEXT,

    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registros_ponto_funcionario ON registros_ponto(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_registros_ponto_data_hora ON registros_ponto(data_hora);
CREATE INDEX IF NOT EXISTS idx_registros_ponto_funcionario_data ON registros_ponto(funcionario_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_registros_ponto_equipamento ON registros_ponto(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_registros_ponto_origem ON registros_ponto(origem);

-- Espelhos de Ponto (Resumo Mensal)
CREATE TABLE IF NOT EXISTS espelhos_ponto (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano INTEGER NOT NULL,

    -- Totalizadores
    dias_trabalhados INTEGER DEFAULT 0,
    horas_trabalhadas INTEGER DEFAULT 0, -- em minutos
    horas_extras INTEGER DEFAULT 0, -- em minutos
    horas_faltantes INTEGER DEFAULT 0, -- em minutos
    atrasos INTEGER DEFAULT 0, -- em minutos
    faltas INTEGER DEFAULT 0,

    -- Status
    status VARCHAR(20) DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'FECHADO', 'APROVADO')),

    -- Aprovação
    aprovado_por INTEGER REFERENCES funcionarios(id),
    aprovado_em TIMESTAMPTZ,

    -- Dados detalhados (JSON com dia-a-dia)
    dados JSONB,

    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(funcionario_id, mes, ano)
);

CREATE INDEX IF NOT EXISTS idx_espelhos_ponto_funcionario ON espelhos_ponto(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_espelhos_ponto_periodo ON espelhos_ponto(ano, mes);
CREATE INDEX IF NOT EXISTS idx_espelhos_ponto_status ON espelhos_ponto(status);

-- Feriados
CREATE TABLE IF NOT EXISTS feriados (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) DEFAULT 'MUNICIPAL' CHECK (tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL')),
    recorrente BOOLEAN DEFAULT false,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feriados_data ON feriados(data);
CREATE INDEX IF NOT EXISTS idx_feriados_ativo ON feriados(ativo);

-- Tipos de Ocorrência
CREATE TABLE IF NOT EXISTS tipos_ocorrencia (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    abono_horas BOOLEAN DEFAULT false,
    cor VARCHAR(7) DEFAULT '#6c757d',
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tipos_ocorrencia_ativo ON tipos_ocorrencia(ativo);

-- Inserir tipos de ocorrência padrão
INSERT INTO tipos_ocorrencia (codigo, nome, descricao, abono_horas, cor) VALUES
    ('FERIAS', 'Férias', 'Período de férias do funcionário', true, '#28a745'),
    ('ATESTADO', 'Atestado Médico', 'Afastamento por motivo de saúde', true, '#dc3545'),
    ('FALTA', 'Falta', 'Ausência não justificada', false, '#6c757d'),
    ('LICENCA', 'Licença', 'Licença remunerada', true, '#17a2b8'),
    ('FOLGA', 'Folga/Compensação', 'Folga por compensação de horas', true, '#ffc107'),
    ('ABONO', 'Abono', 'Dia abonado', true, '#007bff')
ON CONFLICT (codigo) DO NOTHING;

-- Ocorrências
CREATE TABLE IF NOT EXISTS ocorrencias (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    tipo_ocorrencia_id INTEGER NOT NULL REFERENCES tipos_ocorrencia(id),
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    descricao TEXT,

    -- Aprovação
    aprovado BOOLEAN DEFAULT false,
    aprovado_por INTEGER REFERENCES funcionarios(id),
    aprovado_em TIMESTAMPTZ,

    -- Controle
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocorrencias_funcionario ON ocorrencias(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_tipo ON ocorrencias(tipo_ocorrencia_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_periodo ON ocorrencias(data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_aprovado ON ocorrencias(aprovado);

-- Usuários do Município
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    login VARCHAR(50) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,

    -- Perfil de acesso
    perfil VARCHAR(20) DEFAULT 'USUARIO' CHECK (perfil IN ('ADMIN', 'RH', 'GESTOR', 'USUARIO')),

    -- Vínculo com funcionário (opcional)
    funcionario_id INTEGER REFERENCES funcionarios(id),

    -- Permissões específicas
    lotacoes_permitidas JSONB DEFAULT '[]',

    -- Controle
    ativo BOOLEAN DEFAULT true,
    ultimo_acesso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_login ON usuarios(login);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil);
CREATE INDEX IF NOT EXISTS idx_usuarios_funcionario ON usuarios(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo ON usuarios(ativo);

-- Audit Logs do Município
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER,
    acao VARCHAR(50) NOT NULL,
    tabela VARCHAR(100),
    registro_id INTEGER,
    dados_anteriores JSONB,
    dados_novos JSONB,
    ip VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_acao ON audit_logs(acao);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tabela ON audit_logs(tabela);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Configurações do Sistema Municipal
CREATE TABLE IF NOT EXISTS configuracoes_sistema (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT,
    descricao TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir configurações padrão
INSERT INTO configuracoes_sistema (chave, valor, descricao) VALUES
    ('tolerancia_atraso', '10', 'Tolerância para atraso em minutos'),
    ('tolerancia_hora_extra', '10', 'Tolerância para início de hora extra em minutos'),
    ('fechamento_automatico', 'true', 'Fechamento automático do espelho no final do mês'),
    ('notificar_pendencias', 'true', 'Enviar notificação de pendências'),
    ('dias_retroativos_edicao', '5', 'Dias permitidos para edição retroativa')
ON CONFLICT (chave) DO NOTHING;

-- Sincronizações (histórico)
CREATE TABLE IF NOT EXISTS sincronizacoes (
    id SERIAL PRIMARY KEY,
    equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('REGISTROS', 'FUNCIONARIOS', 'BIOMETRIA')),
    status VARCHAR(20) DEFAULT 'EM_ANDAMENTO' CHECK (status IN ('SUCESSO', 'ERRO', 'EM_ANDAMENTO')),
    registros_processados INTEGER DEFAULT 0,
    detalhes JSONB,
    iniciado_em TIMESTAMPTZ DEFAULT NOW(),
    finalizado_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sincronizacoes_equipamento ON sincronizacoes(equipamento_id);
CREATE INDEX IF NOT EXISTS idx_sincronizacoes_status ON sincronizacoes(status);
CREATE INDEX IF NOT EXISTS idx_sincronizacoes_iniciado ON sincronizacoes(iniciado_em);

-- Templates de Digitais (para sincronização entre REPs)
CREATE TABLE IF NOT EXISTS funcionario_templates (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    pis VARCHAR(20),
    finger_id INTEGER NOT NULL DEFAULT 0,
    template TEXT NOT NULL,
    equipamento_origem_id INTEGER,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW(),
    UNIQUE(funcionario_id, finger_id)
);

CREATE INDEX IF NOT EXISTS idx_funcionario_templates_func ON funcionario_templates(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_templates_pis ON funcionario_templates(pis);
