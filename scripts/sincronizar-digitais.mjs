// scripts/sincronizar-digitais.mjs
// Sincroniza digitais entre REP e banco de dados
// Uso: node --insecure-http-parser scripts/sincronizar-digitais.mjs

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

function httpsRequest(ip, path, method, body = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : ''
    const options = {
      hostname: ip,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false,
      timeout: 30000,
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

async function sincronizarDigitais() {
  console.log('='.repeat(50))
  console.log('SINCRONIZAR DIGITAIS REP <-> BANCO')
  console.log('='.repeat(50))

  const client = await pool.connect()

  try {
    // 1. Login no REP
    console.log('\n[1] Conectando ao REP...')
    const loginData = await httpsRequest(REP_IP, '/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
    if (!loginData.session) {
      throw new Error('Falha no login do REP')
    }
    console.log('    ✅ Conectado ao REP')
    const session = loginData.session

    // 2. Carregar todos os templates do REP
    console.log('\n[2] Carregando templates de digitais do REP...')
    let todosTemplates = []
    let offset = 0
    const limit = 100

    while (true) {
      const tplData = await httpsRequest(REP_IP, `/load_templates.fcgi?session=${session}`, 'POST', { limit, offset })

      if (tplData.error) {
        console.log('    ⚠️ Erro ao carregar templates:', tplData.error)
        break
      }

      if (!tplData.templates || tplData.templates.length === 0) break
      todosTemplates = todosTemplates.concat(tplData.templates)
      console.log(`    Carregados ${todosTemplates.length} templates...`)
      if (tplData.templates.length < limit) break
      offset += limit
    }

    if (todosTemplates.length === 0) {
      console.log('    ⚠️ Nenhum template encontrado no REP')
      return
    }
    console.log(`    ✅ ${todosTemplates.length} templates no REP`)

    // 3. Carregar funcionários do banco para mapear PIS -> ID
    console.log('\n[3] Carregando funcionários do banco...')
    const funcResult = await client.query('SELECT id, nome, pis FROM santo_andre.funcionarios WHERE ativo = true')
    const funcionariosDb = funcResult.rows
    console.log(`    ✅ ${funcionariosDb.length} funcionários no banco`)

    // Criar mapa PIS -> funcionario_id
    const pisFuncionarioMap = new Map()
    for (const f of funcionariosDb) {
      if (f.pis) {
        const pisLimpo = f.pis.replace(/\D/g, '')
        pisFuncionarioMap.set(pisLimpo, f.id)
        pisFuncionarioMap.set(parseInt(pisLimpo), f.id)
      }
    }

    // 4. Salvar templates no banco
    console.log('\n[4] Salvando templates no banco...')
    let salvos = 0
    let naoEncontrados = 0
    let erros = 0

    for (const tpl of todosTemplates) {
      // O template tem user_id que é o PIS
      const pisUsuario = String(tpl.user_id || tpl.pis || '')
      const funcionarioId = pisFuncionarioMap.get(pisUsuario) || pisFuncionarioMap.get(parseInt(pisUsuario))

      if (!funcionarioId) {
        naoEncontrados++
        continue
      }

      try {
        await client.query(`
          INSERT INTO santo_andre.funcionarios_digitais
          (funcionario_id, finger_type, template, created_at, updated_at)
          VALUES ($1, $2, $3, NOW(), NOW())
          ON CONFLICT (funcionario_id, finger_type)
          DO UPDATE SET template = $3, updated_at = NOW()
        `, [funcionarioId, tpl.finger_type || 0, tpl.template])
        salvos++
      } catch (err) {
        console.log(`    ❌ Erro ao salvar template: ${err.message}`)
        erros++
      }
    }

    // 5. Resumo
    console.log('\n' + '='.repeat(50))
    console.log('RESUMO')
    console.log('='.repeat(50))
    console.log(`Templates no REP: ${todosTemplates.length}`)
    console.log(`Salvos no banco: ${salvos}`)
    console.log(`Funcionários não encontrados: ${naoEncontrados}`)
    console.log(`Erros: ${erros}`)

    // Conta total no banco
    const countResult = await client.query('SELECT COUNT(*) as total FROM santo_andre.funcionarios_digitais')
    console.log(`\nTotal de digitais no banco agora: ${countResult.rows[0].total}`)

  } catch (err) {
    console.error('ERRO:', err.message)
  } finally {
    client.release()
    pool.end()
  }
}

sincronizarDigitais()
