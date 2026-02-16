// scripts/debug-rep.mjs
// Debug: Explorar dados do REP Control iD

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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function main() {
  console.log('=== DEBUG REP ===\n')

  // Login
  const loginRes = await httpsRequest('/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
  if (!loginRes.session) {
    console.log('Erro no login:', loginRes)
    return
  }
  const session = loginRes.session
  console.log('Login OK!\n')

  // 1. load_users sem limit
  console.log('1. load_users (sem limit):')
  let res = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', {})
  console.log('   Resposta:', JSON.stringify(res).substring(0, 200))
  console.log('   Total:', res.users?.length || 0)

  // 2. load_users com limit
  console.log('\n2. load_users (limit=10000):')
  res = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', { limit: 10000 })
  console.log('   Resposta:', JSON.stringify(res).substring(0, 200))
  console.log('   Total:', res.users?.length || 0)

  // 3. load_objects users
  console.log('\n3. load_objects (object=users):')
  res = await httpsRequest('/load_objects.fcgi?session=' + session, 'POST', { object: 'users' })
  console.log('   Resposta:', JSON.stringify(res).substring(0, 200))

  // 4. Buscar por nome específico
  console.log('\n4. load_users com where:')
  res = await httpsRequest('/load_users.fcgi?session=' + session, 'POST', {
    limit: 100,
    where: { name: { like: '%LUIZ%' } }
  })
  console.log('   Resposta:', JSON.stringify(res).substring(0, 500))

  // 5. Informações do sistema
  console.log('\n5. get_system_information:')
  res = await httpsRequest('/get_system_information.fcgi?session=' + session, 'POST', {})
  console.log('   Resposta:', JSON.stringify(res, null, 2))

  // 6. Tentar listar templates
  console.log('\n6. load_templates:')
  res = await httpsRequest('/load_templates.fcgi?session=' + session, 'POST', { limit: 10 })
  console.log('   Resposta:', JSON.stringify(res).substring(0, 300))

  // 7. Tentar listar cards
  console.log('\n7. load_cards:')
  res = await httpsRequest('/load_cards.fcgi?session=' + session, 'POST', { limit: 10 })
  console.log('   Resposta:', JSON.stringify(res).substring(0, 300))

  // 8. Verificar quantidades
  console.log('\n8. get_quantity_info:')
  res = await httpsRequest('/get_quantity_info.fcgi?session=' + session, 'POST', {})
  console.log('   Resposta:', JSON.stringify(res, null, 2))
}

main().catch(console.error)
