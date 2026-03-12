-- ============================================
-- SCHEMA DA CÂMARA MUNICIPAL (TENANT)
-- VotaLegis — Votação Legislativa
-- Uso: substituir {{schema}} pelo schema real (ex: camara_1)
-- ============================================

SET search_path TO {{schema}};

-- Configurações da câmara
CREATE TABLE IF NOT EXISTS configuracoes (
  id                      SERIAL PRIMARY KEY,
  nome_camara             VARCHAR(200) NOT NULL DEFAULT 'Câmara Municipal',
  nome_municipio          VARCHAR(200) NOT NULL,
  slug                    VARCHAR(100) UNIQUE,
  cor_primaria            VARCHAR(7)   DEFAULT '#2563eb',
  logo_url                TEXT,
  brasao_url              TEXT,
  quorum_minimo           INTEGER      DEFAULT 50, -- percentual mínimo (%)
  tempo_fala_padrao       INTEGER      DEFAULT 180, -- segundos
  votacao_secreta_padrao  BOOLEAN      DEFAULT false,
  exibir_foto_quorum      BOOLEAN      DEFAULT true,
  created_at              TIMESTAMPTZ  DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  DEFAULT NOW()
);

-- Partidos
CREATE TABLE IF NOT EXISTS partidos (
  id          SERIAL PRIMARY KEY,
  sigla       VARCHAR(20) NOT NULL UNIQUE,
  nome        VARCHAR(100) NOT NULL,
  cor         VARCHAR(7)  DEFAULT '#64748b',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Legislaturas
CREATE TABLE IF NOT EXISTS legislaturas (
  id          SERIAL PRIMARY KEY,
  numero      INTEGER NOT NULL,
  ano_inicio  INTEGER NOT NULL,
  ano_fim     INTEGER NOT NULL,
  ativa       BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Vereadores
CREATE TABLE IF NOT EXISTS vereadores (
  id               SERIAL PRIMARY KEY,
  usuario_id       INTEGER,     -- FK para public.usuarios_master (nullable: vereador pode não ter login)
  legislatura_id   INTEGER REFERENCES legislaturas(id),
  partido_id       INTEGER REFERENCES partidos(id),
  nome             VARCHAR(200) NOT NULL,
  nome_parlamentar VARCHAR(200),
  cargo            VARCHAR(50)  DEFAULT 'vereador', -- 'vereador' | 'presidente' | 'vice-presidente'
  foto_url         TEXT,
  email            VARCHAR(200),
  whatsapp         VARCHAR(20),
  facebook         TEXT,
  instagram        TEXT,
  trajetoria       TEXT,
  matricula        VARCHAR(50),
  ativo            BOOLEAN      DEFAULT true,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vereadores_usuario    ON vereadores(usuario_id);
CREATE INDEX IF NOT EXISTS idx_vereadores_legislatura ON vereadores(legislatura_id);
CREATE INDEX IF NOT EXISTS idx_vereadores_ativo       ON vereadores(ativo);
CREATE INDEX IF NOT EXISTS idx_vereadores_cargo       ON vereadores(cargo);

-- Sessões
CREATE TABLE IF NOT EXISTS sessoes (
  id                SERIAL PRIMARY KEY,
  legislatura_id    INTEGER REFERENCES legislaturas(id),
  numero            INTEGER,
  tipo              VARCHAR(50)  DEFAULT 'ordinaria', -- ordinaria | extraordinaria | solene | especial
  data_sessao       DATE         NOT NULL,
  hora_inicio       TIME,
  hora_fim          TIME,
  descricao         TEXT,
  local_            VARCHAR(200),
  status            VARCHAR(30)  DEFAULT 'planejada', -- planejada | em_andamento | suspensa | encerrada
  status_quorum     VARCHAR(20)  DEFAULT 'fechado',   -- fechado | aberto | encerrado
  quorum_iniciado_em TIMESTAMPTZ,
  iniciada_em       TIMESTAMPTZ,
  encerrada_em      TIMESTAMPTZ,
  ata_url           TEXT,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_status      ON sessoes(status);
CREATE INDEX IF NOT EXISTS idx_sessoes_data        ON sessoes(data_sessao);

-- Matérias / Proposições
CREATE TABLE IF NOT EXISTS materias (
  id               SERIAL PRIMARY KEY,
  sessao_id        INTEGER REFERENCES sessoes(id) ON DELETE CASCADE,
  tipo             VARCHAR(50)  NOT NULL, -- projeto_lei | requerimento | indicacao | mocao | emenda | decreto
  numero           VARCHAR(30),
  ementa           TEXT         NOT NULL,
  autor_id         INTEGER REFERENCES vereadores(id),
  pdf_url          TEXT,
  ordem            INTEGER      DEFAULT 0,
  status           VARCHAR(30)  DEFAULT 'pendente', -- pendente | em_leitura | pendente_votacao | em_votacao | aprovada | rejeitada | arquivada
  tipo_votacao     VARCHAR(20)  DEFAULT 'nominal',  -- nominal | secreta | aclamacao
  leitura_iniciada_em  TIMESTAMPTZ,
  leitura_encerrada_em TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materias_sessao  ON materias(sessao_id);
CREATE INDEX IF NOT EXISTS idx_materias_status  ON materias(status);

-- Presenças (quórum)
CREATE TABLE IF NOT EXISTS presencas (
  id            SERIAL PRIMARY KEY,
  sessao_id     INTEGER REFERENCES sessoes(id)   ON DELETE CASCADE,
  vereador_id   INTEGER REFERENCES vereadores(id),
  confirmado_em TIMESTAMPTZ,
  tipo          VARCHAR(20) DEFAULT 'presente', -- presente | ausente | justificado
  UNIQUE(sessao_id, vereador_id)
);

CREATE INDEX IF NOT EXISTS idx_presencas_sessao    ON presencas(sessao_id);
CREATE INDEX IF NOT EXISTS idx_presencas_vereador  ON presencas(vereador_id);

-- Votações
CREATE TABLE IF NOT EXISTS votacoes (
  id             SERIAL PRIMARY KEY,
  sessao_id      INTEGER REFERENCES sessoes(id)   ON DELETE CASCADE,
  materia_id     INTEGER REFERENCES materias(id)  ON DELETE CASCADE,
  tipo           VARCHAR(20) DEFAULT 'nominal',   -- nominal | secreta
  status         VARCHAR(20) DEFAULT 'aberta',    -- aberta | encerrada | cancelada
  resultado      VARCHAR(20),                     -- aprovada | rejeitada | empate
  aberta_em      TIMESTAMPTZ,
  encerrada_em   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_votacoes_sessao   ON votacoes(sessao_id);
CREATE INDEX IF NOT EXISTS idx_votacoes_materia  ON votacoes(materia_id);
CREATE INDEX IF NOT EXISTS idx_votacoes_status   ON votacoes(status);

-- Votos
CREATE TABLE IF NOT EXISTS votos (
  id            SERIAL PRIMARY KEY,
  votacao_id    INTEGER REFERENCES votacoes(id)  ON DELETE CASCADE,
  vereador_id   INTEGER REFERENCES vereadores(id), -- NULL em votação secreta
  opcao         VARCHAR(20) NOT NULL, -- favor | contra | abstencao
  registrado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(votacao_id, vereador_id) -- garante 1 voto por vereador (nullable ok para secreta)
);

CREATE INDEX IF NOT EXISTS idx_votos_votacao   ON votos(votacao_id);
CREATE INDEX IF NOT EXISTS idx_votos_vereador  ON votos(vereador_id);

-- Tempo de Fala / Voz / Tribuna
CREATE TABLE IF NOT EXISTS tempo_fala (
  id                SERIAL PRIMARY KEY,
  sessao_id         INTEGER REFERENCES sessoes(id)   ON DELETE CASCADE,
  vereador_id       INTEGER REFERENCES vereadores(id),
  posicao           INTEGER,
  duracao_segundos  INTEGER DEFAULT 180,
  status            VARCHAR(20) DEFAULT 'aguardando', -- aguardando | falando | encerrado | cancelado
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  iniciado_em       TIMESTAMPTZ,
  encerrado_em      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tempo_fala_sessao   ON tempo_fala(sessao_id);
CREATE INDEX IF NOT EXISTS idx_tempo_fala_status   ON tempo_fala(status);

-- Logs de auditoria da câmara
CREATE TABLE IF NOT EXISTS logs (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER,
  acao        VARCHAR(100) NOT NULL,
  entidade    VARCHAR(50),
  entidade_id INTEGER,
  dados       JSONB,
  ip          VARCHAR(45),
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_usuario  ON logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_criado   ON logs(criado_em);
