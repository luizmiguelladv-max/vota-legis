// scripts/ver-registros-rep.mjs
// Busca registros de acesso do REP Control iD

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
  console.log('=== REGISTROS DO REP ===\n')

  // Login
  const loginRes = await httpsRequest('/login.fcgi', 'POST', { login: REP_USER, password: REP_PASS })
  if (!loginRes.session) {
    console.log('Erro no login:', loginRes)
    return
  }

  const session = loginRes.session
  console.log('Login OK!\n')

  // Buscar AFD via get_afd
  console.log('Buscando AFD (últimos registros)...')

  const afdRes = await httpsRequest('/get_afd.fcgi?session=' + session, 'POST', {})

  if (typeof afdRes === 'string' && afdRes.length > 0) {
    const lines = afdRes.split('\n').filter(l => l.trim())
    console.log('Registros AFD encontrados:', lines.length)
    console.log('')

    // Mostrar últimos 10
    const ultimos = lines.slice(-10)
    ultimos.forEach(line => {
      // Formato AFD: NSR(9) + Tipo(1) + Data(8) + Hora(4) + PIS(12)
      if (line.length >= 34) {
        const nsr = line.substring(0, 9)
        const tipo = line.substring(9, 10)
        const data = line.substring(10, 18)
        const hora = line.substring(18, 22)
        const pis = line.substring(22, 34)

        const dataFormatada = data.substring(0, 2) + '/' + data.substring(2, 4) + '/' + data.substring(4, 8)
        const horaFormatada = hora.substring(0, 2) + ':' + hora.substring(2, 4)

        console.log('  NSR:', nsr, '| Data:', dataFormatada, horaFormatada, '| PIS:', pis)
      } else {
        console.log('  Linha:', line)
      }
    })
  } else {
    console.log('Resposta AFD:', typeof afdRes === 'string' ? afdRes.substring(0, 200) : JSON.stringify(afdRes, null, 2))
  }
}

main().catch(console.error)
