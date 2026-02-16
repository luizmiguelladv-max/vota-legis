// limpar-afd-rep.mjs
// Limpa os registros AFD (batidas) do REP Control iD
// ATENÇÃO: Esta operação é IRREVERSÍVEL no REP!
// Uso: node --insecure-http-parser scripts/limpar-afd-rep.mjs

import https from 'https'
import dotenv from 'dotenv'
import readline from 'readline'

dotenv.config()

// Configurações do REP
const REP_IP = '192.168.0.200'
const REP_USUARIO = 'admin'
const REP_SENHA = '12345'

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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

async function login() {
  console.log(`\nConectando ao REP: https://${REP_IP}`)
  try {
    const data = await httpsRequest('/login.fcgi', 'POST', { login: REP_USUARIO, password: REP_SENHA })
    if (data.session) {
      console.log('Login OK!')
      return data.session
    }
    console.log('Login falhou:', data)
    return null
  } catch (error) {
    console.error('Erro no login:', error.message)
    return null
  }
}

async function contarRegistros(session) {
  try {
    // Busca AFD para contar registros
    const data = await httpsRequest(`/get_afd.fcgi?session=${session}`, 'POST', {})

    if (typeof data === 'string') {
      const lines = data.split('\n').filter(l => l.trim() && l.charAt(9) === '3')
      return lines.length
    }
    return 0
  } catch (error) {
    console.error('Erro ao contar registros:', error.message)
    return -1
  }
}

async function limparAFD(session) {
  console.log('\nLimpando registros AFD do REP...')

  try {
    // Método 1: destroy_objects com object=access_logs (mais comum)
    console.log('Tentando método 1: destroy_objects (access_logs)...')
    let result = await httpsRequest(`/destroy_objects.fcgi?session=${session}`, 'POST', {
      object: 'access_logs'
    })
    console.log('Resposta:', JSON.stringify(result))

    if (result && !result.error) {
      console.log('✅ Registros de acesso limpos com sucesso!')
      return true
    }

    // Método 2: destroy_objects com where vazio (todos os registros)
    console.log('Tentando método 2: destroy_objects (access_logs) com where...')
    result = await httpsRequest(`/destroy_objects.fcgi?session=${session}`, 'POST', {
      object: 'access_logs',
      where: {}
    })
    console.log('Resposta:', JSON.stringify(result))

    if (result && !result.error) {
      console.log('✅ Registros limpos com sucesso!')
      return true
    }

    // Método 3: clean_afd.fcgi (alguns modelos mais antigos)
    console.log('Tentando método 3: clean_afd.fcgi...')
    result = await httpsRequest(`/clean_afd.fcgi?session=${session}`, 'POST', {})
    console.log('Resposta:', JSON.stringify(result))

    if (result && !result.error) {
      console.log('✅ Registros AFD limpos com sucesso!')
      return true
    }

    // Método 4: modify_objects zerando o AFD (reset NSR)
    console.log('Tentando método 4: modify_objects (system_afd)...')
    result = await httpsRequest(`/modify_objects.fcgi?session=${session}`, 'POST', {
      object: 'system_afd',
      values: { nsr_beacon: 0 }
    })
    console.log('Resposta:', JSON.stringify(result))

    if (result && !result.error) {
      console.log('✅ NSR resetado com sucesso!')
      return true
    }

    // Método 5: Deletar cada registro individualmente
    console.log('Tentando método 5: deletar registros individualmente...')
    result = await httpsRequest(`/load_objects.fcgi?session=${session}`, 'POST', {
      object: 'access_logs',
      limit: 1000
    })

    if (result && result.access_logs && result.access_logs.length > 0) {
      console.log(`Encontrados ${result.access_logs.length} registros para deletar...`)

      for (const log of result.access_logs) {
        if (log.id) {
          await httpsRequest(`/destroy_objects.fcgi?session=${session}`, 'POST', {
            object: 'access_logs',
            where: { access_logs: { id: log.id } }
          })
        }
      }
      console.log('✅ Registros deletados individualmente!')
      return true
    }

    console.log('⚠️ Nenhum método de limpeza funcionou.')
    console.log('\n📋 Alternativa: Limpe manualmente no menu do REP:')
    console.log('   Menu > Configurações > Sistema > Limpar Registros')
    return false

  } catch (error) {
    console.error('Erro ao limpar AFD:', error.message)
    return false
  }
}

async function confirmar(pergunta) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(pergunta, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 's' || answer.toLowerCase() === 'sim')
    })
  })
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║       LIMPAR REGISTROS AFD DO REP CONTROL ID             ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log('║  ⚠️  ATENÇÃO: Esta operação é IRREVERSÍVEL!              ║')
  console.log('║  Os registros de ponto serão apagados do equipamento.    ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  const session = await login()
  if (!session) {
    console.error('\n❌ Falha no login. Abortando.')
    process.exit(1)
  }

  // Conta registros antes
  const totalAntes = await contarRegistros(session)
  if (totalAntes >= 0) {
    console.log(`\n📊 Registros encontrados no REP: ${totalAntes}`)
  }

  if (totalAntes === 0) {
    console.log('\n✅ O REP já está sem registros AFD.')
    try { await httpsRequest(`/logout.fcgi?session=${session}`, 'POST') } catch {}
    process.exit(0)
  }

  // Confirmação
  const confirmado = await confirmar('\n❓ Deseja realmente APAGAR todos os registros do REP? (s/n): ')

  if (!confirmado) {
    console.log('\n❌ Operação cancelada pelo usuário.')
    try { await httpsRequest(`/logout.fcgi?session=${session}`, 'POST') } catch {}
    process.exit(0)
  }

  // Executa limpeza
  const sucesso = await limparAFD(session)

  if (sucesso) {
    // Verifica se limpou
    const totalDepois = await contarRegistros(session)
    console.log(`\n📊 Registros após limpeza: ${totalDepois}`)

    if (totalDepois === 0) {
      console.log('\n✅ Todos os registros foram removidos com sucesso!')
    } else {
      console.log('\n⚠️ Alguns registros podem não ter sido removidos.')
    }
  }

  // Logout
  try { await httpsRequest(`/logout.fcgi?session=${session}`, 'POST') } catch {}

  console.log('\nFinalizado!')
}

run().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
