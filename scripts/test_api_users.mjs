import https from 'https'

const REP_IP = '192.168.0.200'
const SESSION_CACHE = null

function req(path, body, session = null) {
    return new Promise((resolve) => {
        const fullPath = session ? `${path}?session=${session}` : path
        const bodyStr = JSON.stringify(body)
        const opts = {
            hostname: REP_IP, port: 443, path: fullPath, method: 'POST',
            rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'Content-Length': bodyStr.length }
        }
        const r = https.request(opts, res => {
            let d = ''
            res.on('data', c => d += c)
            res.on('end', () => resolve({ s: res.statusCode, d }))
        })
        r.on('error', e => resolve({ err: e.message }))
        r.write(bodyStr)
        r.end()
    })
}

async function run() {
    console.log('--- Iniciando Teste de API de Usuários ---')

    // 1. Login
    const login = await req('/login.fcgi', { login: 'admin', password: '12345' })
    const session = JSON.parse(login.d).session
    console.log('Login:', session ? 'OK' : 'Falhou', session)
    if (!session) return

    // 2. Testes de Variações
    const testes = [
        { name: 'limit + offset', body: { limit: 1000, offset: 0 } },
        { name: 'limit + include_biometrics false', body: { limit: 1000, include_biometrics: false } },
        { name: 'full params', body: { limit: 1000, offset: 0, users: true, templates: false, cards: false } },
        // Tentar users: false só pra ver se o erro muda
        { name: 'users false', body: { limit: 1000, users: false } }
    ]

    for (const t of testes) {
        const path = t.path || '/load_users.fcgi'
        console.log(`\nTestando: ${t.name} (${path})`)
        console.log(`Body: ${JSON.stringify(t.body)}`)
        const res = await req(path, t.body, session)
        console.log(`Res: ${res.d.substring(0, 150)}`)
    }
}

run()
