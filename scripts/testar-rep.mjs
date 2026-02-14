// testar-rep.mjs
// Testa conexão com o REP Control iD
// Uso: node testar-rep.mjs

const REP_IP = '192.168.100.100'
const REP_PORTA = 80  // ou 8080
const REP_USUARIO = 'admin'
const REP_SENHA = 'admin'

async function testar() {
  const baseUrl = `http://${REP_IP}:${REP_PORTA}`
  
  console.log(`\n🔌 Testando conexão com REP Control iD`)
  console.log(`   URL: ${baseUrl}\n`)
  
  // 1. Testar conectividade básica
  console.log('1️⃣ Testando conectividade...')
  try {
    const response = await fetch(`${baseUrl}/system_information.fcgi`, { 
      signal: AbortSignal.timeout(5000) 
    })
    const info = await response.json()
    console.log('   ✅ REP respondeu!')
    console.log(`   Modelo: ${info.model || 'N/D'}`)
    console.log(`   Serial: ${info.serial || 'N/D'}`)
    console.log(`   Firmware: ${info.firmware || 'N/D'}`)
  } catch (error) {
    console.log('   ❌ Não foi possível conectar')
    console.log(`   Erro: ${error.message}`)
    console.log('\n   Verifique:')
    console.log('   - O REP está ligado?')
    console.log('   - O IP está correto?')
    console.log('   - Seu PC está na mesma rede (192.168.100.x)?')
    console.log('   - Tente acessar no navegador: http://192.168.100.100')
    return
  }
  
  // 2. Testar login
  console.log('\n2️⃣ Testando login...')
  let session = null
  try {
    const response = await fetch(`${baseUrl}/login.fcgi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: REP_USUARIO, password: REP_SENHA })
    })
    const data = await response.json()
    
    if (data.session) {
      session = data.session
      console.log('   ✅ Login OK!')
    } else {
      console.log('   ❌ Login falhou - verifique usuário/senha')
      console.log('   Tente: admin/admin ou admin/123456')
      return
    }
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`)
    return
  }
  
  // 3. Buscar usuários cadastrados
  console.log('\n3️⃣ Buscando usuários no REP...')
  try {
    const response = await fetch(`${baseUrl}/users.fcgi?session=${session}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    const data = await response.json()
    const usuarios = data.users || []
    console.log(`   ✅ ${usuarios.length} usuários cadastrados`)
    
    if (usuarios.length > 0 && usuarios.length <= 10) {
      console.log('\n   Usuários:')
      usuarios.forEach(u => {
        console.log(`   - ID: ${u.id}, Nome: ${u.name}, PIS: ${u.pis || 'N/D'}`)
      })
    }
  } catch (error) {
    console.log(`   ⚠️ Erro ao buscar usuários: ${error.message}`)
  }
  
  // 4. Buscar últimos registros de ponto
  console.log('\n4️⃣ Buscando últimos registros de ponto...')
  try {
    const response = await fetch(`${baseUrl}/access_logs.fcgi?session=${session}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 10, order: 'desc' })
    })
    const data = await response.json()
    const logs = data.access_logs || []
    console.log(`   ✅ ${logs.length} registros encontrados`)
    
    if (logs.length > 0) {
      console.log('\n   Últimos registros:')
      logs.slice(0, 5).forEach(log => {
        const data = new Date(log.time * 1000).toLocaleString('pt-BR')
        const evento = log.event === 7 ? 'ENTRADA' : log.event === 8 ? 'SAÍDA' : `EVT-${log.event}`
        console.log(`   - ${data} | User: ${log.user_id} | ${evento}`)
      })
    }
  } catch (error) {
    console.log(`   ⚠️ Erro ao buscar logs: ${error.message}`)
  }
  
  // 5. Logout
  try {
    await fetch(`${baseUrl}/logout.fcgi?session=${session}`)
  } catch {}
  
  console.log('\n✅ Teste concluído!')
  console.log('\n📝 Próximo passo: Acessar /equipamentos no sistema para configurar a sincronização')
}

testar().catch(console.error)
