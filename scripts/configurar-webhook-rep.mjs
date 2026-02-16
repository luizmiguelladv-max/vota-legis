// configurar-webhook-rep.mjs
// Configura o REP Control iD para enviar batidas em tempo real via webhook
// Uso: node --insecure-http-parser scripts/configurar-webhook-rep.mjs

import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

const REP_IP = '192.168.0.200'
const REP_USER = 'admin'
const REP_PASS = '12345'

// URL do webhook (ajuste para seu IP)
const WEBHOOK_URL = 'http://192.168.0.105:3333/api/webhook/controlid'

function httpsRequest(path, method, body = null, session = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : ''
    const url = session ? `${path}?session=${session}` : path

    const options = {
      hostname: REP_IP,
      port: 443,
      path: url,
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
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve(data)
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    if (bodyString) req.write(bodyString)
    req.end()
  })
}

async function configurarWebhook() {
  console.log('='.repeat(60))
  console.log('CONFIGURAR WEBHOOK DO REP CONTROL iD')
  console.log('='.repeat(60))
  console.log()

  try {
    // 1. Login
    console.log('[1] Conectando ao REP...')
    const loginResult = await httpsRequest('/login.fcgi', 'POST', {
      login: REP_USER,
      password: REP_PASS
    })

    if (!loginResult.session) {
      throw new Error('Falha no login: ' + JSON.stringify(loginResult))
    }

    const session = loginResult.session
    console.log('    ✅ Conectado!')

    // 2. Verificar configuração atual do servidor
    console.log('\n[2] Verificando configuração atual...')
    const configAtual = await httpsRequest('/get_configuration.fcgi', 'POST', {}, session)
    console.log('    Configuração atual:', JSON.stringify(configAtual, null, 2).substring(0, 500))

    // 3. Configurar webhook para envio em tempo real
    console.log('\n[3] Configurando webhook para tempo real...')

    // Configuração do servidor de eventos (webhook)
    const webhookConfig = {
      // Habilita envio de eventos em tempo real
      push_server_events: 1,
      push_server_url: WEBHOOK_URL,
      push_server_port: 3333,

      // Eventos para enviar (7 = acesso liberado/batida)
      push_server_event_types: [7],

      // Intervalo de retry em caso de falha (segundos)
      push_server_retry_interval: 5,

      // Timeout de conexão (segundos)
      push_server_timeout: 10
    }

    const setResult = await httpsRequest('/set_configuration.fcgi', 'POST', webhookConfig, session)
    console.log('    Resultado:', JSON.stringify(setResult))

    // 4. Verificar se aplicou
    console.log('\n[4] Verificando nova configuração...')
    const novaConfig = await httpsRequest('/get_configuration.fcgi', 'POST', {}, session)

    if (novaConfig.push_server_events === 1 || novaConfig.push_server_url) {
      console.log('    ✅ Webhook configurado com sucesso!')
      console.log('    URL:', novaConfig.push_server_url || WEBHOOK_URL)
    } else {
      console.log('    ⚠️ Configuração pode não ter sido aplicada')
      console.log('    Verifique manualmente no painel do REP')
    }

    // 5. Testar envio
    console.log('\n[5] Testando conexão do REP com o webhook...')
    const testeResult = await httpsRequest('/test_push_server.fcgi', 'POST', {}, session)
    console.log('    Resultado do teste:', JSON.stringify(testeResult))

    // Logout
    await httpsRequest('/logout.fcgi', 'POST', {}, session)

    console.log('\n' + '='.repeat(60))
    console.log('CONFIGURAÇÃO CONCLUÍDA')
    console.log('='.repeat(60))
    console.log('\nAgora o REP deve enviar batidas imediatamente para:')
    console.log(WEBHOOK_URL)
    console.log('\nTeste batendo o ponto e verifique os logs do AdonisJS.')

  } catch (error) {
    console.error('\n❌ ERRO:', error.message)
    console.log('\nTente configurar manualmente no painel do REP:')
    console.log('1. Acesse https://' + REP_IP)
    console.log('2. Menu > Comunicação > Servidor')
    console.log('3. Configure a URL:', WEBHOOK_URL)
    console.log('4. Marque "Envio em tempo real" ou "Push Server"')
  }
}

configurarWebhook()
