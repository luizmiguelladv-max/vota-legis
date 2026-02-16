
import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pg
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
})

async function run() {
    const client = await pool.connect()
    try {
        // Tenta pegar o primeiro registro e ver as chaves, se não tiver, usa information_schema
        const res = await client.query('SELECT * FROM information_schema.columns WHERE table_name = \'usuarios_master\'')
        console.log('Colunas encontradas:')
        res.rows.forEach(r => console.log(r.column_name))
    } catch (err) {
        console.error(err)
    } finally {
        client.release()
        await pool.end()
    }
}
run()
