// scripts/add-azure-face-columns.mjs
// Adiciona colunas azure_person_id e azure_face_id na tabela funcionarios_fotos

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

async function main() {
  const client = await pool.connect()

  try {
    console.log('Adicionando colunas Azure Face na tabela funcionarios_fotos...')

    // Verifica se coluna azure_person_id já existe
    const checkCol = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'santo_andre'
        AND table_name = 'funcionarios_fotos'
        AND column_name = 'azure_person_id'
    `)

    if (checkCol.rows.length === 0) {
      await client.query(`
        ALTER TABLE santo_andre.funcionarios_fotos
        ADD COLUMN azure_person_id VARCHAR(100),
        ADD COLUMN azure_face_id VARCHAR(100),
        ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()
      `)
      console.log('Colunas adicionadas com sucesso!')
    } else {
      console.log('Colunas já existem.')
    }

  } catch (error) {
    console.error('Erro:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
