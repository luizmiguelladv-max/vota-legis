import pg from 'pg'
const { Client } = pg

const config = {
    host: 'supabase.mdevelop.com.br',
    port: 5432,
    user: 'postgres',
    password: '762Xh9pMBt8F4rLQaQWJosLGnH3z2h05',
    database: 'postgres', // Default supabase db
    ssl: { rejectUnauthorized: false } // Coolify generally needs this or proper certs
}

console.log(`[Teste] Conectando a ${config.host}:${config.port}...`)

const client = new Client(config)

async function test() {
    try {
        await client.connect()
        console.log('[Teste] Sucesso! Conectado ao Postgres.')

        const res = await client.query('SELECT NOW() as now, current_database() as db')
        console.log('[Teste] DB Time:', res.rows[0].now)
        console.log('[Teste] Database:', res.rows[0].db)

        await client.end()
        process.exit(0)
    } catch (err) {
        console.error('[Teste] Erro de conexão (FULL):', JSON.stringify(err, Object.getOwnPropertyNames(err)))
        process.exit(1)
    }
}

test()
