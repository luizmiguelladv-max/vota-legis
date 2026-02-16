import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function verificarColunas() {
    try {
        const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'santo_andre' 
        AND table_name = 'espelhos_ponto' 
      ORDER BY ordinal_position
    `)

        console.log('Colunas da tabela espelhos_ponto:')
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}`)
        })

        // Verifica se dias_trabalhados existe
        const temDiasTrabalhados = result.rows.some(r => r.column_name === 'dias_trabalhados')
        console.log(`\nColuna 'dias_trabalhados' existe: ${temDiasTrabalhados ? 'SIM' : 'NÃO'}`)

    } catch (err) {
        console.error('Erro:', err)
    } finally {
        await pool.end()
    }
}

verificarColunas()
