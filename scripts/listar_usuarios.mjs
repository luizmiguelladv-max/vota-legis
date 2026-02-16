// scripts/listar_usuarios.mjs
import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pg
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function run() {
    const client = await pool.connect()
    try {
        const res = await client.query('SELECT id, email, nome_completo FROM usuarios_master')
        console.log('Usuários encontrados:', res.rows)
    } catch (err) {
        console.error('Erro:', err.message)
    } finally {
        client.release()
        await pool.end()
    }
}
run()
