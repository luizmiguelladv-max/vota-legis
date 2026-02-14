import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

// Usa variáveis de ambiente
const pool = new Pool({
  host: process.env.DB_HOST || '92.112.178.164',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'postgres',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function run() {
  try {
    console.log('Conectando ao banco de dados...')
    console.log(`Host: ${process.env.DB_HOST || '92.112.178.164'}`)

    // Limpa registros de ponto do schema santo_andre
    const result = await pool.query('DELETE FROM santo_andre.registros_ponto')
    console.log(`\n✅ Registros apagados: ${result.rowCount}`)

    // Reseta sequência do ID (opcional)
    await pool.query('ALTER SEQUENCE santo_andre.registros_ponto_id_seq RESTART WITH 1')
    console.log('✅ Sequência de ID resetada para 1')

    await pool.end()
    console.log('\nPronto para novos testes!')
  } catch (err) {
    console.error('Erro:', err.message)
    process.exit(1)
  }
}

run()
