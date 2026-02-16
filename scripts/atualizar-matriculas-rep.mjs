// atualizar-matriculas-rep.mjs
// Atualiza as matrículas dos funcionários já cadastrados no REP
// Uso: node --insecure-http-parser atualizar-matriculas-rep.mjs

import pg from 'pg'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

// ============================================
// CONFIGURAÇÃO DO REP
// ============================================
const REP_IP = '192.168.0.200'
const REP_USUARIO = 'admin'
const REP_SENHA = '12345'

// ============================================

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
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    })
    
    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('Timeout'))
    })
    
    if (bodyString) {
      req.write(bodyString)
    }
    req.end()
  })
}

async function login() {
  console.log(`🔌 Conectando ao REP: https://${REP_IP}`)
  
  try {
    const data = await httpsRequest('/login.fcgi', 'POST', {
      login: REP_USUARIO,
      password: REP_SENHA
    })
    
    if (data.session) {
      console.log('✅ Login OK!')
      return data.session
    } else {
      console.log('❌ Login falhou')
      return null
    }
  } catch (error) {
    console.error('❌ Erro ao conectar:', error.message)
    return null
  }
}

async function atualizarUsuarioREP(session, usuario) {
  try {
    // Endpoint: update_users.fcgi
    const data = await httpsRequest(`/update_users.fcgi?session=${session}`, 'POST', {
      users: [usuario]
    })
    if (data.error) {
      return { ok: false, error: data.error }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function run() {
  const client = await pool.connect()
  
  try {
    console.log('\n📝 ATUALIZAÇÃO DE MATRÍCULAS NO REP\n')
    
    const session = await login()
    if (!session) return
    
    // Buscar funcionários do sistema
    console.log('\n📋 Buscando funcionários do sistema...')
    const result = await client.query(`
      SELECT id, nome, cpf, pis, matricula
      FROM santo_andre.funcionarios 
      WHERE ativo = true
      ORDER BY nome
    `)
    const funcionarios = result.rows
    console.log(`   ${funcionarios.length} funcionários`)
    
    console.log('\n🔄 Atualizando matrículas...\n')
    let atualizados = 0
    let erros = 0
    
    for (const func of funcionarios) {
      const cpf = func.cpf?.replace(/\D/g, '') || ''
      let pis = func.pis?.replace(/\D/g, '') || ''
      
      if (!pis && cpf) {
        pis = cpf.padStart(11, '0')
      }
      
      if (!pis) continue
      
      pis = pis.padStart(11, '0').substring(0, 11)
      
      // Matrícula como código numérico
      const matriculaNum = func.matricula?.replace(/\D/g, '') || String(func.id)
      
      const usuario = {
        pis: parseInt(pis),  // Identifica o usuário pelo PIS
        code: parseInt(matriculaNum) || func.id  // Atualiza o código/matrícula
      }
      
      const resultado = await atualizarUsuarioREP(session, usuario)
      
      if (resultado.ok) {
        console.log(`   ✅ ${func.nome} → Matrícula: ${matriculaNum}`)
        atualizados++
      } else {
        console.log(`   ❌ ${func.nome}: ${resultado.error}`)
        erros++
      }
      
      await new Promise(r => setTimeout(r, 50))
    }
    
    console.log('\n' + '='.repeat(50))
    console.log('📊 RESUMO')
    console.log('='.repeat(50))
    console.log(`   Atualizados: ${atualizados}`)
    console.log(`   Erros:       ${erros}`)
    console.log('='.repeat(50))
    
    try {
      await httpsRequest(`/logout.fcgi?session=${session}`, 'POST')
    } catch {}
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
