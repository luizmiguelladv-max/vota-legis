/**
 * =============================================================================
 * REP Proxy Service - Serviço de Proxy para REPs Control iD
 * =============================================================================
 *
 * Este serviço cria um servidor HTTP na porta 3334 que atua como intermediário
 * entre o frontend e os equipamentos REP (Registrador Eletrônico de Ponto).
 *
 * Funcionalidades:
 * - Carrega lista de equipamentos REP do banco de dados
 * - Monitora o status (online/offline) de cada REP
 * - Sincroniza funcionários do banco com os REPs
 * - Fornece endpoints REST para o frontend consultar status
 *
 * O serviço é iniciado automaticamente pelo provider quando o AdonisJS inicia.
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 * =============================================================================
 */

import * as https from 'node:https'
import * as http from 'node:http'
import env from '#start/env'
import pg from 'pg'

const { Pool } = pg

// =============================================================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// =============================================================================

/**
 * Pool de conexões PostgreSQL
 * Usa as mesmas credenciais do arquivo .env do AdonisJS
 */
const pool = new Pool({
  host: env.get('DB_HOST'),
  port: env.get('DB_PORT'),
  user: env.get('DB_USER'),
  password: env.get('DB_PASSWORD'),
  database: env.get('DB_DATABASE'),
  ssl: env.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false
})

// =============================================================================
// CONSTANTES DE CONFIGURAÇÃO
// =============================================================================

/** Porta onde o servidor proxy vai escutar */
const PROXY_PORT = 3334

/** Usuário padrão de autenticação nos REPs Control iD */
const REP_USER = 'admin'

/** Senha padrão de autenticação nos REPs Control iD */
const REP_PASS = '12345'

// =============================================================================
// INTERFACES E TIPOS
// =============================================================================

/**
 * Interface que representa um REP em cache
 * Armazena todas as informações necessárias para comunicar com o equipamento
 */
interface RepCache {
  /** ID do equipamento no banco de dados */
  id: number
  /** Nome do equipamento (ex: "REP PRINCIPAL - PREFEITURA") */
  nome: string
  /** Endereço IP do equipamento (ex: "192.168.0.200") */
  ip: string
  /** Se o equipamento está respondendo ou não */
  online: boolean
  /** Token de sessão após autenticação no REP */
  session: string | null
  /** Set com os PIS dos funcionários cadastrados no REP */
  usuarios: Set<string>
  /** Data/hora da última verificação de status */
  lastUpdate: string | null
}

/**
 * Interface que representa um funcionário em cache
 * Dados mínimos necessários para sincronização com o REP
 */
interface FuncionarioCache {
  /** ID do funcionário no banco de dados */
  id: number
  /** Nome completo do funcionário */
  nome: string
  /** CPF do funcionário (usado como fallback se PIS não existir) */
  cpf: string | null
  /** Número PIS (identificador único no REP) */
  pis: string | null
  /** Matrícula do funcionário */
  matricula: string | null
}

// =============================================================================
// VARIÁVEIS DE ESTADO
// =============================================================================

/**
 * Cache dos REPs carregados do banco
 * Chave: ID do equipamento | Valor: Dados do REP
 */
let repsCache: Record<string, RepCache> = {}

/**
 * Cache dos funcionários ativos do banco
 * Lista com dados básicos para sincronização
 */
let funcionariosDbCache: FuncionarioCache[] = []

/** Instância do servidor HTTP do proxy */
let server: http.Server | null = null

/** Flag que indica se o serviço foi inicializado */
let isInitialized = false

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * Realiza requisição HTTPS para o REP Control iD
 * Ignora erros de certificado SSL (REPs usam certificado auto-assinado)
 *
 * @param ip - Endereço IP do REP
 * @param path - Caminho da API (ex: "/login.fcgi")
 * @param method - Método HTTP (GET ou POST)
 * @param body - Corpo da requisição (opcional)
 * @returns Promise com a resposta da API
 *
 * @example
 * // Fazer login no REP
 * const result = await httpsRequest('192.168.0.200', '/login.fcgi', 'POST', { login: 'admin', password: '12345' })
 */
function httpsRequest(ip: string, path: string, method: string, body: any = null): Promise<any> {
  return new Promise((resolve, reject) => {
    // Converte o corpo para string JSON
    const bodyString = body ? JSON.stringify(body) : ''

    // Opções da requisição HTTPS
    const options: https.RequestOptions = {
      hostname: ip,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false, // Ignora certificado auto-assinado
      timeout: 5000, // Timeout de 5 segundos
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString)
      }
    }

    // Cria a requisição
    const req = https.request(options, (res) => {
      let data = ''

      // Acumula os dados da resposta
      res.on('data', (chunk: Buffer) => data += chunk)

      // Quando terminar, tenta parsear como JSON
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data) // Se não for JSON, retorna como string
        }
      })
    })

    // Tratamento de erros
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout'))
    })

    // Envia o corpo se houver
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

/**
 * Retorna o schema do banco de dados para o tenant atual
 * Usa a variável de ambiente DB_SCHEMA ou busca do banco
 *
 * @returns Nome do schema do tenant
 */
function getSchema(): string {
  return env.get('DB_SCHEMA', 'public')
}

/**
 * Busca o schema de um município específico pelo ID
 * @param municipioId ID do município
 * @returns Nome do schema ou null se não encontrado
 */
async function getSchemaByMunicipio(municipioId: number): Promise<string | null> {
  try {
    const client = await pool.connect()
    const res = await client.query(
      'SELECT db_schema FROM public.municipios WHERE id = $1 AND ativo = true',
      [municipioId]
    )
    client.release()
    return res.rows[0]?.db_schema || null
  } catch (error) {
    console.error('[REP Proxy] Erro ao buscar schema do município:', error)
    return null
  }
}

/**
 * Busca o schema pelo número de série do equipamento
 * @param numeroSerie Número de série do equipamento REP
 * @returns Nome do schema ou schema padrão
 */
async function getSchemaByEquipamento(numeroSerie: string): Promise<string> {
  try {
    const client = await pool.connect()
    // Busca em qual schema está o equipamento
    const res = await client.query(`
      SELECT m.db_schema
      FROM public.municipios m
      WHERE m.ativo = true
      AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = m.db_schema
        AND t.table_name = 'equipamentos'
      )
    `)
    client.release()

    // Para cada município, verifica se o equipamento existe
    for (const row of res.rows) {
      const schema = row.db_schema
      const checkClient = await pool.connect()
      const equipRes = await checkClient.query(
        `SELECT id FROM ${schema}.equipamentos WHERE numero_serie = $1 LIMIT 1`,
        [numeroSerie]
      )
      checkClient.release()
      if (equipRes.rows.length > 0) {
        return schema
      }
    }

    return getSchema()
  } catch (error) {
    console.error('[REP Proxy] Erro ao buscar schema por equipamento:', error)
    return getSchema()
  }
}

// =============================================================================
// FUNÇÕES DE CARREGAMENTO DE DADOS
// =============================================================================

/**
 * Carrega a lista de equipamentos REP do banco de dados
 * Atualiza o cache repsCache com os equipamentos ativos
 *
 * @returns true se carregou com sucesso, false em caso de erro
 */
async function carregarEquipamentos(): Promise<boolean> {
  try {
    const client = await pool.connect()

    // Busca equipamentos ativos com IP configurado
    const res = await client.query(`
      SELECT id, nome, ip
      FROM ${getSchema()}.equipamentos
      WHERE ativo = true AND ip IS NOT NULL AND ip != ''
    `)
    client.release()

    // Atualiza cache mantendo dados existentes (como lista de usuários)
    const novosReps: Record<string, RepCache> = {}
    for (const row of res.rows) {
      novosReps[row.id] = {
        id: row.id,
        nome: row.nome,
        ip: row.ip,
        online: false,
        session: null,
        // Preserva lista de usuários se já existia no cache
        usuarios: repsCache[row.id]?.usuarios || new Set(),
        lastUpdate: null
      }
    }

    repsCache = novosReps
    console.log(`[REP Proxy] ${Object.keys(repsCache).length} equipamento(s) carregado(s)`)
    return true

  } catch (err: any) {
    console.error('[REP Proxy] Erro ao carregar equipamentos:', err.message)
    return false
  }
}

/**
 * Carrega a lista de funcionários ativos do banco de dados
 * Atualiza o cache funcionariosDbCache
 *
 * Normaliza o PIS:
 * - Remove caracteres não numéricos
 * - Se não tiver PIS, usa o CPF
 * - Preenche com zeros à esquerda para ter 11 dígitos
 */
async function carregarFuncionariosDb(): Promise<void> {
  try {
    const client = await pool.connect()

    // Busca funcionários ativos
    const res = await client.query(`
      SELECT id, nome, cpf, pis, matricula
      FROM ${getSchema()}.funcionarios
      WHERE ativo = true
    `)
    client.release()

    // Processa cada funcionário
    funcionariosDbCache = res.rows.map((f: any) => {
      // Limpa o PIS (remove pontos, traços, etc)
      let pis = f.pis?.replace(/\D/g, '') || ''

      // Se não tiver PIS, usa o CPF como fallback
      if (!pis && f.cpf) {
        pis = f.cpf.replace(/\D/g, '').padStart(11, '0')
      }

      return {
        ...f,
        // Garante 11 dígitos com zeros à esquerda
        pis: pis ? pis.padStart(11, '0') : null
      }
    })

    console.log(`[REP Proxy] ${funcionariosDbCache.length} funcionário(s) carregado(s)`)

  } catch (err: any) {
    console.error('[REP Proxy] Erro ao carregar funcionários:', err.message)
  }
}

// =============================================================================
// FUNÇÕES DE COMUNICAÇÃO COM REP
// =============================================================================

/**
 * Verifica o status de um REP específico
 * - Tenta fazer login
 * - Se conseguir, marca como online
 * - Tenta listar os usuários cadastrados no REP
 *
 * @param repId - ID do REP a verificar
 */
async function verificarRep(repId: string): Promise<void> {
  const rep = repsCache[repId]
  if (!rep) return

  try {
    // 1. Tenta fazer login no REP
    const loginData = await httpsRequest(
      rep.ip,
      '/login.fcgi',
      'POST',
      { login: REP_USER, password: REP_PASS }
    )

    // Verifica se recebeu token de sessão
    if (!loginData.session) {
      throw new Error('Falha no login - sem token de sessão')
    }

    // Login OK - atualiza status
    rep.session = loginData.session
    rep.online = true

    // 2. Tenta listar usuários cadastrados no REP
    try {
      const usersData = await httpsRequest(
        rep.ip,
        `/load_objects.fcgi?session=${rep.session}`,
        'POST',
        { object: 'users' }
      )

      // Se conseguiu listar, atualiza o Set de usuários
      if (usersData.users) {
        rep.usuarios = new Set(usersData.users.map((u: any) => String(u.pis)))
      }
    } catch (e: any) {
      // Alguns modelos de REP não suportam listar usuários
      // Não é erro crítico, apenas loga
      console.log(`[REP Proxy] Aviso: não foi possível listar usuários de ${rep.nome}`)
    }

    rep.lastUpdate = new Date().toISOString()
    console.log(`[REP Proxy] ✓ ${rep.nome} (${rep.ip}) - ONLINE`)

  } catch (err: any) {
    // Falha na comunicação - marca como offline
    rep.online = false
    rep.session = null
    console.log(`[REP Proxy] ✗ ${rep.nome} (${rep.ip}) - OFFLINE: ${err.message}`)
  }
}

/**
 * Sincroniza um funcionário específico com um REP
 * Envia os dados do funcionário para cadastrar/atualizar no REP
 *
 * @param repId - ID do REP de destino
 * @param funcionarioId - ID do funcionário a sincronizar
 * @returns Objeto com resultado { success: boolean, error?: string }
 */
async function sincronizarUsuario(
  repId: string,
  funcionarioId: number
): Promise<{ success: boolean, error?: string }> {

  // Busca o REP no cache
  const rep = repsCache[repId]
  if (!rep || !rep.online || !rep.session) {
    return { success: false, error: 'REP offline ou não autenticado' }
  }

  // Busca o funcionário no cache
  const func = funcionariosDbCache.find(f => f.id === funcionarioId)
  if (!func || !func.pis) {
    return { success: false, error: 'Funcionário não encontrado ou sem PIS' }
  }

  try {
    // Monta o payload no formato esperado pelo REP Control iD
    // IMPORTANTE: PIS e matrícula devem ser inteiros (não strings)
    const userPayload = {
      name: func.nome.substring(0, 50), // Nome limitado a 50 caracteres
      registration: parseInt(func.matricula?.replace(/\D/g, '') || String(func.id)),
      pis: parseInt(func.pis),
      password: '' // REP não usa senha de usuário
    }

    // Envia para o REP
    const res = await httpsRequest(
      rep.ip,
      `/update_users.fcgi?session=${rep.session}`,
      'POST',
      { users: [userPayload] }
    )

    // Verifica se deu certo
    if (res && !res.error) {
      // Marca que este PIS está cadastrado no REP
      rep.usuarios.add(func.pis)
      return { success: true }
    }

    return { success: false, error: JSON.stringify(res) }

  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Exclui um usuário de um REP específico
 * Remove o cadastro do funcionário do REP pelo PIS
 *
 * @param repId - ID do REP
 * @param pis - PIS do funcionário a excluir
 * @returns Objeto com resultado { success: boolean, error?: string }
 */
async function excluirUsuarioRep(
  repId: string,
  pis: string
): Promise<{ success: boolean, error?: string }> {

  // Busca o REP no cache
  const rep = repsCache[repId]
  if (!rep || !rep.online || !rep.session) {
    return { success: false, error: 'REP offline ou não autenticado' }
  }

  if (!pis) {
    return { success: false, error: 'PIS não informado' }
  }

  try {
    // Normaliza o PIS
    const pisNormalizado = pis.replace(/\D/g, '').padStart(11, '0')

    // Monta o payload para exclusão no formato Control iD
    // O REP identifica usuários pelo campo "pis"
    const payload = {
      object: 'users',
      where: {
        users: { pis: parseInt(pisNormalizado) }
      }
    }

    // Envia comando de exclusão para o REP
    const res = await httpsRequest(
      rep.ip,
      `/destroy_objects.fcgi?session=${rep.session}`,
      'POST',
      payload
    )

    // Verifica se deu certo
    if (res && !res.error) {
      // Remove do Set de usuários locais
      rep.usuarios.delete(pisNormalizado)
      console.log(`[REP Proxy] Usuário ${pisNormalizado} excluído de ${rep.nome}`)
      return { success: true }
    }

    return { success: false, error: JSON.stringify(res) }

  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Executa o loop de monitoramento
 * - Atualiza cache de funcionários
 * - Verifica status de cada REP em paralelo
 */
async function loopMonitoramento(): Promise<void> {
  console.log('[REP Proxy] Iniciando monitoramento...')

  // Atualiza lista de funcionários
  await carregarFuncionariosDb()

  // Verifica cada REP em paralelo (mais rápido)
  const promises = Object.keys(repsCache).map(id => verificarRep(id))
  await Promise.all(promises)

  console.log('[REP Proxy] Monitoramento concluído')
}

// =============================================================================
// SERVIDOR HTTP
// =============================================================================

/**
 * Cria o servidor HTTP que escuta na porta 3334
 * Endpoints disponíveis:
 *
 * GET /status ou /usuarios
 *   - Retorna lista de REPs e status de sincronização de cada funcionário
 *
 * POST /sincronizar
 *   - Sincroniza um funcionário específico com um REP
 *   - Body: { rep_id: number, funcionario_id: number }
 *
 * POST /sincronizar_tudo
 *   - Sincroniza TODOS os funcionários com TODOS os REPs online
 *
 * GET /refresh
 *   - Força recarregamento dos equipamentos e status
 *
 * @returns Instância do servidor HTTP
 */
function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    // Headers padrão para JSON e CORS
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')

    // =========================================================================
    // ENDPOINT: GET /status ou /usuarios
    // Retorna status de todos os REPs e mapa de sincronização
    // =========================================================================
    if (req.url === '/status' || req.url === '/usuarios') {
      const response: any = {
        // Lista de REPs com status
        reps: Object.values(repsCache).map(r => ({
          id: r.id,
          nome: r.nome,
          ip: r.ip,
          online: r.online
        })),
        // Mapa: PIS -> { rep_id: boolean (está cadastrado?) }
        sinc_status: {}
      }

      // Monta o mapa de sincronização
      funcionariosDbCache.forEach(f => {
        if (f.pis) {
          const statusRep: Record<string, boolean> = {}
          Object.values(repsCache).forEach(r => {
            statusRep[r.id] = r.usuarios.has(f.pis!)
          })
          response.sinc_status[f.pis] = statusRep
        }
      })

      res.end(JSON.stringify(response))

      // =========================================================================
      // ENDPOINT: POST /sincronizar
      // Sincroniza um funcionário específico com um REP específico
      // =========================================================================
    } else if (req.url === '/sincronizar' && req.method === 'POST') {
      let body = ''
      req.on('data', (c: Buffer) => body += c)
      req.on('end', async () => {
        try {
          const { rep_id, funcionario_id } = JSON.parse(body)
          const result = await sincronizarUsuario(rep_id, funcionario_id)
          res.end(JSON.stringify(result))
        } catch (e: any) {
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // =========================================================================
      // ENDPOINT: POST /sincronizar_tudo
      // Sincroniza TODOS os funcionários com TODOS os REPs online
      // =========================================================================
    } else if (req.url === '/sincronizar_tudo' && req.method === 'POST') {
      console.log('[REP Proxy] Iniciando sincronização em massa...')

      let total = 0
      let sucessos = 0
      let erros = 0

      // Para cada REP online
      for (const repId of Object.keys(repsCache)) {
        const rep = repsCache[repId]
        if (!rep.online) continue

        console.log(`[REP Proxy] Enviando ${funcionariosDbCache.length} funcionários para ${rep.nome}...`)

        // Envia cada funcionário
        for (const func of funcionariosDbCache) {
          if (!func.pis) continue

          total++
          const result = await sincronizarUsuario(repId, func.id)

          if (result.success) {
            sucessos++
          } else {
            erros++
          }
        }
      }

      console.log(`[REP Proxy] Sincronização finalizada: ${sucessos} OK, ${erros} erros`)
      res.end(JSON.stringify({ success: true, total, sucessos, erros }))

      // =========================================================================
      // ENDPOINT: GET /refresh
      // Força recarregamento de equipamentos e status
      // =========================================================================
    } else if (req.url === '/refresh') {
      await carregarEquipamentos()
      await loopMonitoramento()
      res.end(JSON.stringify({ success: true }))

      // =========================================================================
      // ENDPOINT: POST /excluir
      // Exclui um usuário específico de um REP específico
      // =========================================================================
    } else if (req.url === '/excluir' && req.method === 'POST') {
      let body = ''
      req.on('data', (c: Buffer) => body += c)
      req.on('end', async () => {
        try {
          const { rep_id, pis } = JSON.parse(body)
          const result = await excluirUsuarioRep(rep_id, pis)
          res.end(JSON.stringify(result))
        } catch (e: any) {
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // =========================================================================
      // ENDPOINT: POST /excluir_todos
      // Exclui um usuário de TODOS os REPs online
      // =========================================================================
    } else if (req.url === '/excluir_todos' && req.method === 'POST') {
      let body = ''
      req.on('data', (c: Buffer) => body += c)
      req.on('end', async () => {
        try {
          const { pis } = JSON.parse(body)
          console.log(`[REP Proxy] Excluindo usuário ${pis} de todos os REPs...`)

          let sucessos = 0
          let erros = 0

          for (const repId of Object.keys(repsCache)) {
            const rep = repsCache[repId]
            if (!rep.online) continue

            const result = await excluirUsuarioRep(repId, pis)
            if (result.success) {
              sucessos++
            } else {
              erros++
            }
          }

          console.log(`[REP Proxy] Exclusão finalizada: ${sucessos} OK, ${erros} erros`)
          res.end(JSON.stringify({ success: true, sucessos, erros }))
        } catch (e: any) {
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // =========================================================================
      // ENDPOINT NÃO ENCONTRADO
      // =========================================================================
    } else {
      res.end(JSON.stringify({ error: 'Endpoint não encontrado' }))
    }
  })
}

// =============================================================================
// EXPORTAÇÃO DO SERVIÇO
// =============================================================================

/**
 * Serviço principal exportado para uso pelo provider
 * Fornece métodos para inicializar, encerrar e verificar status
 */
export const repProxyService = {

  /**
   * Inicializa o REP Proxy na porta 3334
   * - Carrega equipamentos do banco
   * - Inicia monitoramento
   * - Cria servidor HTTP
   * - Agenda verificações periódicas (a cada 5 minutos)
   */
  async init(): Promise<void> {
    // Evita inicialização duplicada
    if (isInitialized) {
      console.log('[REP Proxy] Serviço já está rodando')
      return
    }

    try {
      console.log('[REP Proxy] Inicializando serviço...')

      // 1. Carrega equipamentos do banco
      await carregarEquipamentos()

      // 2. Verifica status inicial de cada REP
      await loopMonitoramento()

      // 3. Cria e inicia o servidor HTTP
      server = createServer()

      server.listen(PROXY_PORT, () => {
        isInitialized = true
        console.log(`[REP Proxy] ✓ Servidor iniciado na porta ${PROXY_PORT}`)
      })

      // Tratamento de erro se a porta já estiver em uso
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[REP Proxy] Porta ${PROXY_PORT} já em uso (proxy externo pode estar rodando)`)
        } else {
          console.error('[REP Proxy] Erro no servidor:', err.message)
        }
      })

      // 4. Agenda verificações periódicas (a cada 5 minutos)
      setInterval(loopMonitoramento, 5 * 60 * 1000)

    } catch (err: any) {
      console.error('[REP Proxy] Erro ao inicializar:', err.message)
    }
  },

  /**
   * Encerra o servidor e fecha conexões com o banco
   * Chamado automaticamente quando o AdonisJS desliga
   */
  async shutdown(): Promise<void> {
    if (server) {
      server.close()
      server = null
      isInitialized = false
      console.log('[REP Proxy] Servidor encerrado')
    }
    await pool.end()
  },

  /**
   * Verifica se o serviço está rodando
   * @returns true se inicializado, false caso contrário
   */
  isRunning(): boolean {
    return isInitialized
  }
}
