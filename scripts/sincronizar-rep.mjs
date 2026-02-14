// sincronizar-rep.mjs
// Sincroniza funcionários do sistema com o REP Control iD
// Uso: node --insecure-http-parser sincronizar-rep.mjs

import pg from 'pg'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const REP_IP = '192.168.0.200'
const REP_USUARIO = 'admin'
const REP_SENHA = '12345'

// Renovar sessão a cada N funcionários
const RENOVAR_SESSAO_A_CADA = 50

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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

async function login() {
  try {
    const data = await httpsRequest('/login.fcgi', 'POST', { login: REP_USUARIO, password: REP_SENHA })
    if (data.session) { return data.session }
    return null
  } catch (error) { console.error('Erro login:', error.message); return null }
}

async function buscarUsuariosREP(session) {
  try {
    const data = await httpsRequest(`/load_users.fcgi?session=${session}`, 'POST', { limit: 10000 })
    return data.users || []
  } catch { return [] }
}

async function adicionarUsuarioREP(session, usuario) {
  try {
    const data = await httpsRequest(`/add_users.fcgi?session=${session}`, 'POST', { users: [usuario] })
    return data.error ? { ok: false, error: data.error } : { ok: true }
  } catch (error) { return { ok: false, error: error.message } }
}

async function run() {
  const client = await pool.connect()
  try {
    console.log('\n=== SINCRONIZACAO COM REP ===\n')
    console.log(`REP: https://${REP_IP}`)

    let session = await login()
    if (!session) { console.log('Falha no login!'); return }
    console.log('Login OK!\n')

    // Buscar usuários já no REP
    console.log('Buscando usuarios no REP...')
    const usuariosREP = await buscarUsuariosREP(session)
    const pisNoREP = new Set(usuariosREP.map(u => String(u.pis)))
    console.log(`${usuariosREP.length} usuarios no REP\n`)

    // Buscar funcionários do sistema
    console.log('Buscando funcionarios do sistema...')
    const result = await client.query(`SELECT id, nome, cpf, pis, matricula FROM santo_andre.funcionarios WHERE ativo = true ORDER BY nome`)
    const funcionarios = result.rows
    console.log(`${funcionarios.length} funcionarios ativos\n`)

    let adicionados = 0, existentes = 0, erros = 0, processados = 0

    for (const func of funcionarios) {
      // Renovar sessão periodicamente
      processados++
      if (processados % RENOVAR_SESSAO_A_CADA === 0) {
        session = await login()
        if (!session) { console.log('\nFalha ao renovar sessão!'); break }
      }

      const cpf = func.cpf?.replace(/\D/g, '') || ''
      let pis = func.pis?.replace(/\D/g, '') || ''
      if (!pis && cpf) pis = cpf.padStart(11, '0')
      if (!pis) { erros++; continue }

      pis = pis.padStart(11, '0').substring(0, 11)

      // Verificar se já existe no REP
      if (pisNoREP.has(pis)) {
        existentes++
        continue
      }

      const pisNum = parseInt(pis)
      const matriculaNum = parseInt(func.matricula?.replace(/\D/g, '') || String(func.id)) || func.id
      const nome = func.nome.substring(0, 50).toUpperCase()

      const res = await adicionarUsuarioREP(session, {
        name: nome,
        pis: pisNum,
        code: matriculaNum
      })

      if (res.ok) {
        console.log(`[+] ${nome} (Mat: ${matriculaNum})`)
        adicionados++
      } else {
        console.log(`[ERRO] ${nome}: ${res.error}`)
        erros++
      }

      await new Promise(r => setTimeout(r, 30))
    }

    console.log('\n=== RESUMO ===')
    console.log(`Adicionados: ${adicionados}`)
    console.log(`Já existiam: ${existentes}`)
    console.log(`Erros: ${erros}`)

    try { await httpsRequest(`/logout.fcgi?session=${session}`, 'POST') } catch {}
  } catch (error) { console.error('Erro:', error.message) }
  finally { client.release(); await pool.end() }
}

run()
