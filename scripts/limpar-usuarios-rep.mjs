// scripts/limpar-usuarios-rep.mjs
// Apaga todos os usuários do REP Control iD

import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const REP_IP = '192.168.0.200'
const REP_USER = 'admin'
const REP_PASS = '12345'

// Renovar sessão a cada N operações
const RENOVAR_A_CADA = 30

const agent = new https.Agent({ rejectUnauthorized: false })

function httpsRequest(path, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : ''
    const options = {
      hostname: REP_IP,
      port: 443,
      path: path,
      method: method,
      agent: agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function login() {
  const loginRes = await httpsRequest('/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
  return loginRes.session || null
}

async function main() {
  console.log('=== LIMPEZA DE USUÁRIOS DO REP ===\n')

  let session = await login()
  if (!session) {
    console.log('Erro no login!')
    return
  }
  console.log('Login OK!\n')

  // Buscar usuários com limit alto
  console.log('Buscando lista de usuários...')
  let usersRes = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', { limit: 10000 })

  if (!usersRes.users || usersRes.users.length === 0) {
    console.log('Nenhum usuário encontrado no REP.')
    return
  }

  console.log(`Encontrados ${usersRes.users.length} usuários. Apagando...`)

  let deleted = 0
  let errors = 0

  for (let i = 0; i < usersRes.users.length; i++) {
    const user = usersRes.users[i]

    // Renovar sessão periodicamente
    if (i > 0 && i % RENOVAR_A_CADA === 0) {
      session = await login()
      if (!session) {
        console.log('\nFalha ao renovar sessão!')
        break
      }
    }

    // Usar remove_users com id
    let delRes = await httpsRequest('/remove_users.fcgi?session=' + session, 'POST', {
      users: [{ id: user.id }]
    })

    if (delRes.error) {
      // Tentar por PIS
      delRes = await httpsRequest('/remove_users.fcgi?session=' + session, 'POST', {
        users: [{ pis: user.pis }]
      })
    }

    if (delRes.error) {
      errors++
    } else {
      deleted++
    }

    process.stdout.write(`\rProgresso: ${i + 1}/${usersRes.users.length} (${deleted} apagados, ${errors} erros)`)
    await new Promise(r => setTimeout(r, 50))
  }

  console.log('\n')

  // Verificar quantos usuários restaram
  session = await login()
  if (session) {
    const checkRes = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', { limit: 10000 })
    console.log('Usuários restantes no REP:', checkRes.users?.length || 0)
  }

  console.log('\n✅ Limpeza concluída!')
  console.log(`Resultado final: ${deleted} apagados, ${errors} erros`)
}

main().catch(console.error)
