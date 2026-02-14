// scripts/importar-do-rep.mjs
// Importa usuários cadastrados no REP que não existem no banco
// Uso: node --insecure-http-parser scripts/importar-do-rep.mjs

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
const LOTACAO_GENERICA_ID = 17 // Criada pelo script criar-lotacao-generica.mjs

function httpsRequest(ip, path, method, body = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : ''
    const options = {
      hostname: ip,
      port: 443,
      path: path,
      method: method,
      rejectUnauthorized: false,
      timeout: 10000,
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

async function importarDoRep() {
  console.log('='.repeat(50))
  console.log('IMPORTAR USUÁRIOS DO REP PARA O BANCO')
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

    // 2. Carregar usuários do REP (em lotes de 100)
    console.log('\n[2] Carregando usuários do REP...')
    let todosUsuariosRep = []
    let offset = 0
    const limit = 100

    while (true) {
      const usersData = await httpsRequest(REP_IP, `/load_users.fcgi?session=${loginData.session}`, 'POST', { limit, offset })
      if (!usersData.users || usersData.users.length === 0) break
      todosUsuariosRep = todosUsuariosRep.concat(usersData.users)
      console.log(`    Carregados ${todosUsuariosRep.length} usuários...`)
      if (usersData.users.length < limit) break
      offset += limit
    }

    if (todosUsuariosRep.length === 0) {
      console.log('    ⚠️  Nenhum usuário encontrado no REP')
      return
    }
    console.log(`    ✅ ${todosUsuariosRep.length} usuários no REP`)

    // 3. Carregar funcionários do banco
    console.log('\n[3] Carregando funcionários do banco...')
    const funcResult = await client.query('SELECT id, nome, cpf, pis, matricula FROM santo_andre.funcionarios')
    const funcionariosDb = funcResult.rows
    console.log(`    ✅ ${funcionariosDb.length} funcionários no banco`)

    // Criar sets para busca rápida
    const pisNoBanco = new Set(funcionariosDb.map(f => f.pis?.replace(/\D/g, '').padStart(11, '0')).filter(Boolean))
    const nomesNoBanco = new Set(funcionariosDb.map(f => f.nome?.toUpperCase().trim()).filter(Boolean))

    // 4. Encontrar usuários no REP que não estão no banco
    console.log('\n[4] Comparando listas...')
    const novosUsuarios = []

    for (const uRep of todosUsuariosRep) {
      const pisRep = String(uRep.pis || '').replace(/\D/g, '').padStart(11, '0')
      const nomeRep = (uRep.name || '').toUpperCase().trim()

      // Pula se já existe por PIS ou nome exato
      if (pisNoBanco.has(pisRep)) continue
      if (nomesNoBanco.has(nomeRep)) continue

      // Pula usuários sem nome
      if (!nomeRep || nomeRep.length < 3) continue

      novosUsuarios.push({
        nome: uRep.name,
        pis: pisRep,
        registration: uRep.registration || uRep.id
      })
    }

    if (novosUsuarios.length === 0) {
      console.log('    ✅ Nenhum usuário novo para importar')
      return
    }

    console.log(`    📋 ${novosUsuarios.length} usuários novos encontrados:`)
    novosUsuarios.forEach((u, i) => console.log(`       ${i + 1}. ${u.nome} (PIS: ${u.pis})`))

    // 5. Importar usuários novos
    console.log('\n[5] Importando para o banco...')
    let importados = 0
    let erros = 0

    for (const usuario of novosUsuarios) {
      try {
        // Gera CPF fictício sequencial se PIS começar com zeros
        let cpf = usuario.pis
        if (cpf.startsWith('00000')) {
          const maxCpf = await client.query(`
            SELECT MAX(CAST(cpf AS BIGINT)) as max_cpf
            FROM santo_andre.funcionarios
            WHERE cpf ~ '^[0-9]+$' AND cpf LIKE '00000%'
          `)
          const nextCpf = (parseInt(maxCpf.rows[0]?.max_cpf || '0') + 1).toString().padStart(11, '0')
          cpf = nextCpf
        }

        // Gera matrícula sequencial
        const maxMatricula = await client.query(`
          SELECT MAX(CAST(matricula AS INTEGER)) as max_mat
          FROM santo_andre.funcionarios
          WHERE matricula ~ '^[0-9]+$'
        `)
        const nextMatricula = (parseInt(maxMatricula.rows[0]?.max_mat || '0') + 1).toString().padStart(7, '0')

        await client.query(`
          INSERT INTO santo_andre.funcionarios
          (matricula, cpf, pis, nome, lotacao_id, data_admissao, ativo, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), true, NOW(), NOW())
        `, [nextMatricula, cpf, usuario.pis, usuario.nome, LOTACAO_GENERICA_ID])

        console.log(`    ✅ ${usuario.nome} (Matrícula: ${nextMatricula})`)
        importados++
      } catch (err) {
        console.log(`    ❌ ${usuario.nome}: ${err.message}`)
        erros++
      }
    }

    // 6. Resumo
    console.log('\n' + '='.repeat(50))
    console.log('RESUMO')
    console.log('='.repeat(50))
    console.log(`Importados: ${importados}`)
    console.log(`Erros: ${erros}`)
    console.log(`Lotação: IMPORTADOS DO REP - PENDENTE ALOCACAO (ID: ${LOTACAO_GENERICA_ID})`)
    console.log('\n⚠️  Os funcionários importados precisam ser alocados nas lotações corretas!')

  } catch (err) {
    console.error('ERRO:', err.message)
  } finally {
    client.release()
    pool.end()
  }
}

importarDoRep()
