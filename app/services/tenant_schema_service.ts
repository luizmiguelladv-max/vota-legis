import db from '@adonisjs/lucid/services/db'

export default class TenantSchemaService {
  /**
   * Gera o nome do schema para uma camara
   */
  static getSchemaName(municipioId: number): string {
    return `camara_${municipioId}`
  }

  /**
   * Cria o schema e todas as tabelas para uma nova camara
   */
  static async createSchema(municipioId: number): Promise<void> {
    const schemaName = this.getSchemaName(municipioId)

    // Criar o schema
    await db.rawQuery(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    // Criar todas as tabelas do tenant
    await this.createTenantTables(schemaName)

    // Atualizar o municipio para indicar que o banco foi criado
    await db.from('municipios').where('id', municipioId).update({ banco_criado: true })
  }

  /**
   * Remove o schema de uma camara (CUIDADO: apaga todos os dados!)
   */
  static async dropSchema(municipioId: number): Promise<void> {
    const schemaName = this.getSchemaName(municipioId)
    await db.rawQuery(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await db.from('municipios').where('id', municipioId).update({ banco_criado: false })
  }

  /**
   * Verifica se o schema existe
   */
  static async schemaExists(municipioId: number): Promise<boolean> {
    const schemaName = this.getSchemaName(municipioId)
    const result = await db.rawQuery(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = ?
    `, [schemaName])
    return result.rows.length > 0
  }

  /**
   * Cria todas as tabelas do tenant dentro do schema
   */
  private static async createTenantTables(schemaName: string): Promise<void> {
    // Partidos
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".partidos (
        id SERIAL PRIMARY KEY,
        sigla VARCHAR(20) NOT NULL,
        nome VARCHAR(255) NOT NULL,
        numero VARCHAR(5),
        cor VARCHAR(7),
        logo_url VARCHAR(500),
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(sigla)
      )
    `)

    // Legislaturas
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".legislaturas (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL,
        descricao VARCHAR(255),
        data_inicio DATE NOT NULL,
        data_fim DATE NOT NULL,
        atual BOOLEAN DEFAULT FALSE,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(numero)
      )
    `)

    // Vereadores
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".vereadores (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        partido_id INTEGER REFERENCES "${schemaName}".partidos(id) ON DELETE SET NULL,
        legislatura_id INTEGER REFERENCES "${schemaName}".legislaturas(id) ON DELETE SET NULL,

        nome VARCHAR(255) NOT NULL,
        nome_parlamentar VARCHAR(255),
        cpf VARCHAR(11),
        email VARCHAR(255),
        telefone VARCHAR(20),
        celular VARCHAR(20),
        data_nascimento DATE,
        naturalidade VARCHAR(255),

        foto_url VARCHAR(500),
        face_cadastrada BOOLEAN DEFAULT FALSE,
        face_id VARCHAR(255),

        cargo VARCHAR(50) DEFAULT 'vereador',
        numero_cadeira INTEGER,

        status VARCHAR(50) DEFAULT 'ativo',
        data_posse DATE,
        data_saida DATE,
        motivo_saida TEXT,

        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      )
    `)

    // Vereador Faces (reconhecimento facial)
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".vereador_faces (
        id SERIAL PRIMARY KEY,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,
        face_id VARCHAR(255) NOT NULL,
        imagem_url VARCHAR(500),
        confianca FLOAT,
        metadados JSONB,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Vereador Mandatos
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".vereador_mandatos (
        id SERIAL PRIMARY KEY,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,
        legislatura_id INTEGER NOT NULL REFERENCES "${schemaName}".legislaturas(id) ON DELETE CASCADE,
        partido_id INTEGER REFERENCES "${schemaName}".partidos(id) ON DELETE SET NULL,
        data_inicio DATE NOT NULL,
        data_fim DATE,
        tipo VARCHAR(20) DEFAULT 'titular',
        observacoes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      )
    `)

    // Comissoes
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".comissoes (
        id SERIAL PRIMARY KEY,
        legislatura_id INTEGER REFERENCES "${schemaName}".legislaturas(id) ON DELETE SET NULL,
        nome VARCHAR(255) NOT NULL,
        sigla VARCHAR(20),
        descricao TEXT,
        tipo VARCHAR(50) DEFAULT 'permanente',
        data_inicio DATE,
        data_fim DATE,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      )
    `)

    // Comissao Membros
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".comissao_membros (
        id SERIAL PRIMARY KEY,
        comissao_id INTEGER NOT NULL REFERENCES "${schemaName}".comissoes(id) ON DELETE CASCADE,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,
        cargo VARCHAR(50) DEFAULT 'membro',
        data_entrada DATE NOT NULL,
        data_saida DATE,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(comissao_id, vereador_id)
      )
    `)

    // Sessoes
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sessoes (
        id SERIAL PRIMARY KEY,
        legislatura_id INTEGER REFERENCES "${schemaName}".legislaturas(id) ON DELETE SET NULL,

        numero INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        tipo VARCHAR(50) DEFAULT 'ordinaria',
        titulo VARCHAR(255),
        descricao TEXT,

        data DATE NOT NULL,
        hora_inicio_prevista TIME,
        hora_fim_prevista TIME,
        hora_inicio_real TIMESTAMP,
        hora_fim_real TIMESTAMP,

        status VARCHAR(50) DEFAULT 'agendada',
        fase_atual VARCHAR(50) DEFAULT 'nenhuma',

        quorum_minimo INTEGER DEFAULT 0,
        quorum_atual INTEGER DEFAULT 0,

        presidente_id INTEGER REFERENCES "${schemaName}".vereadores(id) ON DELETE SET NULL,
        secretario_id INTEGER REFERENCES "${schemaName}".vereadores(id) ON DELETE SET NULL,

        ata TEXT,
        ata_aprovada BOOLEAN DEFAULT FALSE,
        ata_pdf_url VARCHAR(500),

        link_transmissao VARCHAR(500),
        transmitindo BOOLEAN DEFAULT FALSE,

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(numero, ano, tipo)
      )
    `)

    // Sessao Fases
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sessao_fases (
        id SERIAL PRIMARY KEY,
        sessao_id INTEGER NOT NULL REFERENCES "${schemaName}".sessoes(id) ON DELETE CASCADE,
        fase VARCHAR(50) NOT NULL,
        ordem INTEGER NOT NULL,
        hora_inicio TIMESTAMP,
        hora_fim TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pendente',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(sessao_id, fase)
      )
    `)

    // Sessao Presencas (Quorum)
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sessao_presencas (
        id SERIAL PRIMARY KEY,
        sessao_id INTEGER NOT NULL REFERENCES "${schemaName}".sessoes(id) ON DELETE CASCADE,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,
        presente BOOLEAN DEFAULT FALSE,
        tipo_registro VARCHAR(50) DEFAULT 'manual',
        confianca_facial FLOAT,
        imagem_captura_url VARCHAR(500),
        hora_entrada TIMESTAMP,
        hora_saida TIMESTAMP,
        justificativa_ausencia TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(sessao_id, vereador_id)
      )
    `)

    // Sessao Presenca Logs
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sessao_presenca_logs (
        id SERIAL PRIMARY KEY,
        sessao_presenca_id INTEGER NOT NULL REFERENCES "${schemaName}".sessao_presencas(id) ON DELETE CASCADE,
        tipo VARCHAR(20) NOT NULL,
        metodo VARCHAR(50) NOT NULL,
        confianca FLOAT,
        imagem_url VARCHAR(500),
        registrado_por_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Tipos de Materia
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".tipos_materia (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(20) NOT NULL,
        nome VARCHAR(255) NOT NULL,
        descricao TEXT,
        prefixo VARCHAR(10) NOT NULL,
        quorum_aprovacao VARCHAR(50) DEFAULT 'maioria_simples',
        requer_duas_votacoes BOOLEAN DEFAULT FALSE,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(codigo)
      )
    `)

    // Materias
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".materias (
        id SERIAL PRIMARY KEY,
        tipo_materia_id INTEGER NOT NULL REFERENCES "${schemaName}".tipos_materia(id) ON DELETE RESTRICT,
        legislatura_id INTEGER REFERENCES "${schemaName}".legislaturas(id) ON DELETE SET NULL,

        numero INTEGER NOT NULL,
        ano INTEGER NOT NULL,

        ementa TEXT NOT NULL,
        texto_completo TEXT,
        justificativa TEXT,

        status VARCHAR(50) DEFAULT 'em_tramitacao',

        data_apresentacao DATE NOT NULL,
        data_publicacao DATE,

        urgencia BOOLEAN DEFAULT FALSE,
        regime_tramitacao VARCHAR(50) DEFAULT 'normal',

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(tipo_materia_id, numero, ano)
      )
    `)

    // Materia Autores
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".materia_autores (
        id SERIAL PRIMARY KEY,
        materia_id INTEGER NOT NULL REFERENCES "${schemaName}".materias(id) ON DELETE CASCADE,
        vereador_id INTEGER REFERENCES "${schemaName}".vereadores(id) ON DELETE SET NULL,
        tipo VARCHAR(50) DEFAULT 'autor',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Materia Anexos
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".materia_anexos (
        id SERIAL PRIMARY KEY,
        materia_id INTEGER NOT NULL REFERENCES "${schemaName}".materias(id) ON DELETE CASCADE,
        nome VARCHAR(255) NOT NULL,
        arquivo_url VARCHAR(500) NOT NULL,
        tipo VARCHAR(50),
        tamanho INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Materia Tramitacoes
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".materia_tramitacoes (
        id SERIAL PRIMARY KEY,
        materia_id INTEGER NOT NULL REFERENCES "${schemaName}".materias(id) ON DELETE CASCADE,
        comissao_id INTEGER REFERENCES "${schemaName}".comissoes(id) ON DELETE SET NULL,

        data DATE NOT NULL,
        descricao TEXT NOT NULL,
        parecer TEXT,

        status VARCHAR(50),

        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Materia Assinaturas (Certificado Digital)
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".materia_assinaturas (
        id SERIAL PRIMARY KEY,
        materia_id INTEGER NOT NULL REFERENCES "${schemaName}".materias(id) ON DELETE CASCADE,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,

        certificado_tipo VARCHAR(10) NOT NULL,
        certificado_nome VARCHAR(255),
        certificado_cpf VARCHAR(11),
        certificado_emissor VARCHAR(255),
        certificado_validade DATE,

        hash_documento VARCHAR(255) NOT NULL,
        assinatura TEXT NOT NULL,

        ip VARCHAR(45),
        user_agent VARCHAR(500),

        assinado_em TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),

        UNIQUE(materia_id, vereador_id)
      )
    `)

    // Votacoes
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".votacoes (
        id SERIAL PRIMARY KEY,
        sessao_id INTEGER NOT NULL REFERENCES "${schemaName}".sessoes(id) ON DELETE CASCADE,
        materia_id INTEGER REFERENCES "${schemaName}".materias(id) ON DELETE SET NULL,

        numero_votacao INTEGER NOT NULL,
        tipo VARCHAR(50) DEFAULT 'nominal',
        quorum_tipo VARCHAR(50) DEFAULT 'maioria_simples',

        descricao TEXT,

        status VARCHAR(50) DEFAULT 'aguardando',

        hora_inicio TIMESTAMP,
        hora_fim TIMESTAMP,

        votos_sim INTEGER DEFAULT 0,
        votos_nao INTEGER DEFAULT 0,
        votos_abstencao INTEGER DEFAULT 0,
        total_votos INTEGER DEFAULT 0,

        resultado VARCHAR(50),

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      )
    `)

    // Votos
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".votos (
        id SERIAL PRIMARY KEY,
        votacao_id INTEGER NOT NULL REFERENCES "${schemaName}".votacoes(id) ON DELETE CASCADE,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,

        voto VARCHAR(20) NOT NULL,

        hora_voto TIMESTAMP NOT NULL,
        ip VARCHAR(45),
        dispositivo VARCHAR(50),

        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(votacao_id, vereador_id)
      )
    `)

    // Configuracoes de Tempo de Fala
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".tempo_fala_config (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        nome VARCHAR(100) NOT NULL,
        duracao_segundos INTEGER NOT NULL,
        permite_extensao BOOLEAN DEFAULT FALSE,
        extensao_segundos INTEGER DEFAULT 0,
        alerta_segundos INTEGER DEFAULT 60,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(tipo)
      )
    `)

    // Registros de Tempo de Fala
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".tempo_fala_registros (
        id SERIAL PRIMARY KEY,
        sessao_id INTEGER NOT NULL REFERENCES "${schemaName}".sessoes(id) ON DELETE CASCADE,
        vereador_id INTEGER NOT NULL REFERENCES "${schemaName}".vereadores(id) ON DELETE CASCADE,
        tempo_fala_config_id INTEGER REFERENCES "${schemaName}".tempo_fala_config(id) ON DELETE SET NULL,

        tipo VARCHAR(50) NOT NULL,
        fase_sessao VARCHAR(50),

        hora_inicio TIMESTAMP NOT NULL,
        hora_fim TIMESTAMP,
        duracao_segundos INTEGER,

        extendido BOOLEAN DEFAULT FALSE,
        tempo_extensao_segundos INTEGER DEFAULT 0,

        assunto TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Configuracoes do Painel Eletronico
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".painel_config (
        id SERIAL PRIMARY KEY,
        chave VARCHAR(100) NOT NULL,
        valor TEXT,
        tipo VARCHAR(50) DEFAULT 'string',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP,
        UNIQUE(chave)
      )
    `)

    // Mensagens do Painel
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".painel_mensagens (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255),
        mensagem TEXT NOT NULL,
        tipo VARCHAR(50) DEFAULT 'info',
        ativo BOOLEAN DEFAULT TRUE,
        exibir_ate TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Inserir tipos de materia padrao
    await this.insertDefaultTiposMateria(schemaName)

    // Inserir configuracoes de tempo de fala padrao
    await this.insertDefaultTempoFalaConfig(schemaName)
  }

  /**
   * Insere os tipos de materia padrao
   */
  private static async insertDefaultTiposMateria(schemaName: string): Promise<void> {
    const tipos = [
      { codigo: 'PLO', nome: 'Projeto de Lei Ordinaria', prefixo: 'PL', quorum: 'maioria_simples' },
      { codigo: 'PLC', nome: 'Projeto de Lei Complementar', prefixo: 'PLC', quorum: 'maioria_absoluta' },
      { codigo: 'PLO2', nome: 'Projeto de Emenda a Lei Organica', prefixo: 'PELO', quorum: 'dois_tercos' },
      { codigo: 'PRE', nome: 'Projeto de Resolucao', prefixo: 'PR', quorum: 'maioria_simples' },
      { codigo: 'PDL', nome: 'Projeto de Decreto Legislativo', prefixo: 'PDL', quorum: 'maioria_simples' },
      { codigo: 'MOC', nome: 'Mocao', prefixo: 'MOC', quorum: 'maioria_simples' },
      { codigo: 'REQ', nome: 'Requerimento', prefixo: 'REQ', quorum: 'maioria_simples' },
      { codigo: 'IND', nome: 'Indicacao', prefixo: 'IND', quorum: 'maioria_simples' },
    ]

    for (const tipo of tipos) {
      await db.rawQuery(`
        INSERT INTO "${schemaName}".tipos_materia (codigo, nome, prefixo, quorum_aprovacao, created_at)
        VALUES (?, ?, ?, ?, NOW())
        ON CONFLICT (codigo) DO NOTHING
      `, [tipo.codigo, tipo.nome, tipo.prefixo, tipo.quorum])
    }
  }

  /**
   * Insere configuracoes de tempo de fala padrao
   */
  private static async insertDefaultTempoFalaConfig(schemaName: string): Promise<void> {
    const configs = [
      { tipo: 'pequeno_expediente', nome: 'Pequeno Expediente', duracao: 300, alerta: 60 },
      { tipo: 'grande_expediente', nome: 'Grande Expediente', duracao: 900, alerta: 120 },
      { tipo: 'explicacao_pessoal', nome: 'Explicacao Pessoal', duracao: 180, alerta: 30 },
      { tipo: 'aparte', nome: 'Aparte', duracao: 60, alerta: 15 },
      { tipo: 'questao_ordem', nome: 'Questao de Ordem', duracao: 120, alerta: 30 },
      { tipo: 'encaminhamento', nome: 'Encaminhamento de Votacao', duracao: 180, alerta: 30 },
    ]

    for (const config of configs) {
      await db.rawQuery(`
        INSERT INTO "${schemaName}".tempo_fala_config (tipo, nome, duracao_segundos, alerta_segundos, created_at)
        VALUES (?, ?, ?, ?, NOW())
        ON CONFLICT (tipo) DO NOTHING
      `, [config.tipo, config.nome, config.duracao, config.alerta])
    }
  }

  /**
   * Executa uma query no schema de uma camara especifica
   */
  static async queryTenant<T>(municipioId: number, sql: string, params: any[] = []): Promise<T[]> {
    const schemaName = this.getSchemaName(municipioId)

    // Adiciona o search_path para o schema do tenant
    await db.rawQuery(`SET search_path TO "${schemaName}", public`)

    const result = await db.rawQuery(sql, params)

    // Restaura o search_path para public
    await db.rawQuery(`SET search_path TO public`)

    return result.rows as T[]
  }
}
