// scripts/criar_tabela_digitais.mjs
// Cria tabela para armazenar templates de digitais
// Uso: node scripts/criar_tabela_digitais.mjs

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
        console.log('Criando tabela funcionarios_digitais...')

        await client.query(`
      CREATE TABLE IF NOT EXISTS santo_andre.funcionarios_digitais (
        id SERIAL PRIMARY KEY,
        funcionario_id INTEGER NOT NULL REFERENCES santo_andre.funcionarios(id) ON DELETE CASCADE,
        finger_type INTEGER NOT NULL DEFAULT 0,
        template TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(funcionario_id, finger_type)
      )
    `)

        console.log('✅ Tabela criada com sucesso!')

        // Índice para busca rápida
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_digitais_funcionario 
      ON santo_andre.funcionarios_digitais(funcionario_id)
    `)

        console.log('✅ Índice criado!')

    } catch (err) {
        console.error('Erro:', err.message)
    } finally {
        client.release()
        await pool.end()
    }
}

run()
