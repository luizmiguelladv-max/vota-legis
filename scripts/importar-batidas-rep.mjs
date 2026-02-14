// scripts/importar-batidas-rep.mjs
// Importa registros de ponto (batidas) do REP para o banco
// Uso: node --insecure-http-parser scripts/importar-batidas-rep.mjs

import https from 'https'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false }
})

const REP_IP = '192.168.0.200'
const REP_USER = 'admin'
const REP_PASS = '12345'
const EQUIPAMENTO_ID = 5 // ID do REP no banco

function httpsRequest(ip, path, method, body = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : ''
    const options = {
      hostname: ip,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString)
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

// Parse do formato AFD (Portaria 1510/671)
// Tipo 3: Marcação de ponto
// Formato: NSR(9) + Tipo(1) + Data(8 ddmmaaaa) + Hora(4 hhmm) + PIS(12)
function parseAFD(afdData) {
  const registros = []
  const linhas = afdData.split('\n').filter(l => l.trim())

  for (const linha of linhas) {
    if (linha.length < 34) continue

    const nsr = linha.substring(0, 9).trim()
    const tipo = linha.substring(9, 10)

    // Tipo 3 = Marcação de ponto
    if (tipo === '3') {
      const dataDDMMAAAA = linha.substring(10, 18)
      const horaHHMM = linha.substring(18, 22)
      const pis = linha.substring(22, 34).trim()

      const dia = dataDDMMAAAA.substring(0, 2)
      const mes = dataDDMMAAAA.substring(2, 4)
      const ano = dataDDMMAAAA.substring(4, 8)
      const hora = horaHHMM.substring(0, 2)
      const minuto = horaHHMM.substring(2, 4)

      const dataHora = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:00`)

      if (!isNaN(dataHora.getTime())) {
        registros.push({
          nsr,
          dataHora,
          pis: pis.replace(/^0+/, '') || pis // Remove zeros à esquerda mas mantém pelo menos 1
        })
      }
    }
  }

  return registros
}

async function importarBatidas() {
  console.log('='.repeat(60))
  console.log('IMPORTAR BATIDAS DO REP')
  console.log('='.repeat(60))

  const client = await pool.connect()

  try {
    // 1. Login no REP
    console.log('\n[1] Conectando ao REP...')
    const loginData = await httpsRequest(REP_IP, '/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
    const loginJson = JSON.parse(loginData)
    if (!loginJson.session) {
      throw new Error('Falha no login do REP')
    }
    console.log('    ✅ Conectado ao REP')
    const session = loginJson.session

    // 2. Buscar AFD do REP
    console.log('\n[2] Buscando registros AFD do REP...')
    const afdData = await httpsRequest(REP_IP, `/get_afd.fcgi?session=${session}`, 'POST', {})

    if (!afdData || afdData.includes('error')) {
      console.log('    ⚠️ Erro ao buscar AFD:', afdData)
      return
    }

    const registros = parseAFD(afdData)
    console.log(`    ✅ ${registros.length} registros encontrados no AFD`)

    if (registros.length === 0) {
      console.log('    Nenhum registro para importar')
      return
    }

    // Mostra amostra dos registros
    console.log('\n    Amostra (últimos 5):')
    registros.slice(-5).forEach(r => {
      console.log(`      NSR ${r.nsr}: ${r.dataHora.toLocaleString('pt-BR')} - PIS: ${r.pis}`)
    })

    // 3. Carregar funcionários para mapear PIS -> ID
    console.log('\n[3] Carregando funcionários do banco...')
    const funcResult = await client.query('SELECT id, pis FROM santo_andre.funcionarios WHERE ativo = true')
    const funcionariosDb = funcResult.rows
    console.log(`    ✅ ${funcionariosDb.length} funcionários`)

    // Mapa PIS -> ID
    const pisFuncionarioMap = new Map()
    for (const f of funcionariosDb) {
      if (f.pis) {
        const pisLimpo = f.pis.replace(/\D/g, '')
        pisFuncionarioMap.set(pisLimpo, f.id)
        pisFuncionarioMap.set(parseInt(pisLimpo), f.id)
        // Também mapeia sem zeros à esquerda
        pisFuncionarioMap.set(pisLimpo.replace(/^0+/, ''), f.id)
      }
    }

    // 4. Buscar NSRs já importados
    console.log('\n[4] Verificando registros já importados...')
    const nsrResult = await client.query('SELECT nsr FROM santo_andre.registros_ponto WHERE nsr IS NOT NULL')
    const nsrsExistentes = new Set(nsrResult.rows.map(r => r.nsr))
    console.log(`    ✅ ${nsrsExistentes.size} registros já existem no banco`)

    // 5. Importar novos registros
    console.log('\n[5] Importando novos registros...')
    let importados = 0
    let jaExistentes = 0
    let semFuncionario = 0
    let erros = 0

    for (const reg of registros) {
      // Pula se já existe
      if (nsrsExistentes.has(reg.nsr)) {
        jaExistentes++
        continue
      }

      // Busca funcionário
      const funcionarioId = pisFuncionarioMap.get(reg.pis) ||
                           pisFuncionarioMap.get(parseInt(reg.pis)) ||
                           pisFuncionarioMap.get(reg.pis.padStart(11, '0'))

      if (!funcionarioId) {
        semFuncionario++
        continue
      }

      try {
        await client.query(`
          INSERT INTO santo_andre.registros_ponto
          (funcionario_id, equipamento_id, data_hora, nsr, pis, tipo, origem, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'BIOMETRIA', 'EQUIPAMENTO', NOW(), NOW())
        `, [funcionarioId, EQUIPAMENTO_ID, reg.dataHora, reg.nsr, reg.pis])
        importados++
      } catch (err) {
        console.log(`    ❌ Erro NSR ${reg.nsr}: ${err.message}`)
        erros++
      }
    }

    // 6. Resumo
    console.log('\n' + '='.repeat(60))
    console.log('RESUMO')
    console.log('='.repeat(60))
    console.log(`Total no AFD: ${registros.length}`)
    console.log(`Já existentes: ${jaExistentes}`)
    console.log(`Importados agora: ${importados}`)
    console.log(`Sem funcionário: ${semFuncionario}`)
    console.log(`Erros: ${erros}`)

    // Conta total no banco
    const countResult = await client.query('SELECT COUNT(*) as total FROM santo_andre.registros_ponto')
    console.log(`\nTotal de registros no banco: ${countResult.rows[0].total}`)

  } catch (err) {
    console.error('ERRO:', err.message)
  } finally {
    client.release()
    pool.end()
  }
}

importarBatidas()
