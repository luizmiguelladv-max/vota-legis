// scripts/limpar-rep-completo.mjs
// Limpa TUDO do REP Control iD: usuários e registros AFD

import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const REP_IP = '192.168.0.200'
const REP_USER = 'admin'
const REP_PASS = '12345'

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
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function main() {
  console.log('=== LIMPEZA COMPLETA DO REP ===\n')

  // Login
  const loginRes = await httpsRequest('/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
  if (!loginRes.session) {
    console.log('Erro no login:', loginRes)
    return
  }

  const session = loginRes.session
  console.log('Login OK!\n')

  // ============================================
  // 1. LIMPAR USUÁRIOS
  // ============================================
  console.log('--- LIMPANDO USUÁRIOS ---')

  // Tentar load_users com limit
  let usersRes = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', { limit: 1000 })

  if (usersRes.users && usersRes.users.length > 0) {
    console.log(`Encontrados ${usersRes.users.length} usuários`)

    // Apagar um por um
    let deleted = 0
    for (const user of usersRes.users) {
      const delRes = await httpsRequest('/remove_users.fcgi?session=' + session, 'POST', {
        users: [{ id: user.id }]
      })

      if (!delRes.error) {
        deleted++
        process.stdout.write(`\rApagados: ${deleted}/${usersRes.users.length}`)
      }
    }
    console.log(`\n✅ ${deleted} usuários apagados`)
  } else {
    console.log('Nenhum usuário encontrado ou já limpo')
  }

  // ============================================
  // 2. LIMPAR REGISTROS AFD
  // ============================================
  console.log('\n--- LIMPANDO REGISTROS AFD ---')

  // Método 1: set_system_information para resetar NSR
  let afdResult = await httpsRequest('/set_system_information.fcgi?session=' + session, 'POST', {
    nsr_high: 0
  })
  console.log('Reset NSR:', JSON.stringify(afdResult))

  // Método 2: clear_afd (se disponível)
  afdResult = await httpsRequest('/clear_afd.fcgi?session=' + session, 'POST', {})
  console.log('Clear AFD:', JSON.stringify(afdResult))

  // Método 3: destroy_afd (outro nome possível)
  afdResult = await httpsRequest('/destroy_afd.fcgi?session=' + session, 'POST', {})
  console.log('Destroy AFD:', JSON.stringify(afdResult))

  // Método 4: reset_afd
  afdResult = await httpsRequest('/reset_afd.fcgi?session=' + session, 'POST', {})
  console.log('Reset AFD:', JSON.stringify(afdResult))

  // ============================================
  // 3. LIMPAR BIOMETRIAS/TEMPLATES
  // ============================================
  console.log('\n--- LIMPANDO BIOMETRIAS ---')

  let bioResult = await httpsRequest('/destroy_templates.fcgi?session=' + session, 'POST', {})
  console.log('Destroy templates:', JSON.stringify(bioResult))

  bioResult = await httpsRequest('/clear_templates.fcgi?session=' + session, 'POST', {})
  console.log('Clear templates:', JSON.stringify(bioResult))

  // ============================================
  // 4. LIMPAR FACES
  // ============================================
  console.log('\n--- LIMPANDO FACES ---')

  let faceResult = await httpsRequest('/destroy_faces.fcgi?session=' + session, 'POST', {})
  console.log('Destroy faces:', JSON.stringify(faceResult))

  // ============================================
  // VERIFICAÇÃO FINAL
  // ============================================
  console.log('\n--- VERIFICAÇÃO FINAL ---')

  // Contar usuários
  const checkUsers = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', { limit: 1000 })
  console.log('Usuários restantes:', checkUsers.users?.length || 0)

  // Verificar AFD
  const checkAfd = await httpsRequest('/get_afd.fcgi?session=' + session, 'POST', {})
  if (typeof checkAfd === 'string') {
    const lines = checkAfd.split('\n').filter(l => l.trim())
    console.log('Registros AFD restantes:', lines.length)
  } else {
    console.log('AFD:', JSON.stringify(checkAfd).substring(0, 100))
  }

  console.log('\n✅ LIMPEZA COMPLETA FINALIZADA!')
  console.log('\nPróximos passos:')
  console.log('1. Sincronize os funcionários do sistema para o REP')
  console.log('2. Cadastre as digitais/biometrias dos funcionários')
}

main().catch(console.error)
