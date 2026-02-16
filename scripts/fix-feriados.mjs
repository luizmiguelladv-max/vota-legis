// fix-feriados.mjs
// Recria a tabela feriados com estrutura correta
// Uso: node fix-feriados.mjs

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
    console.log('🔧 Recriando tabela feriados...\n')
    
    // Remove tabela antiga
    await client.query('DROP TABLE IF EXISTS santo_andre.feriados CASCADE')
    console.log('✅ Tabela antiga removida')
    
    // Cria tabela com estrutura correta
    await client.query(`
      CREATE TABLE santo_andre.feriados (
        id SERIAL PRIMARY KEY,
        data DATE NOT NULL,
        descricao VARCHAR(255) NOT NULL,
        tipo VARCHAR(50) DEFAULT 'MUNICIPAL',
        recorrente BOOLEAN DEFAULT FALSE,
        ativo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `)
    console.log('✅ Tabela criada com estrutura correta')
    
    // Cria índice
    await client.query('CREATE INDEX idx_feriados_data ON santo_andre.feriados(data)')
    console.log('✅ Índice criado')
    
    // Verifica estrutura final
    console.log('\n📋 Estrutura da tabela:')
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'santo_andre' AND table_name = 'feriados'
      ORDER BY ordinal_position
    `)
    console.table(result.rows)
    
    console.log('\n✅ Tabela feriados pronta! Agora use "Gerar Ano" no sistema.')
    
  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
