/**
 * ===========================================================================
 * SERVIÇO DE SINCRONIZAÇÃO REP - Multi-Tenant
 * ===========================================================================
 *
 * Serviço standalone que sincroniza batidas de ponto dos equipamentos REP
 * (Registrador Eletrônico de Ponto) Control iD para o banco de dados.
 *
 * FUNCIONALIDADE:
 * ---------------
 * - Busca todos os municípios ativos no sistema
 * - Para cada município, busca seus equipamentos REP
 * - Conecta em cada REP e baixa o AFD (Arquivo Fonte de Dados)
 * - Importa os novos registros para a tabela registros_ponto
 * - Notifica o servidor AdonisJS via HTTP para emitir WebSocket
 *
 * EXECUÇÃO:
 * ---------
 * ```bash
 * # Com flag para certificados auto-assinados do REP
 * node --insecure-http-parser scripts/servico-sincronizacao.mjs
 * ```
 *
 * CONFIGURAÇÃO:
 * -------------
 * Via variáveis de ambiente (.env):
 * - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE: Conexão PostgreSQL
 * - SYNC_INTERVAL_SECONDS: Intervalo entre sincronizações (default: 5)
 * - APP_URL: URL do servidor AdonisJS (default: http://localhost:3333)
 *
 * MULTI-TENANT:
 * -------------
 * O serviço busca municípios na tabela `public.municipios` e para cada um:
 * 1. Obtém o `db_schema` (ex: 'santo_andre')
 * 2. Configura `search_path` para o schema do município
 * 3. Busca equipamentos e funcionários desse schema
 * 4. Importa registros para `{schema}.registros_ponto`
 *
 * FORMATO AFD (Portaria 1510/671):
 * --------------------------------
 * O AFD é um arquivo de texto com registros de ponto. Cada linha tipo 3:
 * - Posição 0-9: NSR (Número Sequencial de Registro)
 * - Posição 9-10: Tipo de registro ('3' = marcação de ponto)
 * - Posição 10-18: Data (DDMMAAAA)
 * - Posição 18-22: Hora (HHMM)
 * - Posição 22-34: PIS do funcionário
 *
 * WEBSOCKET:
 * ----------
 * Quando um novo registro é importado, o serviço notifica o servidor
 * AdonisJS via POST /api/interno/nova-batida para que este emita o
 * evento WebSocket 'nova-batida' para atualização em tempo real.
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

// =============================================================================
// IMPORTS
// =============================================================================

import https from 'https'       // Requisições HTTPS para os REPs
import http from 'http'         // Requisições HTTP para o AdonisJS
import pg from 'pg'             // Cliente PostgreSQL
import dotenv from 'dotenv'     // Carrega variáveis de ambiente

// Carrega variáveis do arquivo .env
dotenv.config()

// Extrai Pool do módulo pg
const { Pool } = pg

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

/**
 * URL do servidor AdonisJS para notificar via WebSocket
 * O serviço envia um POST para que o AdonisJS emita evento WebSocket
 */
const ADONIS_URL = process.env.APP_URL || 'http://localhost:3333'

/**
 * Pool de conexões PostgreSQL
 * Usado para todas as queries do serviço
 *
 * SSL é detectado automaticamente baseado no host:
 * - Supabase/pooler: SSL habilitado
 * - Servidores próprios: SSL desabilitado
 */
const requiresSsl = process.env.DB_SSL === 'false' ? false : (
  process.env.DB_HOST?.includes('supabase.co') ||
  process.env.DB_HOST?.includes('pooler.supabase') ||
  process.env.DB_SSL === 'true'
)

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: requiresSsl ? { rejectUnauthorized: false } : false
})

/**
 * Intervalo entre sincronizações em segundos
 * Default: 30 segundos (evita sobrecarregar o REP)
 */
const INTERVALO_SEGUNDOS = parseInt(process.env.SYNC_INTERVAL_SECONDS || '30')

/**
 * Credenciais de acesso ao REP Control iD
 * Padrão de fábrica: admin/12345
 */
const REP_USER = 'admin'
const REP_PASS = '12345'

// =============================================================================
// FUNÇÕES UTILITÁRIAS
// =============================================================================

/**
 * Log formatado com timestamp
 *
 * @param {string} msg - Mensagem a ser logada
 *
 * @example
 * log('Iniciando sincronização...')
 * // [13/12/2024 14:30:45] Iniciando sincronização...
 */
function log(msg) {
  const timestamp = new Date().toLocaleString('pt-BR')
  console.log(`[${timestamp}] ${msg}`)
}

// =============================================================================
// COMUNICAÇÃO COM ADONISJS (WEBSOCKET)
// =============================================================================

/**
 * Notifica o servidor AdonisJS via HTTP para emitir WebSocket
 *
 * Quando um novo registro é importado, esta função envia os dados
 * para o AdonisJS, que então emite um evento 'nova-batida' para
 * todos os clientes conectados daquele município.
 *
 * ENDPOINT: POST /api/interno/nova-batida
 *
 * O endpoint é interno (não exposto publicamente) e usa uma chave
 * de API para autenticação básica.
 *
 * @param {Object} batida - Dados da batida para notificar
 * @param {number} batida.municipio_id - ID do município
 * @param {number} batida.funcionario_id - ID do funcionário
 * @param {string} batida.funcionario_nome - Nome do funcionário
 * @param {string} batida.data_hora - Data/hora em ISO
 * @param {string} batida.sentido - 'ENTRADA' ou 'SAIDA'
 * @param {string} batida.origem - Origem do registro (AFD_REP)
 *
 * @example
 * notificarNovaBatida({
 *   municipio_id: 1,
 *   funcionario_id: 42,
 *   funcionario_nome: 'João Silva',
 *   data_hora: '2024-12-13T08:00:00.000Z',
 *   sentido: 'ENTRADA',
 *   origem: 'AFD_REP'
 * })
 */
async function notificarNovaBatida(batida) {
  try {
    // Prepara URL do endpoint
    const url = new URL('/api/interno/nova-batida', ADONIS_URL)
    const bodyString = JSON.stringify(batida)

    // Configura opções da requisição HTTP
    const options = {
      hostname: url.hostname,
      port: url.port || 3333,
      path: url.pathname,
      method: 'POST',
      timeout: 5000,  // 5 segundos de timeout
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        // Chave de API para autenticação interna
        'X-Internal-Key': process.env.INTERNAL_API_KEY || 'sync-service'
      }
    }

    // Envia requisição (fire and forget)
    const req = http.request(options, (res) => {
      // Ignora resposta - o importante é enviar
    })

    // Ignora erros silenciosamente
    // O WebSocket é um extra, não deve parar a sincronização
    req.on('error', () => { })

    // Envia corpo e finaliza
    req.write(bodyString)
    req.end()
  } catch (err) {
    // Ignora erros - o WebSocket é opcional
  }
}

// =============================================================================
// COMUNICAÇÃO COM REP CONTROL iD
// =============================================================================

/**
 * Faz requisição HTTPS para o REP Control iD
 *
 * O REP usa HTTPS com certificado auto-assinado, por isso:
 * - `rejectUnauthorized: false` aceita qualquer certificado
 * - `--insecure-http-parser` na linha de comando aceita headers malformados
 *
 * @param {string} ip - Endereço IP do REP (ex: '192.168.0.200')
 * @param {string} path - Caminho da API (ex: '/login.fcgi')
 * @param {string} method - Método HTTP (GET, POST)
 * @param {Object|null} body - Corpo da requisição (JSON)
 * @returns {Promise<string>} Resposta como string
 *
 * @example
 * // Login no REP
 * const resp = await httpsRequest('192.168.0.200', '/login.fcgi', 'POST', {
 *   login: 'admin',
 *   password: '12345'
 * })
 * const data = JSON.parse(resp)
 * console.log(data.session) // Token de sessão
 */
function httpsRequest(ip, path, method, body = null) {
  return new Promise((resolve, reject) => {
    // Serializa corpo se houver
    const bodyString = body ? JSON.stringify(body) : ''

    // Configura opções da requisição
    const options = {
      hostname: ip,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false,  // Aceita certificado auto-assinado
      timeout: 60000,             // 60 segundos de timeout
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString)
      }
    }

    // Cria requisição HTTPS
    const req = https.request(options, (res) => {
      let data = ''

      // Acumula dados da resposta
      res.on('data', chunk => data += chunk)

      // Resolve quando terminar
      res.on('end', () => resolve(data))
    })

    // Trata erros de conexão
    req.on('error', reject)

    // Trata timeout
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout'))
    })

    // Envia corpo se houver
    if (bodyString) req.write(bodyString)

    // Finaliza requisição
    req.end()
  })
}

// =============================================================================
// PARSER AFD (PORTARIA 1510/671)
// =============================================================================

/**
 * Parse do arquivo AFD do REP
 *
 * O AFD (Arquivo Fonte de Dados) é o formato padrão definido pela
 * Portaria 1510/2009 (atualizada pela 671/2021) para exportação
 * de registros de ponto.
 *
 * ESTRUTURA DO REGISTRO TIPO 3 (Marcação de Ponto):
 * -------------------------------------------------
 * | Posição | Tamanho | Campo               |
 * |---------|---------|---------------------|
 * | 0-8     | 9       | NSR (sequencial)    |
 * | 9       | 1       | Tipo (3=marcação)   |
 * | 10-17   | 8       | Data (DDMMAAAA)     |
 * | 18-21   | 4       | Hora (HHMM)         |
 * | 22-33   | 12      | PIS                 |
 *
 * @param {string} afdData - Conteúdo do arquivo AFD
 * @returns {Array<Object>} Array de registros parseados
 *
 * @example
 * const registros = parseAFD(afdContent)
 * // [
 * //   { nsr: '000000001', dataHora: Date, pis: '12345678901' },
 * //   { nsr: '000000002', dataHora: Date, pis: '98765432100' },
 * //   ...
 * // ]
 */
function parseAFD(afdData) {
  const registros = []

  // Divide em linhas e remove vazias
  const linhas = afdData.split('\n').filter(l => l.trim())

  for (const linha of linhas) {
    // Ignora linhas muito curtas
    if (linha.length < 34) continue

    // Extrai campos da linha
    const nsr = linha.substring(0, 9).trim()    // NSR (9 dígitos)
    const tipo = linha.substring(9, 10)          // Tipo de registro

    // Processa apenas registros tipo 3 (marcação de ponto)
    if (tipo === '3') {
      // Extrai data (DDMMAAAA)
      const dataDDMMAAAA = linha.substring(10, 18)
      // Extrai hora (HHMM)
      const horaHHMM = linha.substring(18, 22)
      // Extrai PIS (12 dígitos)
      const pis = linha.substring(22, 34).trim()

      // Parse dos componentes de data
      const dia = dataDDMMAAAA.substring(0, 2)
      const mes = dataDDMMAAAA.substring(2, 4)
      const ano = dataDDMMAAAA.substring(4, 8)

      // Parse dos componentes de hora
      const hora = horaHHMM.substring(0, 2)
      const minuto = horaHHMM.substring(2, 4)

      // Monta objeto Date
      const dataHora = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:00`)

      // Valida se a data é válida
      if (!isNaN(dataHora.getTime())) {
        registros.push({
          nsr,
          dataHora,
          // Remove zeros à esquerda do PIS, mas mantém se for só zeros
          pis: pis.replace(/^0+/, '') || pis
        })
      }
    }
  }

  return registros
}

// =============================================================================
// CONSULTAS AO BANCO DE DADOS
// =============================================================================

/**
 * Busca todos os municípios ativos do banco (tabela public.municipios)
 *
 * Retorna apenas municípios que:
 * - Estão ativos (ativo = true)
 * - Têm schema configurado (db_schema não vazio)
 *
 * @returns {Promise<Array<Object>>} Lista de municípios
 *
 * @example
 * const municipios = await buscarMunicipios()
 * // [
 * //   { id: 1, nome: 'Santo André', db_schema: 'santo_andre' },
 * //   ...
 * // ]
 */
async function buscarMunicipios() {
  const client = await pool.connect()
  try {
    const result = await client.query(`
      SELECT id, nome, db_schema
      FROM public.municipios
      WHERE ativo = true AND db_schema IS NOT NULL AND db_schema != ''
    `)
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * Busca data inicial do banco de dados (configuracoes_sistema) para um município
 *
 * A data inicial é usada para ignorar registros antigos durante a importação.
 * Útil para importações iniciais onde há dados históricos que não devem entrar.
 *
 * @param {string} schema - Nome do schema do município
 * @returns {Promise<string|null>} Data no formato 'YYYY-MM-DD' ou null
 *
 * @example
 * const dataInicial = await buscarDataInicialDoMunicipio('santo_andre')
 * // '2024-12-13' ou null
 */
async function buscarDataInicialDoMunicipio(schema) {
  const client = await pool.connect()
  try {
    // Define search_path para o schema do município
    await client.query(`SET search_path TO ${schema}`)

    // Busca configuração
    const result = await client.query(`
      SELECT valor FROM configuracoes_sistema
      WHERE chave = 'data_inicial_registros'
    `)

    if (result.rows.length > 0 && result.rows[0].valor) {
      return result.rows[0].valor
    }
    return null
  } catch (err) {
    // Tabela pode não existir, ignora
    return null
  } finally {
    client.release()
  }
}

/**
 * Busca equipamentos ativos do município
 *
 * Retorna apenas equipamentos que:
 * - Estão ativos (ativo = true)
 * - Têm IP configurado (ip não vazio)
 *
 * @param {string} schema - Nome do schema do município
 * @returns {Promise<Array<Object>>} Lista de equipamentos
 *
 * @example
 * const equipamentos = await buscarEquipamentos('santo_andre')
 * // [
 * //   { id: 1, nome: 'REP Entrada', ip: '192.168.0.200' },
 * //   ...
 * // ]
 */
async function buscarEquipamentos(schema) {
  const client = await pool.connect()
  try {
    // Define search_path para o schema do município
    await client.query(`SET search_path TO ${schema}`)

    const result = await client.query(`
      SELECT id, nome, ip
      FROM equipamentos
      WHERE ativo = true AND ip IS NOT NULL AND ip != ''
    `)
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * Busca mapa PIS -> { id, nome } para um município
 *
 * Cria um Map que permite buscar funcionário por PIS de várias formas:
 * - PIS limpo (só números)
 * - PIS como número inteiro
 * - PIS sem zeros à esquerda
 *
 * Isso é necessário porque o REP pode enviar o PIS em diferentes formatos.
 *
 * @param {string} schema - Nome do schema do município
 * @returns {Promise<Map>} Map de PIS para { id, nome }
 *
 * @example
 * const mapa = await buscarMapaFuncionarios('santo_andre')
 * const func = mapa.get('12345678901')
 * // { id: 42, nome: 'João Silva' }
 */
async function buscarMapaFuncionarios(schema) {
  const client = await pool.connect()
  try {
    // Define search_path para o schema do município
    await client.query(`SET search_path TO ${schema}`)

    // Busca todos os funcionários ativos
    const result = await client.query('SELECT id, pis, nome FROM funcionarios WHERE ativo = true')

    // Cria Map com múltiplas chaves para o mesmo funcionário
    const mapa = new Map()
    for (const f of result.rows) {
      if (f.pis) {
        // Remove caracteres não numéricos
        const pisLimpo = f.pis.replace(/\D/g, '')
        const funcionario = { id: f.id, nome: f.nome }

        // Adiciona com diferentes formatos de PIS
        mapa.set(pisLimpo, funcionario)                    // String limpa
        mapa.set(parseInt(pisLimpo), funcionario)          // Número inteiro
        mapa.set(pisLimpo.replace(/^0+/, ''), funcionario) // Sem zeros à esquerda
      }
    }
    return mapa
  } finally {
    client.release()
  }
}

/**
 * Busca NSRs já importados para um equipamento
 *
 * O NSR (Número Sequencial de Registro) é único por equipamento.
 * Esta função retorna um Set com todos os NSRs já importados,
 * permitindo identificar rapidamente quais registros são novos.
 *
 * @param {string} schema - Nome do schema do município
 * @param {number} equipamentoId - ID do equipamento
 * @returns {Promise<Set>} Set de NSRs já importados
 *
 * @example
 * const nsrs = await buscarNsrsExistentes('santo_andre', 1)
 * if (!nsrs.has('000000001')) {
 *   // NSR é novo, pode importar
 * }
 */
async function buscarNsrsExistentes(schema, equipamentoId) {
  const client = await pool.connect()
  try {
    // Define search_path para o schema do município
    await client.query(`SET search_path TO ${schema}`)

    // Busca NSRs existentes para o equipamento
    const result = await client.query(
      'SELECT nsr FROM registros_ponto WHERE equipamento_id = $1 AND nsr IS NOT NULL',
      [equipamentoId]
    )

    // Converte para Set para busca O(1)
    return new Set(result.rows.map(r => r.nsr))
  } finally {
    client.release()
  }
}

// =============================================================================
// SINCRONIZAÇÃO DE EQUIPAMENTO
// =============================================================================

/**
 * Sincroniza um equipamento de um município específico
 *
 * Este é o coração do serviço. Para cada equipamento REP:
 * 1. Faz login no REP
 * 2. Baixa o AFD (todos os registros)
 * 3. Filtra registros já importados (por NSR)
 * 4. Para cada novo registro:
 *    - Busca funcionário pelo PIS
 *    - Calcula sentido (ENTRADA/SAÍDA)
 *    - Insere no banco
 *    - Notifica via WebSocket
 * 5. Atualiza status do equipamento
 *
 * @param {Object} municipio - Dados do município
 * @param {number} municipio.id - ID do município
 * @param {string} municipio.db_schema - Schema do município
 * @param {Object} equipamento - Dados do equipamento
 * @param {number} equipamento.id - ID do equipamento
 * @param {string} equipamento.nome - Nome do equipamento
 * @param {string} equipamento.ip - IP do equipamento
 * @param {Map} mapaFuncionarios - Map de PIS -> funcionário
 * @param {string|null} dataInicial - Data mínima para importar
 * @returns {Promise<Object>} Resultado { sucesso: boolean, importados: number }
 *
 * @example
 * const resultado = await sincronizarEquipamento(
 *   { id: 1, db_schema: 'santo_andre' },
 *   { id: 1, nome: 'REP Entrada', ip: '192.168.0.200' },
 *   mapaFuncionarios,
 *   '2024-12-13'
 * )
 * // { sucesso: true, importados: 5 }
 */
async function sincronizarEquipamento(municipio, equipamento, mapaFuncionarios, dataInicial) {
  const { id: municipioId, db_schema: schema } = municipio
  const { id, nome, ip } = equipamento

  try {
    // =========================================================================
    // ETAPA 1: LOGIN NO REP
    // =========================================================================
    const loginData = await httpsRequest(ip, '/login.fcgi', 'POST', {
      login: REP_USER,
      password: REP_PASS
    })
    const loginJson = JSON.parse(loginData)

    // Verifica se login foi bem-sucedido
    if (!loginJson.session) {
      log(`  ❌ ${nome}: Falha no login`)
      return { sucesso: false, importados: 0 }
    }

    // =========================================================================
    // ETAPA 2: BUSCA AFD
    // =========================================================================
    // O AFD contém TODOS os registros do REP
    const afdData = await httpsRequest(
      ip,
      `/get_afd.fcgi?session=${loginJson.session}`,
      'POST',
      {}
    )

    // Verifica se obteve AFD válido
    if (!afdData || afdData.includes('error')) {
      log(`  ❌ ${nome}: Erro ao buscar AFD`)
      return { sucesso: false, importados: 0 }
    }

    // =========================================================================
    // ETAPA 3: PARSE DO AFD
    // =========================================================================
    const registros = parseAFD(afdData)

    if (registros.length === 0) {
      log(`  ✓ ${nome}: Nenhum registro no AFD`)
      return { sucesso: true, importados: 0 }
    }

    // =========================================================================
    // ETAPA 4: FILTRA REGISTROS JÁ IMPORTADOS
    // =========================================================================
    const nsrsExistentes = await buscarNsrsExistentes(schema, id)

    // Filtra apenas registros novos
    const novosRegistros = registros.filter(r => !nsrsExistentes.has(r.nsr))

    if (novosRegistros.length === 0) {
      log(`  ✓ ${nome}: Sem novos registros (${registros.length} já importados)`)
      return { sucesso: true, importados: 0 }
    }

    // =========================================================================
    // ETAPA 5: IMPORTA NOVOS REGISTROS
    // =========================================================================
    const client = await pool.connect()
    let importados = 0

    try {
      // Define search_path para o schema do município
      await client.query(`SET search_path TO ${schema}`)

      for (const reg of novosRegistros) {
        // ---------------------------------------------------------------------
        // BUSCA FUNCIONÁRIO PELO PIS
        // ---------------------------------------------------------------------
        // Tenta encontrar o funcionário usando diferentes formatos de PIS
        const funcionario = mapaFuncionarios.get(reg.pis) ||
          mapaFuncionarios.get(parseInt(reg.pis)) ||
          mapaFuncionarios.get(reg.pis.padStart(11, '0'))

        // Se não encontrou funcionário, pula este registro
        if (!funcionario) continue

        const funcionarioId = funcionario.id
        const funcionarioNome = funcionario.nome

        // ---------------------------------------------------------------------
        // FILTRA POR DATA INICIAL
        // ---------------------------------------------------------------------
        // Ignora registros anteriores à data inicial configurada
        if (dataInicial) {
          const dataReg = reg.dataHora.toISOString().split('T')[0]
          if (dataReg < dataInicial) continue
        }

        try {
          // -------------------------------------------------------------------
          // VERIFICA DUPLICIDADE (60 segundos de tolerância)
          // -------------------------------------------------------------------
          // Se já existe um registro do funcionário próximo a este horário
          // (pode ter vindo do terminal facial), não duplica
          const duplicataResult = await client.query(
            `SELECT id, origem FROM registros_ponto
             WHERE funcionario_id = $1
             AND data_hora BETWEEN ($2::TIMESTAMP - INTERVAL '60 seconds') AND ($2::TIMESTAMP + INTERVAL '60 seconds')
             LIMIT 1`,
            [funcionarioId, reg.dataHora]
          )

          if (duplicataResult.rows.length > 0) {
            // Já existe registro próximo - não duplicar
            log(`    → ${funcionarioNome} - Já existe registro (${duplicataResult.rows[0].origem})`)
            continue
          }

          // -------------------------------------------------------------------
          // CALCULA SENTIDO (ENTRADA/SAÍDA)
          // -------------------------------------------------------------------
          // Conta quantas batidas o funcionário já tem no dia
          // Par = ENTRADA, Ímpar = SAÍDA
          const dataRegistro = reg.dataHora.toISOString().split('T')[0]
          const batidasResult = await client.query(
            `SELECT COUNT(*) as total FROM registros_ponto
             WHERE funcionario_id = $1 AND DATE(data_hora) = $2`,
            [funcionarioId, dataRegistro]
          )
          const totalBatidas = parseInt(batidasResult.rows[0].total || '0')
          const sentido = totalBatidas % 2 === 0 ? 'ENTRADA' : 'SAIDA'

          // -------------------------------------------------------------------
          // INSERE REGISTRO NO BANCO
          // -------------------------------------------------------------------
          await client.query(`
            INSERT INTO registros_ponto
            (funcionario_id, equipamento_id, data_hora, nsr, pis, sentido, tipo, origem, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'ORIGINAL', 'AFD_REP', NOW(), NOW())
          `, [funcionarioId, id, reg.dataHora, reg.nsr, reg.pis, sentido])
          importados++

          // -------------------------------------------------------------------
          // LOG DA BATIDA
          // -------------------------------------------------------------------
          const hora = reg.dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          log(`    → ${funcionarioNome} - ${sentido} às ${hora}`)

          // -------------------------------------------------------------------
          // NOTIFICA WEBSOCKET
          // -------------------------------------------------------------------
          // Envia para o servidor AdonisJS para atualizar clientes em tempo real
          notificarNovaBatida({
            municipio_id: municipioId,
            funcionario_id: funcionarioId,
            funcionario_nome: funcionarioNome,
            data_hora: reg.dataHora.toISOString(),
            sentido: sentido,
            origem: 'AFD_REP'
          })
        } catch (err) {
          // Ignora duplicados (constraint violation)
          // Pode acontecer em concorrência
        }
      }

      // -----------------------------------------------------------------------
      // ATUALIZA STATUS DO EQUIPAMENTO
      // -----------------------------------------------------------------------
      // Marca como ONLINE já que conseguimos comunicar
      await client.query(
        'UPDATE equipamentos SET status = $1, ultima_comunicacao = NOW() WHERE id = $2',
        ['ONLINE', id]
      )

    } finally {
      client.release()
    }

    log(`  ✓ ${nome}: ${importados} novos registros importados`)
    return { sucesso: true, importados }

  } catch (err) {
    // =========================================================================
    // TRATAMENTO DE ERROS
    // =========================================================================
    log(`  ❌ ${nome}: ${err.message}`)

    // Marca equipamento como OFFLINE
    const client = await pool.connect()
    try {
      await client.query(`SET search_path TO ${schema}`)
      await client.query('UPDATE equipamentos SET status = $1 WHERE id = $2', ['OFFLINE', id])
    } finally {
      client.release()
    }

    return { sucesso: false, importados: 0 }
  }
}

// =============================================================================
// SINCRONIZAÇÃO DE MUNICÍPIO
// =============================================================================

/**
 * Sincroniza um município completo
 *
 * Para cada município:
 * 1. Busca data inicial de configuração
 * 2. Busca lista de equipamentos ativos
 * 3. Busca mapa de funcionários (PIS -> dados)
 * 4. Sincroniza cada equipamento
 *
 * @param {Object} municipio - Dados do município
 * @param {number} municipio.id - ID do município
 * @param {string} municipio.nome - Nome do município
 * @param {string} municipio.db_schema - Schema do município
 * @returns {Promise<Object>} Resultado { sucesso: boolean, importados: number }
 *
 * @example
 * const resultado = await sincronizarMunicipio({
 *   id: 1,
 *   nome: 'Santo André',
 *   db_schema: 'santo_andre'
 * })
 * // { sucesso: true, importados: 15 }
 */
async function sincronizarMunicipio(municipio) {
  const { id, nome, db_schema: schema } = municipio

  log(`📍 ${nome} (schema: ${schema})`)

  try {
    // =========================================================================
    // ETAPA 1: BUSCA DATA INICIAL
    // =========================================================================
    const dataInicial = await buscarDataInicialDoMunicipio(schema)
    if (dataInicial) {
      log(`  Data inicial: ${dataInicial}`)
    }

    // =========================================================================
    // ETAPA 2: BUSCA EQUIPAMENTOS
    // =========================================================================
    const equipamentos = await buscarEquipamentos(schema)

    if (equipamentos.length === 0) {
      log(`  Nenhum equipamento cadastrado`)
      return { sucesso: true, importados: 0 }
    }

    log(`  ${equipamentos.length} equipamento(s) encontrado(s)`)

    // =========================================================================
    // ETAPA 3: BUSCA FUNCIONÁRIOS
    // =========================================================================
    const mapaFuncionarios = await buscarMapaFuncionarios(schema)
    log(`  ${mapaFuncionarios.size} funcionários mapeados`)

    // =========================================================================
    // ETAPA 4: SINCRONIZA CADA EQUIPAMENTO
    // =========================================================================
    let totalImportados = 0
    let sucessos = 0

    for (const equip of equipamentos) {
      const resultado = await sincronizarEquipamento(municipio, equip, mapaFuncionarios, dataInicial)
      if (resultado.sucesso) sucessos++
      totalImportados += resultado.importados
    }

    log(`  ✅ ${sucessos}/${equipamentos.length} equipamentos, ${totalImportados} novos registros`)
    return { sucesso: true, importados: totalImportados }

  } catch (err) {
    log(`  ❌ ERRO: ${err.message}`)
    return { sucesso: false, importados: 0 }
  }
}

// =============================================================================
// EXECUÇÃO PRINCIPAL
// =============================================================================

/**
 * Executa sincronização de todos os municípios
 *
 * Esta função é chamada periodicamente pelo loop principal.
 * Ela busca todos os municípios ativos e sincroniza cada um.
 */
async function executarSincronizacao() {
  log('─'.repeat(50))
  log('Iniciando sincronização MULTI-TENANT...')

  try {
    // =========================================================================
    // BUSCA TODOS OS MUNICÍPIOS ATIVOS
    // =========================================================================
    const municipios = await buscarMunicipios()

    if (municipios.length === 0) {
      log('Nenhum município cadastrado/ativo')
      return
    }

    log(`${municipios.length} município(s) encontrado(s)`)
    log('')

    // =========================================================================
    // SINCRONIZA CADA MUNICÍPIO
    // =========================================================================
    let totalImportados = 0
    let sucessos = 0

    for (const municipio of municipios) {
      const resultado = await sincronizarMunicipio(municipio)
      if (resultado.sucesso) sucessos++
      totalImportados += resultado.importados
      log('')
    }

    log(`Sincronização concluída: ${sucessos}/${municipios.length} municípios, ${totalImportados} novos registros`)

  } catch (err) {
    log(`ERRO GERAL: ${err.message}`)
  }
}

// =============================================================================
// LOOP PRINCIPAL
// =============================================================================

/**
 * Inicia o serviço de sincronização
 *
 * - Exibe banner inicial com configurações
 * - Executa primeira sincronização imediatamente
 * - Agenda sincronizações periódicas
 */
async function iniciar() {
  // =========================================================================
  // BANNER INICIAL
  // =========================================================================
  console.log('═'.repeat(50))
  console.log('  SERVIÇO DE SINCRONIZAÇÃO REP - MULTI-TENANT')
  console.log('  Intervalo: ' + INTERVALO_SEGUNDOS + ' segundos')
  console.log('═'.repeat(50))

  // =========================================================================
  // PRIMEIRA EXECUÇÃO
  // =========================================================================
  await executarSincronizacao()

  // =========================================================================
  // AGENDAMENTO PERIÓDICO
  // =========================================================================
  setInterval(executarSincronizacao, INTERVALO_SEGUNDOS * 1000)

  log(`Próxima sincronização em ${INTERVALO_SEGUNDOS} segundos...`)
}

// =============================================================================
// TRATAMENTO DE ENCERRAMENTO
// =============================================================================

/**
 * Handler para SIGINT (Ctrl+C)
 * Encerra o pool de conexões antes de sair
 */
process.on('SIGINT', async () => {
  log('Encerrando serviço...')
  await pool.end()
  process.exit(0)
})

/**
 * Handler para SIGTERM (kill)
 * Encerra o pool de conexões antes de sair
 */
process.on('SIGTERM', async () => {
  log('Encerrando serviço...')
  await pool.end()
  process.exit(0)
})

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

// Inicia o serviço
iniciar()
