import https from 'https'

const REP_IP = '192.168.0.200'
const REP_USER = 'admin'
const REP_PASS = '12345'

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
    console.log('--- Iniciando Teste de Sync Unitário ---')

    // Login
    const login = await req('/login.fcgi', { login: REP_USER, password: REP_PASS })
    const session = JSON.parse(login.d).session
    if (!session) { console.log('Login falhou'); return }
    console.log('Login OK')

    // Dados base
    const userBase = {
        name: "TESTE API",
        pis: "00000000001",
        registration: "99999"
    }

    const variacoes = [
        // 1. Tipos String (como estava no proxy)
        {
            name: 'Strings',
            payload: { users: [userBase] }
        },
        // 2. Tipos Int (como no script original, mas com Name)
        {
            name: 'Ints + Name',
            payload: {
                users: [{
                    name: userBase.name,
                    pis: parseInt(userBase.pis),
                    registration: parseInt(userBase.registration) // Errado? original usava 'code'
                }]
            }
        },
        // 3. Ints + Code (campo do script original) + Name
        {
            name: 'Ints + Code + Name',
            payload: {
                users: [{
                    name: userBase.name,
                    pis: parseInt(userBase.pis),
                    code: parseInt(userBase.registration)
                }]
            }
        },
        // 4. Somente PIS e Code (como original)
        {
            name: 'Original (PIS + Code only)',
            payload: {
                users: [{
                    pis: parseInt(userBase.pis),
                    code: parseInt(userBase.registration)
                }]
            }
        }
    ]

    for (const v of variacoes) {
        console.log(`\nTestando: ${v.name}`)
        const res = await req('/update_users.fcgi', v.payload, session)
        console.log(`Status: ${res.s}`)
        console.log(`Body: ${res.d}`)
    }
}

run()
