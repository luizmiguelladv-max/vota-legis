// scripts/verificar-digitais-rep.mjs
// Verifica quais funcionários têm digitais cadastradas no REP
// Uso: node --insecure-http-parser scripts/verificar-digitais-rep.mjs

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

async function verificarDigitais() {
  console.log('='.repeat(60))
  console.log('VERIFICAR DIGITAIS CADASTRADAS NO REP')
  console.log('='.repeat(60))

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

    // 2. Carregar todos os usuários do REP
    console.log('\n[2] Carregando usuários do REP...')
    let todosUsuarios = []
    let offset = 0
    const limit = 100

    while (true) {
      const usersData = await httpsRequest(REP_IP, `/load_users.fcgi?session=${session}`, 'POST', { limit, offset })
      if (!usersData.users || usersData.users.length === 0) break
      todosUsuarios = todosUsuarios.concat(usersData.users)
      if (usersData.users.length < limit) break
      offset += limit
    }
    console.log(`    ✅ ${todosUsuarios.length} usuários no REP`)

    // 3. Filtrar quem tem digital
    const comDigital = todosUsuarios.filter(u => u.templates_count > 0)
    const semDigital = todosUsuarios.filter(u => !u.templates_count || u.templates_count === 0)

    console.log('\n' + '='.repeat(60))
    console.log(`USUÁRIOS COM DIGITAL: ${comDigital.length}`)
    console.log('='.repeat(60))

    if (comDigital.length > 0) {
      console.log('\nNome'.padEnd(45) + 'PIS'.padEnd(15) + 'Digitais')
      console.log('-'.repeat(60))
      for (const u of comDigital) {
        console.log(
          (u.name || '').substring(0, 44).padEnd(45) +
          String(u.pis).padEnd(15) +
          u.templates_count
        )
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`USUÁRIOS SEM DIGITAL: ${semDigital.length}`)
    console.log('='.repeat(60))

    // Mostra apenas os primeiros 20 sem digital
    if (semDigital.length > 0) {
      console.log('\n(Mostrando primeiros 20)')
      console.log('\nNome'.padEnd(45) + 'PIS')
      console.log('-'.repeat(60))
      for (const u of semDigital.slice(0, 20)) {
        console.log(
          (u.name || '').substring(0, 44).padEnd(45) +
          String(u.pis)
        )
      }
      if (semDigital.length > 20) {
        console.log(`\n... e mais ${semDigital.length - 20} usuários sem digital`)
      }
    }

    // 4. Atualiza flag no banco (opcional)
    console.log('\n[3] Atualizando status no banco...')
    let atualizados = 0

    for (const u of comDigital) {
      const pisLimpo = String(u.pis).replace(/\D/g, '').padStart(11, '0')
      try {
        const result = await client.query(
          `UPDATE santo_andre.funcionarios
           SET template_biometrico = 'REP', updated_at = NOW()
           WHERE (pis = $1 OR pis = $2) AND template_biometrico IS NULL`,
          [pisLimpo, String(u.pis)]
        )
        if (result.rowCount > 0) atualizados++
      } catch (e) {
        // ignora erros
      }
    }

    console.log(`    ✅ ${atualizados} funcionários marcados com biometria no banco`)

    // Resumo final
    console.log('\n' + '='.repeat(60))
    console.log('RESUMO')
    console.log('='.repeat(60))
    console.log(`Total no REP: ${todosUsuarios.length}`)
    console.log(`Com digital: ${comDigital.length} (${(comDigital.length / todosUsuarios.length * 100).toFixed(1)}%)`)
    console.log(`Sem digital: ${semDigital.length} (${(semDigital.length / todosUsuarios.length * 100).toFixed(1)}%)`)

    console.log('\n⚠️  NOTA: O modelo iDClass não permite exportar templates de digital.')
    console.log('    As digitais ficam armazenadas apenas no equipamento.')

  } catch (err) {
    console.error('ERRO:', err.message)
  } finally {
    client.release()
    pool.end()
  }
}

verificarDigitais()
