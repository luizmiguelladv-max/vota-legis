// buscar-afd-rep.mjs
// Busca registros AFD (batidas de ponto) do REP Control iD
// Uso: node --insecure-http-parser scripts/buscar-afd-rep.mjs [DATA_INICIAL]
// Exemplo: node --insecure-http-parser scripts/buscar-afd-rep.mjs 2024-12-01

import pg from 'pg'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

// Configurações do REP
const REP_IP = '192.168.0.200'
const REP_USUARIO = 'admin'
const REP_SENHA = '12345'

// Data inicial passada como argumento ou do .env
const DATA_INICIAL = process.argv[2] || process.env.DATA_INICIAL_REGISTROS || null

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

function httpsRequest(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : ''
    const options = {
      hostname: REP_IP,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString)
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

async function login() {
  console.log(`Conectando ao REP: https://${REP_IP}`)
  try {
    const data = await httpsRequest('/login.fcgi', 'POST', { login: REP_USUARIO, password: REP_SENHA })
    if (data.session) {
      console.log('Login OK!')
      return data.session
    }
    console.log('Login falhou:', data)
    return null
  } catch (error) {
    console.error('Erro no login:', error.message)
    return null
  }
}

async function buscarAFD(session) {
  console.log('\nBuscando registros AFD do REP...')

  try {
    // Busca AFD completo sem parâmetros (filtragem feita depois)
    const data = await httpsRequest(`/get_afd.fcgi?session=${session}`, 'POST', {})

    if (typeof data === 'string') {
      // AFD vem como texto formatado (Portaria 1510/671)
      return parseAFD(data)
    } else if (data.records) {
      return data.records
    } else if (data.error) {
      console.error('Erro do REP:', data.error)
      return []
    }

    return []
  } catch (error) {
    console.error('Erro ao buscar AFD:', error.message)
    return []
  }
}

// Parse do arquivo AFD (formato Portaria 671/1510)
function parseAFD(afdText) {
  const lines = afdText.split('\n').filter(l => l.trim())
  const registros = []

  for (const line of lines) {
    // Tipo 3 = Registro de ponto (batida)
    // Formato: NSR(9) + Tipo(1) + Data(8 DDMMAAAA) + Hora(4 HHMM) + PIS(12)
    if (line.length >= 34 && line.charAt(9) === '3') {
      const nsr = line.substring(0, 9)
      const data = line.substring(10, 18) // DDMMAAAA
      const hora = line.substring(18, 22) // HHMM
      const pis = line.substring(22, 34).trim()

      const dia = data.substring(0, 2)
      const mes = data.substring(2, 4)
      const ano = data.substring(4, 8)
      const hh = hora.substring(0, 2)
      const mm = hora.substring(2, 4)

      // Adiciona timezone de Brasília (-03:00) para salvar corretamente no banco
      const dataHora = new Date(`${ano}-${mes}-${dia}T${hh}:${mm}:00-03:00`)

      registros.push({
        nsr,
        dataHora,
        pis,
        dataStr: `${dia}/${mes}/${ano}`,
        horaStr: `${hh}:${mm}`
      })
    }
  }

  return registros
}

async function importarRegistros(registros) {
  const client = await pool.connect()
  let importados = 0
  let duplicados = 0
  let erros = 0
  let ignorados = 0

  console.log(`\nProcessando ${registros.length} registros...`)

  for (const reg of registros) {
    try {
      // Filtra por data inicial
      if (DATA_INICIAL) {
        const dataReg = reg.dataHora.toISOString().split('T')[0]
        if (dataReg < DATA_INICIAL) {
          ignorados++
          continue
        }
      }

      // Busca funcionário pelo PIS (várias formas de comparação)
      const pisLimpo = reg.pis.replace(/^0+/, '') || reg.pis
      const pis11 = pisLimpo.padStart(11, '0') // PIS padrão com 11 dígitos
      const funcResult = await client.query(
        `SELECT id FROM santo_andre.funcionarios WHERE pis = $1 OR pis = $2 OR pis = $3 LIMIT 1`,
        [reg.pis, pisLimpo, pis11]
      )

      if (funcResult.rows.length === 0) {
        console.log(`[SKIP] PIS ${reg.pis} não encontrado no sistema`)
        erros++
        continue
      }

      const funcionarioId = funcResult.rows[0].id

      // Verifica duplicidade
      const dupResult = await client.query(
        `SELECT id FROM santo_andre.registros_ponto
         WHERE funcionario_id = $1 AND nsr = $2 LIMIT 1`,
        [funcionarioId, reg.nsr]
      )

      if (dupResult.rows.length > 0) {
        duplicados++
        continue
      }

      // Busca última batida do funcionário para determinar entrada/saída
      // (funciona para plantões que atravessam a meia-noite)
      const ultimaBatidaResult = await client.query(
        `SELECT sentido FROM santo_andre.registros_ponto
         WHERE funcionario_id = $1
         ORDER BY data_hora DESC LIMIT 1`,
        [funcionarioId]
      )

      // Se não tem batida anterior ou última foi SAÍDA → ENTRADA
      // Se última foi ENTRADA → SAÍDA
      const ultimoSentido = ultimaBatidaResult.rows[0]?.sentido
      const sentido = (!ultimoSentido || ultimoSentido === 'SAIDA') ? 'ENTRADA' : 'SAIDA'

      // Insere registro
      await client.query(
        `INSERT INTO santo_andre.registros_ponto
         (funcionario_id, data_hora, sentido, tipo, origem, nsr, pis, created_at)
         VALUES ($1, $2, $3, 'ORIGINAL', 'AFD_REP', $4, $5, NOW())`,
        [funcionarioId, reg.dataHora, sentido, reg.nsr, reg.pis]
      )

      importados++
      console.log(`[OK] ${reg.dataStr} ${reg.horaStr} - PIS ${reg.pis} - ${sentido}`)

    } catch (err) {
      console.error(`[ERRO] ${reg.dataStr} ${reg.horaStr}:`, err.message)
      erros++
    }
  }

  client.release()

  return { importados, duplicados, erros, ignorados }
}

async function run() {
  console.log('=== IMPORTAÇÃO DE AFD DO REP ===\n')

  if (DATA_INICIAL) {
    console.log(`Data inicial configurada: ${DATA_INICIAL}`)
    console.log('Registros anteriores a esta data serão ignorados.\n')
  } else {
    console.log('AVISO: Nenhuma data inicial configurada.')
    console.log('Todos os registros serão importados.\n')
  }

  const session = await login()
  if (!session) {
    console.error('Falha no login. Abortando.')
    await pool.end()
    return
  }

  const registros = await buscarAFD(session)
  console.log(`\n${registros.length} registros encontrados no AFD`)

  if (registros.length > 0) {
    const resultado = await importarRegistros(registros)

    console.log('\n=== RESUMO ===')
    console.log(`Importados: ${resultado.importados}`)
    console.log(`Duplicados (ignorados): ${resultado.duplicados}`)
    console.log(`Anteriores à data inicial: ${resultado.ignorados}`)
    console.log(`Erros: ${resultado.erros}`)
  }

  // Logout
  try {
    await httpsRequest(`/logout.fcgi?session=${session}`, 'POST')
  } catch {}

  await pool.end()
  console.log('\nFinalizado!')
}

run().catch(err => {
  console.error('Erro fatal:', err)
  pool.end()
})
