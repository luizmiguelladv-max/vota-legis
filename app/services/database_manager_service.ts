/**
 * ===========================================================================
 * DATABASE MANAGER SERVICE - Serviço de Gerenciamento Multi-Tenant
 * ===========================================================================
 *
 * Este serviço é o CORAÇÃO do sistema multi-tenant. Ele gerencia conexões
 * dinâmicas com bancos de dados de diferentes municípios.
 *
 * ARQUITETURA MULTI-TENANT:
 * -------------------------
 * O sistema usa isolamento por SCHEMA PostgreSQL. Cada município tem:
 * - Um registro na tabela pública `municipios` com credenciais do banco
 * - Um schema próprio (ex: santo_andre, joao_pessoa) com todas as tabelas
 *
 * FLUXO DE CONEXÃO:
 * -----------------
 * 1. Usuário faz login → sistema identifica o município
 * 2. Sistema busca credenciais do município na tabela central
 * 3. Cria um POOL de conexões para aquele município (se não existir)
 * 4. Todas as queries são executadas no schema do município
 *
 * POOL DE CONEXÕES:
 * -----------------
 * Cada município tem seu próprio pool com:
 * - Máximo de 10 conexões simultâneas
 * - Timeout de 30 segundos para conexões ociosas
 * - Timeout de 10 segundos para novas conexões
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

import { Pool, PoolConfig } from 'pg'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

/**
 * Sanitiza nome do schema para prevenir SQL injection
 * Permite apenas caracteres alfanuméricos e underscores
 */
function sanitizeSchemaName(schema: string): string {
  // Remove qualquer caractere que não seja alfanumérico ou underscore
  const sanitized = schema.replace(/[^a-zA-Z0-9_]/g, '')
  if (!sanitized || sanitized.length === 0) {
    throw new Error('Nome do schema inválido após sanitização')
  }
  return sanitized
}

/**
 * Serviço de Gerenciamento de Conexões Multi-Tenant
 *
 * Implementa o padrão SINGLETON para garantir que exista apenas uma
 * instância gerenciando todos os pools de conexão.
 *
 * @example
 * ```typescript
 * import { dbManager } from '#services/database_manager_service'
 *
 * // Query no banco central (tabela pública municipios)
 * const municipios = await dbManager.queryCentral('SELECT * FROM municipios')
 *
 * // Query no banco de um município específico
 * const funcionarios = await dbManager.queryMunicipio(1, 'SELECT * FROM funcionarios')
 * ```
 */
export default class DatabaseManagerService {
  /**
   * Instância única do serviço (padrão Singleton)
   * Garante que todos os componentes usem os mesmos pools de conexão
   */
  private static instance: DatabaseManagerService

  /**
   * Mapa de pools de conexão por município (LEGADO - usar entidades)
   * Chave: ID do município
   * Valor: Pool de conexões PostgreSQL
   */
  private municipioPools: Map<number, Pool> = new Map()

  /**
   * Mapa de schemas por município (LEGADO - usar entidades)
   * Chave: ID do município
   * Valor: Nome do schema no PostgreSQL
   */
  private municipioSchemas: Map<number, string> = new Map()

  /**
   * Mapa de pools de conexão por entidade (NOVO)
   * Chave: ID da entidade
   * Valor: Pool de conexões PostgreSQL
   *
   * Exemplo: { 1: Pool(santo_andre_prefeitura), 2: Pool(santo_andre_camara) }
   */
  private entidadePools: Map<number, Pool> = new Map()

  /**
   * Mapa de schemas por entidade (NOVO)
   * Chave: ID da entidade
   * Valor: Nome do schema no PostgreSQL
   *
   * Exemplo: { 1: 'santo_andre_prefeitura', 2: 'santo_andre_camara' }
   */
  private entidadeSchemas: Map<number, string> = new Map()

  /**
   * Construtor privado - impede criação direta de instâncias
   * Use DatabaseManagerService.getInstance() para obter a instância
   */
  private constructor() {}

  /**
   * Obtém a instância singleton do gerenciador
   *
   * Se a instância ainda não existir, cria uma nova.
   * Nas próximas chamadas, retorna sempre a mesma instância.
   *
   * @returns Instância única do DatabaseManagerService
   *
   * @example
   * ```typescript
   * const dbManager = DatabaseManagerService.getInstance()
   * ```
   */
  static getInstance(): DatabaseManagerService {
    if (!DatabaseManagerService.instance) {
      DatabaseManagerService.instance = new DatabaseManagerService()
    }
    return DatabaseManagerService.instance
  }

  /**
   * Executa query no banco central (schema public)
   *
   * Use este método para queries em tabelas públicas como:
   * - municipios (lista de todos os municípios)
   * - usuarios_master (usuários do sistema)
   *
   * IMPORTANTE: Converte placeholders PostgreSQL ($1, $2...) para
   * o formato Knex (?), pois o AdonisJS usa Knex internamente.
   *
   * @param sql - Query SQL com placeholders $1, $2...
   * @param params - Array de parâmetros para a query
   * @returns Array com os registros retornados
   *
   * @example
   * ```typescript
   * // Buscar todos os municípios ativos
   * const municipios = await dbManager.queryCentral(
   *   'SELECT * FROM municipios WHERE ativo = $1',
   *   [true]
   * )
   *
   * // Buscar município por ID
   * const [municipio] = await dbManager.queryCentral(
   *   'SELECT * FROM municipios WHERE id = $1',
   *   [1]
   * )
   * ```
   */
  async queryCentral<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    // Converte $1, $2, etc para ? (Knex usa ? ao invés de $n)
    // Isso permite usar a mesma sintaxe PostgreSQL em todo o código
    const convertedSql = sql.replace(/\$\d+/g, '?')
    const result = await db.rawQuery(convertedSql, params)
    return result.rows as T[]
  }

  /**
   * Obtém ou cria pool de conexão para um município
   *
   * Este método é LAZY - só cria o pool quando necessário.
   * Se o pool já existir, retorna o existente (cache).
   *
   * FLUXO DETALHADO:
   * 1. Verifica se já existe pool para este município
   * 2. Se não existe, busca credenciais na tabela central
   * 3. Valida se o município está ativo
   * 4. Cria configuração do pool (connection string OU host/port/user/pass)
   * 5. Testa a conexão
   * 6. Armazena pool e schema no cache
   *
   * @param municipioId - ID do município no banco central
   * @returns Pool de conexões para o município
   * @throws Error se município não encontrado, inativo ou sem credenciais
   *
   * @example
   * ```typescript
   * const pool = await dbManager.getPoolMunicipio(1)
   * const client = await pool.connect()
   * // ... usar client
   * client.release()
   * ```
   */
  async getPoolMunicipio(municipioId: number): Promise<Pool> {
    // =========================================================================
    // ETAPA 1: Verificar cache
    // =========================================================================
    // Se já temos um pool para este município, retorna direto (performance)
    if (this.municipioPools.has(municipioId)) {
      return this.municipioPools.get(municipioId)!
    }

    // =========================================================================
    // ETAPA 2: Buscar credenciais do município
    // =========================================================================
    // Consulta a tabela central para obter dados de conexão
    const [municipio] = await this.queryCentral<{
      id: number
      nome: string
      slug: string
      db_connection_string: string | null  // String de conexão completa (opcional)
      db_host: string | null               // Host do banco (ex: db.supabase.co)
      db_port: number | null               // Porta (padrão: 5432)
      db_name: string | null               // Nome do banco (ex: postgres)
      db_user: string | null               // Usuário
      db_password: string | null           // Senha
      db_schema: string | null             // Schema do município
      status: string                       // Status: ATIVO, PENDENTE, SUSPENSO
    }>(
      `SELECT id, nome, slug, db_connection_string, db_host, db_port, db_name, db_user, db_password, db_schema, status
       FROM municipios WHERE id = $1 AND ativo = true`,
      [municipioId]
    )

    // =========================================================================
    // ETAPA 3: Validações
    // =========================================================================
    if (!municipio) {
      throw new Error(`Município ${municipioId} não encontrado ou inativo`)
    }

    if (municipio.status !== 'ATIVO') {
      throw new Error(`Município ${municipio.nome} não está ativo (status: ${municipio.status})`)
    }

    // =========================================================================
    // ETAPA 4: Criar configuração do pool
    // =========================================================================
    // Suporta dois modos de conexão:
    // - Connection string (formato: postgres://user:pass@host:port/db)
    // - Parâmetros separados (host, port, user, password, database)
    let poolConfig: PoolConfig

    // Detecta se deve usar SSL baseado no host (Supabase externo requer SSL, containers locais não)
    // Verifica se é um host Supabase EXTERNO real (termina em .supabase.co ou .supabase.com)
    const isExternalSupabase = municipio.db_host?.includes('.supabase.co') ||
                               municipio.db_host?.includes('.supabase.com') ||
                               municipio.db_connection_string?.includes('.supabase.co') ||
                               municipio.db_connection_string?.includes('.supabase.com')
    const requiresSsl = isExternalSupabase
    const sslConfig = requiresSsl ? { rejectUnauthorized: false } : false

    if (municipio.db_connection_string) {
      // Modo 1: Connection string completa
      poolConfig = {
        connectionString: municipio.db_connection_string,
        ssl: sslConfig,
        max: 10,                              // Máximo de conexões no pool
        idleTimeoutMillis: 30000,             // 30s para conexão ociosa
        connectionTimeoutMillis: 10000,       // 10s timeout de conexão
      }
    } else if (municipio.db_host && municipio.db_user && municipio.db_name) {
      // Modo 2: Parâmetros separados
      poolConfig = {
        host: municipio.db_host,
        port: municipio.db_port || 5432,
        database: municipio.db_name,
        user: municipio.db_user,
        password: municipio.db_password || undefined,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    } else {
      throw new Error(`Configuração de banco de dados incompleta para município ${municipio.nome}`)
    }

    // =========================================================================
    // ETAPA 5: Criar pool e testar conexão
    // =========================================================================
    const pool = new Pool(poolConfig)

    // Tratamento de erros do pool para evitar crash da aplicação
    // Quando a conexão é perdida (timeout, DbHandler exited, etc), remove o pool
    // para que seja recriado na próxima requisição
    pool.on('error', (err) => {
      logger.error(`[Pool Error] Município ${municipio.nome} (ID: ${municipioId}): ${err.message}`)
      // Remove o pool com erro para forçar reconexão na próxima query
      this.municipioPools.delete(municipioId)
      this.municipioSchemas.delete(municipioId)
      logger.info(`[Pool Error] Pool do município ${municipioId} removido para reconexão automática`)
    })

    // Testa se consegue conectar antes de armazenar no cache
    try {
      const client = await pool.connect()
      client.release()
      logger.info(`Pool criado para município ${municipio.nome} (ID: ${municipioId})`)
    } catch (error) {
      logger.error(`Erro ao conectar no banco do município ${municipio.nome}: ${error}`)
      throw new Error(`Falha ao conectar no banco do município ${municipio.nome}`)
    }

    // =========================================================================
    // ETAPA 6: Armazenar no cache
    // =========================================================================
    this.municipioPools.set(municipioId, pool)

    // Define o schema: usa db_schema, ou slug com underscores, ou 'public'
    // Exemplo: "santo-andre" vira "santo_andre"
    const schema = municipio.db_schema || municipio.slug?.replace(/-/g, '_') || 'public'
    this.municipioSchemas.set(municipioId, schema)
    logger.info(`Schema definido para município ${municipio.nome}: ${schema}`)

    return pool
  }

  /**
   * Executa query no banco de um município específico
   *
   * Este é o método PRINCIPAL para queries multi-tenant.
   * Automaticamente:
   * 1. Obtém/cria o pool do município
   * 2. Define o search_path para o schema correto
   * 3. Executa a query
   * 4. Libera a conexão
   *
   * IMPORTANTE: Sempre use este método para queries em dados de município.
   * NUNCA hardcode o schema nas queries (ex: santo_andre.funcionarios).
   *
   * @param municipioId - ID do município
   * @param sql - Query SQL (use placeholders $1, $2...)
   * @param params - Parâmetros da query
   * @returns Array com os registros retornados
   *
   * @example
   * ```typescript
   * // Buscar todos os funcionários ativos
   * const funcionarios = await dbManager.queryMunicipio(
   *   municipioId,
   *   'SELECT * FROM funcionarios WHERE ativo = $1',
   *   [true]
   * )
   *
   * // Buscar registros de ponto de um funcionário
   * const registros = await dbManager.queryMunicipio(
   *   municipioId,
   *   `SELECT * FROM registros_ponto
   *    WHERE funcionario_id = $1 AND DATE(data_hora) = $2`,
   *   [funcionarioId, '2024-12-13']
   * )
   * ```
   */
  async queryMunicipio<T = any>(
    municipioId: number,
    sql: string,
    params: any[] = []
  ): Promise<T[]> {
    // Obtém pool (cria se necessário)
    const pool = await this.getPoolMunicipio(municipioId)
    const schema = this.municipioSchemas.get(municipioId) || 'public'

    // Obtém uma conexão do pool
    const client = await pool.connect()
    try {
      // Define o search_path para o schema do município (sanitizado)
      // Isso faz com que "SELECT * FROM funcionarios" busque
      // automaticamente na tabela correta (ex: santo_andre.funcionarios)
      const safeSchema = sanitizeSchemaName(schema)
      logger.debug(`[queryMunicipio] Executando no schema: ${safeSchema}`)
      await client.query(`SET search_path TO ${safeSchema}`)

      // Executa a query
      const result = await client.query(sql, params)
      logger.debug(`[queryMunicipio] Retornou ${result.rows.length} registros`)
      return result.rows as T[]
    } finally {
      // SEMPRE libera a conexão de volta para o pool
      // Isso é CRÍTICO para não esgotar as conexões
      client.release()
    }
  }

  /**
   * Executa query única no banco de um município
   *
   * Atalho para buscar um único registro. Retorna o primeiro
   * resultado ou null se não encontrar.
   *
   * @param municipioId - ID do município
   * @param sql - Query SQL
   * @param params - Parâmetros da query
   * @returns Primeiro registro ou null
   *
   * @example
   * ```typescript
   * // Buscar funcionário por ID
   * const funcionario = await dbManager.queryMunicipioOne(
   *   municipioId,
   *   'SELECT * FROM funcionarios WHERE id = $1',
   *   [123]
   * )
   *
   * if (funcionario) {
   *   console.log(funcionario.nome)
   * }
   * ```
   */
  async queryMunicipioOne<T = any>(
    municipioId: number,
    sql: string,
    params: any[] = []
  ): Promise<T | null> {
    const rows = await this.queryMunicipio<T>(municipioId, sql, params)
    return rows[0] || null
  }

  /**
   * Executa transação no banco de um município
   *
   * Use para operações que precisam de atomicidade (tudo ou nada).
   * Se qualquer operação falhar, todas são revertidas (ROLLBACK).
   *
   * IMPORTANTE: A conexão é mantida durante toda a transação,
   * permitindo múltiplas operações no mesmo contexto.
   *
   * @param municipioId - ID do município
   * @param callback - Função que recebe o client e executa as operações
   * @returns Resultado do callback
   *
   * @example
   * ```typescript
   * // Inserir registro e atualizar espelho em uma transação
   * await dbManager.transactionMunicipio(municipioId, async (client) => {
   *   // Insere registro de ponto
   *   await client.query(
   *     'INSERT INTO registros_ponto (funcionario_id, data_hora) VALUES ($1, $2)',
   *     [funcionarioId, dataHora]
   *   )
   *
   *   // Atualiza espelho do ponto
   *   await client.query(
   *     'UPDATE espelhos_ponto SET horas_trabalhadas = horas_trabalhadas + $1 WHERE id = $2',
   *     [horasTrabalhadas, espelhoId]
   *   )
   * })
   * ```
   */
  async transactionMunicipio<T>(
    municipioId: number,
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    const pool = await this.getPoolMunicipio(municipioId)
    const schema = this.municipioSchemas.get(municipioId) || 'public'
    const client = await pool.connect()

    try {
      // Configura schema (sanitizado) e inicia transação
      const safeSchema = sanitizeSchemaName(schema)
      await client.query(`SET search_path TO ${safeSchema}`)
      await client.query('BEGIN')

      // Executa as operações do callback
      const result = await callback(client)

      // Se tudo deu certo, confirma a transação
      await client.query('COMMIT')
      return result
    } catch (error) {
      // Se algo deu errado, reverte TUDO
      await client.query('ROLLBACK')
      throw error
    } finally {
      // Libera a conexão
      client.release()
    }
  }

  /**
   * Remove pool de um município específico
   *
   * Use quando um município for desativado ou quando precisar
   * recriar a conexão com novas credenciais.
   *
   * @param municipioId - ID do município
   *
   * @example
   * ```typescript
   * // Após atualizar credenciais do município
   * await dbManager.removePoolMunicipio(municipioId)
   * // Próxima query vai criar novo pool com novas credenciais
   * ```
   */
  async removePoolMunicipio(municipioId: number): Promise<void> {
    const pool = this.municipioPools.get(municipioId)
    if (pool) {
      await pool.end()
      this.municipioPools.delete(municipioId)
      logger.info(`Pool removido para município ID: ${municipioId}`)
    }
  }

  /**
   * Fecha todas as conexões
   *
   * Use no shutdown da aplicação para liberar recursos.
   * Chamado automaticamente pelo provider de shutdown.
   *
   * @example
   * ```typescript
   * // No shutdown da aplicação
   * await dbManager.closeAll()
   * ```
   */
  async closeAll(): Promise<void> {
    // Fechar pools de municípios (legado)
    for (const [municipioId, pool] of this.municipioPools) {
      await pool.end()
      logger.info(`Pool fechado para município ID: ${municipioId}`)
    }
    this.municipioPools.clear()

    // Fechar pools de entidades (novo)
    for (const [entidadeId, pool] of this.entidadePools) {
      await pool.end()
      logger.info(`Pool fechado para entidade ID: ${entidadeId}`)
    }
    this.entidadePools.clear()
  }

  /**
   * Retorna estatísticas dos pools
   *
   * Útil para monitoramento e debugging.
   * Mostra quantas conexões estão ativas, ociosas e em espera.
   *
   * @returns Array com estatísticas por município
   *
   * @example
   * ```typescript
   * const stats = dbManager.getStats()
   * stats.forEach(s => {
   *   console.log(`Município ${s.municipioId}:`)
   *   console.log(`  Total: ${s.total}, Ociosas: ${s.idle}, Esperando: ${s.waiting}`)
   * })
   * ```
   */
  getStats(): { tipo: string; id: number; total: number; idle: number; waiting: number }[] {
    const stats: { tipo: string; id: number; total: number; idle: number; waiting: number }[] = []

    // Stats de municípios (legado)
    for (const [municipioId, pool] of this.municipioPools) {
      stats.push({
        tipo: 'municipio',
        id: municipioId,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      })
    }

    // Stats de entidades (novo)
    for (const [entidadeId, pool] of this.entidadePools) {
      stats.push({
        tipo: 'entidade',
        id: entidadeId,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      })
    }

    return stats
  }

  /**
   * Verifica saúde da conexão de um município
   *
   * Faz uma query simples (SELECT 1) para verificar se a conexão
   * está funcionando.
   *
   * @param municipioId - ID do município
   * @returns true se conexão está ok, false se falhou
   *
   * @example
   * ```typescript
   * const isHealthy = await dbManager.healthCheck(municipioId)
   * if (!isHealthy) {
   *   // Tentar reconectar ou notificar admin
   * }
   * ```
   */
  async healthCheck(municipioId: number): Promise<boolean> {
    try {
      const pool = await this.getPoolMunicipio(municipioId)
      const result = await pool.query('SELECT 1 as health')
      return result.rows[0]?.health === 1
    } catch {
      return false
    }
  }

  // ===========================================================================
  // MÉTODOS PARA ENTIDADES (NOVO SISTEMA MULTI-TENANT)
  // ===========================================================================

  /**
   * Obtém ou cria pool de conexão para uma entidade
   *
   * Similar ao getPoolMunicipio, mas busca dados na tabela entidades.
   * Cada entidade (Prefeitura, Câmara, Empresa) tem seu próprio schema.
   *
   * @param entidadeId - ID da entidade no banco central
   * @returns Pool de conexões para a entidade
   * @throws Error se entidade não encontrada ou inativa
   */
  async getPoolEntidade(entidadeId: number): Promise<Pool> {
    // Verificar cache
    if (this.entidadePools.has(entidadeId)) {
      return this.entidadePools.get(entidadeId)!
    }

    // Buscar credenciais da entidade COM dados do município (para herança)
    const [entidade] = await this.queryCentral<{
      id: number
      nome: string
      tipo: string
      categoria: string
      cnpj: string | null
      municipio_id: number
      db_connection_string: string | null
      db_host: string | null
      db_port: number | null
      db_name: string | null
      db_user: string | null
      db_password: string | null
      db_schema: string | null
      status: string
      // Dados do município para herança
      mun_db_host: string | null
      mun_db_port: number | null
      mun_db_name: string | null
      mun_db_user: string | null
      mun_db_password: string | null
      mun_db_schema: string | null
      mun_slug: string | null
    }>(
      `SELECT e.id, e.nome, e.tipo, e.categoria, e.cnpj, e.municipio_id,
              e.db_connection_string, e.db_host, e.db_port,
              e.db_name, e.db_user, e.db_password, e.db_schema, e.status,
              m.db_host as mun_db_host, m.db_port as mun_db_port, m.db_name as mun_db_name,
              m.db_user as mun_db_user, m.db_password as mun_db_password,
              m.db_schema as mun_db_schema, m.slug as mun_slug
       FROM entidades e
       JOIN municipios m ON m.id = e.municipio_id
       WHERE e.id = $1 AND e.ativo = true`,
      [entidadeId]
    )

    if (!entidade) {
      throw new Error(`Entidade ${entidadeId} não encontrada ou inativa`)
    }

    if (entidade.status !== 'ATIVO') {
      throw new Error(`Entidade ${entidade.nome} não está ativa (status: ${entidade.status})`)
    }

    // Determinar configuração: usa entidade ou herda do município
    const usarConfigEntidade = entidade.db_host && entidade.db_user && entidade.db_name

    const dbHost = usarConfigEntidade ? entidade.db_host : entidade.mun_db_host
    const dbPort = usarConfigEntidade ? entidade.db_port : entidade.mun_db_port
    const dbName = usarConfigEntidade ? entidade.db_name : entidade.mun_db_name
    const dbUser = usarConfigEntidade ? entidade.db_user : entidade.mun_db_user
    const dbPassword = usarConfigEntidade ? entidade.db_password : entidade.mun_db_password
    const dbConnectionString = entidade.db_connection_string

    // Determinar schema: usa da entidade, ou gera baseado no slug do município + CNPJ
    let dbSchema = entidade.db_schema
    if (!dbSchema && entidade.mun_slug) {
      // Prioridade: CNPJ (único por empresa) > categoria
      if (entidade.cnpj) {
        // Remove pontuação do CNPJ para usar como identificador
        const cnpjNumeros = entidade.cnpj.replace(/\D/g, '')
        dbSchema = `${entidade.mun_slug}_${cnpjNumeros}`
      } else {
        // Fallback: {slug_municipio}_{categoria_lowercase}
        dbSchema = `${entidade.mun_slug}_${entidade.categoria.toLowerCase()}`
      }
    }
    if (!dbSchema) {
      dbSchema = entidade.mun_db_schema || 'public'
    }

    // Criar configuração do pool
    let poolConfig: PoolConfig

    // Verifica se é um host Supabase EXTERNO real (termina em .supabase.co ou .supabase.com)
    const isExternalSupabase = dbHost?.includes('.supabase.co') ||
                               dbHost?.includes('.supabase.com') ||
                               dbConnectionString?.includes('.supabase.co') ||
                               dbConnectionString?.includes('.supabase.com')
    const requiresSsl = isExternalSupabase
    const sslConfig = requiresSsl ? { rejectUnauthorized: false } : false

    if (dbConnectionString) {
      poolConfig = {
        connectionString: dbConnectionString,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    } else if (dbHost && dbUser && dbName) {
      poolConfig = {
        host: dbHost,
        port: dbPort || 5432,
        database: dbName,
        user: dbUser,
        password: dbPassword || undefined,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    } else if (dbSchema && process.env.DB_HOST) {
      // Usa banco central com schema isolado (nova arquitetura)
      logger.info(`[getPoolEntidade] Entidade ${entidade.nome}: usando banco central com schema isolado: ${dbSchema}`)
      const centralSsl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      poolConfig = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_DATABASE,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: centralSsl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    } else {
      throw new Error(`Configuração de banco incompleta para entidade ${entidade.nome}. Configure o banco na entidade ou no município.`)
    }

    logger.debug(`[getPoolEntidade] Entidade ${entidade.nome}: usando ${usarConfigEntidade ? 'banco próprio' : 'banco do município'}, schema: ${dbSchema}`)

    // Criar pool e testar conexão
    const pool = new Pool(poolConfig)

    pool.on('error', (err) => {
      logger.error(`[Pool Error] Entidade ${entidade.nome} (ID: ${entidadeId}): ${err.message}`)
      this.entidadePools.delete(entidadeId)
      this.entidadeSchemas.delete(entidadeId)
      logger.info(`[Pool Error] Pool da entidade ${entidadeId} removido para reconexão automática`)
    })

    try {
      const client = await pool.connect()
      client.release()
      logger.info(`Pool criado para entidade ${entidade.nome} (ID: ${entidadeId})`)
    } catch (error) {
      logger.error(`Erro ao conectar no banco da entidade ${entidade.nome}: ${error}`)
      throw new Error(`Falha ao conectar no banco da entidade ${entidade.nome}`)
    }

    // Armazenar no cache
    this.entidadePools.set(entidadeId, pool)
    this.entidadeSchemas.set(entidadeId, dbSchema)
    logger.info(`Schema definido para entidade ${entidade.nome}: ${dbSchema}`)

    return pool
  }

  /**
   * Executa query no banco de uma entidade específica
   *
   * @param entidadeId - ID da entidade
   * @param sql - Query SQL (use placeholders $1, $2...)
   * @param params - Parâmetros da query
   * @returns Array com os registros retornados
   */
  async queryEntidade<T = any>(
    entidadeId: number,
    sql: string,
    params: any[] = []
  ): Promise<T[]> {
    const pool = await this.getPoolEntidade(entidadeId)
    const schema = this.entidadeSchemas.get(entidadeId) || 'public'

    const client = await pool.connect()
    try {
      const safeSchema = sanitizeSchemaName(schema)
      logger.debug(`[queryEntidade] Executando no schema: ${safeSchema}`)
      await client.query(`SET search_path TO ${safeSchema}`)

      const result = await client.query(sql, params)
      logger.debug(`[queryEntidade] Retornou ${result.rows.length} registros`)
      return result.rows as T[]
    } finally {
      client.release()
    }
  }

  /**
   * Executa query única no banco de uma entidade
   */
  async queryEntidadeOne<T = any>(
    entidadeId: number,
    sql: string,
    params: any[] = []
  ): Promise<T | null> {
    const rows = await this.queryEntidade<T>(entidadeId, sql, params)
    return rows[0] || null
  }

  /**
   * Executa transação no banco de uma entidade
   */
  async transactionEntidade<T>(
    entidadeId: number,
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    const pool = await this.getPoolEntidade(entidadeId)
    const schema = this.entidadeSchemas.get(entidadeId) || 'public'
    const client = await pool.connect()

    try {
      const safeSchema = sanitizeSchemaName(schema)
      await client.query(`SET search_path TO ${safeSchema}`)
      await client.query('BEGIN')

      const result = await callback(client)

      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Remove pool de uma entidade específica
   */
  async removePoolEntidade(entidadeId: number): Promise<void> {
    const pool = this.entidadePools.get(entidadeId)
    if (pool) {
      await pool.end()
      this.entidadePools.delete(entidadeId)
      this.entidadeSchemas.delete(entidadeId)
      logger.info(`Pool removido para entidade ID: ${entidadeId}`)
    }
  }

  /**
   * Verifica saúde da conexão de uma entidade
   */
  async healthCheckEntidade(entidadeId: number): Promise<boolean> {
    try {
      const pool = await this.getPoolEntidade(entidadeId)
      const result = await pool.query('SELECT 1 as health')
      return result.rows[0]?.health === 1
    } catch {
      return false
    }
  }

  /**
   * Busca entidade por ID do município (primeira entidade ativa)
   * Útil para compatibilidade com código legado
   */
  async getEntidadeByMunicipioId(municipioId: number): Promise<number | null> {
    try {
      const [entidade] = await this.queryCentral<{ id: number }>(
        `SELECT id FROM public.entidades WHERE municipio_id = $1 AND ativo = true AND status = 'ATIVO' ORDER BY id LIMIT 1`,
        [municipioId]
      )
      return entidade?.id || null
    } catch (error: any) {
      // Compatibilidade: algumas bases não possuem tabela entidades
      if (error?.code === '42P01' || String(error?.message || '').includes('entidades')) {
        logger.warn(
          `[DBManager] Tabela public.entidades não encontrada para município ${municipioId}. Usando fallback por município.`
        )
        return null
      }
      throw error
    }
  }

  /**
   * Lista todas as entidades de um município
   */
  async listarEntidadesMunicipio(municipioId: number): Promise<any[]> {
    return await this.queryCentral(
      `SELECT id, tipo, categoria, nome, nome_curto, cnpj, status, ativo
       FROM entidades WHERE municipio_id = $1 ORDER BY tipo, nome`,
      [municipioId]
    )
  }

  // ===========================================================================
  // MÉTODO UNIVERSAL - USA ENTIDADE OU MUNICÍPIO AUTOMATICAMENTE
  // ===========================================================================

  /**
   * Executa query usando a entidade selecionada ou município (fallback)
   *
   * Este método é a forma RECOMENDADA de executar queries, pois:
   * - Se há entidadeId no tenant, usa o schema da entidade
   * - Se não há entidadeId mas há municipioId, usa o schema do município
   * - Garante isolamento correto entre entidades do mesmo município
   *
   * @param tenant - Objeto tenant do contexto (ctx.tenant)
   * @param sql - Query SQL com placeholders $1, $2...
   * @param params - Array de parâmetros para a query
   * @returns Array com os registros retornados
   *
   * @example
   * ```typescript
   * // No controller:
   * const funcionarios = await dbManager.queryTenant(
   *   tenant,
   *   'SELECT * FROM funcionarios WHERE ativo = true'
   * )
   * ```
   */
  async queryTenant<T = any>(
    tenant: { entidadeId?: number | null; municipioId?: number | null },
    sql: string,
    params: any[] = []
  ): Promise<T[]> {
    // Prioridade 1: Usar entidade se disponível
    if (tenant.entidadeId) {
      return this.queryEntidade<T>(tenant.entidadeId, sql, params)
    }

    // Prioridade 2: Buscar primeira entidade do município automaticamente
    if (tenant.municipioId) {
      const entidadeId = await this.getEntidadeByMunicipioId(tenant.municipioId)
      if (entidadeId) {
        return this.queryEntidade<T>(entidadeId, sql, params)
      }

      // Fallback quando não há entidade (modo município puro)
      return this.queryMunicipio<T>(tenant.municipioId, sql, params)
    }

    // Nenhum tenant disponível
    throw new Error('Nenhum tenant (entidade ou município) selecionado')
  }

  /**
   * Executa query única usando tenant
   */
  async queryTenantOne<T = any>(
    tenant: { entidadeId?: number | null; municipioId?: number | null },
    sql: string,
    params: any[] = []
  ): Promise<T | null> {
    const rows = await this.queryTenant<T>(tenant, sql, params)
    return rows[0] || null
  }

  /**
   * Executa transação usando tenant
   */
  async transactionTenant<T>(
    tenant: { entidadeId?: number | null; municipioId?: number | null },
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    // Prioridade 1: Usar entidade se disponível
    if (tenant.entidadeId) {
      return this.transactionEntidade<T>(tenant.entidadeId, callback)
    }

    // Prioridade 2: Buscar primeira entidade do município automaticamente
    if (tenant.municipioId) {
      const entidadeId = await this.getEntidadeByMunicipioId(tenant.municipioId)
      if (entidadeId) {
        return this.transactionEntidade<T>(entidadeId, callback)
      }

      // Fallback quando não há entidade (modo município puro)
      return this.transactionMunicipio<T>(tenant.municipioId, callback)
    }

    throw new Error('Nenhum tenant (entidade ou município) selecionado')
  }

  /**
   * Cria um novo pool de conexão para o banco central
   *
   * Este pool é usado para operações administrativas como criação
   * de schemas de novos municípios.
   *
   * NOTA: Use com cuidado - o pool deve ser fechado após o uso.
   *
   * @returns Pool de conexões para o banco central
   *
   * @example
   * ```typescript
   * const pool = DatabaseManagerService.createCentralPool()
   * try {
   *   await pool.query('CREATE SCHEMA novo_municipio')
   * } finally {
   *   await pool.end()
   * }
   * ```
   */
  static createCentralPool(): Pool {
    const poolConfig: PoolConfig = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }

    return new Pool(poolConfig)
  }

  /**
   * Executa queries SQL no banco central usando um pool dedicado
   *
   * Útil para operações administrativas que precisam executar
   * múltiplos comandos SQL (como criar schema de município).
   *
   * @param queries - Array de queries SQL para executar
   * @returns void
   *
   * @example
   * ```typescript
   * await DatabaseManagerService.executeCentralQueries([
   *   'CREATE SCHEMA novo_municipio',
   *   'SET search_path TO novo_municipio',
   *   'CREATE TABLE usuarios (...)',
   * ])
   * ```
   */
  static async executeCentralQueries(queries: string[]): Promise<void> {
    const pool = DatabaseManagerService.createCentralPool()
    const client = await pool.connect()

    try {
      for (const query of queries) {
        if (query.trim()) {
          await client.query(query)
        }
      }
    } finally {
      client.release()
      await pool.end()
    }
  }
}

// ===========================================================================
// EXPORTAÇÃO DO SINGLETON
// ===========================================================================
// Exporta a instância única para uso em todo o sistema
// Import: import { dbManager } from '#services/database_manager_service'
export const dbManager = DatabaseManagerService.getInstance()
