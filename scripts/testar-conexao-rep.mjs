// testar-conexao-rep.mjs
// Testa várias portas para encontrar o REP
// Uso: node testar-conexao-rep.mjs

const REP_IP = '192.168.0.200'

async function testar(porta, protocolo) {
  const url = `${protocolo}://${REP_IP}:${porta}/login.fcgi`
  console.log(`Testando ${url}...`)
  
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: '12345' }),
      signal: controller.signal
    })
    
    clearTimeout(timeout)
    const text = await response.text()
    console.log(`✅ ${protocolo}:${porta} - Respondeu!`)
    console.log(`   Status: ${response.status}`)
    console.log(`   Resposta: ${text.substring(0, 200)}`)
    return true
  } catch (error) {
    console.log(`❌ ${protocolo}:${porta} - ${error.message}`)
    return false
  }
}

async function run() {
  console.log(`\n🔍 Testando conexão com REP: ${REP_IP}\n`)
  
  // Desabilita verificação SSL
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  
  const testes = [
    [80, 'http'],
    [443, 'https'],
    [8080, 'http'],
    [8443, 'https'],
  ]
  
  for (const [porta, protocolo] of testes) {
    const ok = await testar(porta, protocolo)
    if (ok) {
      console.log(`\n✅ Use: ${protocolo}://${REP_IP}:${porta}`)
      break
    }
    console.log('')
  }
}

run()
