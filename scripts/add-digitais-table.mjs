/**
 * Script para adicionar tabela de digitais aos schemas dos municípios
 * Suporta até 3 digitais por funcionário (igual ao REP Control iD)
 */

import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
})

async function addDigitaisTable() {
  const client = await pool.connect()

  try {
    console.log('='.repeat(60))
    console.log('Adicionando tabela de digitais aos schemas...')
    console.log('='.repeat(60))

    // Busca todos os municípios (usa db_schema se existir, senão calcula do slug)
    const municipios = await client.query('SELECT id, nome, slug, db_schema FROM municipios WHERE ativo = true')
    console.log(`\nEncontrados ${municipios.rows.length} município(s)\n`)

    for (const mun of municipios.rows) {
      // Usa db_schema diretamente se existir, senão calcula do slug
      const schema = mun.db_schema || mun.slug?.replace(/-/g, '_') || `municipio_${mun.id}`
      console.log(`\n>>> ${mun.nome} (${schema})`)

      // Cria a tabela de digitais
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${schema}.digitais_funcionarios (
          id SERIAL PRIMARY KEY,
          funcionario_id INTEGER NOT NULL REFERENCES ${schema}.funcionarios(id) ON DELETE CASCADE,
          dedo INTEGER NOT NULL CHECK (dedo BETWEEN 1 AND 3),  -- 1, 2 ou 3 (até 3 digitais)
          finger_type INTEGER DEFAULT 1,  -- 0=Polegar D, 1=Indicador D, 2=Medio D, etc.
          template TEXT NOT NULL,  -- Template em base64
          qualidade INTEGER DEFAULT 0,  -- Score de qualidade (0-100)
          origem VARCHAR(20) DEFAULT 'LEITOR',  -- LEITOR, REP, IMPORTADO
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(funcionario_id, dedo)
        );

        -- Índices
        CREATE INDEX IF NOT EXISTS idx_digitais_funcionario ON ${schema}.digitais_funcionarios(funcionario_id);
        CREATE INDEX IF NOT EXISTS idx_digitais_dedo ON ${schema}.digitais_funcionarios(funcionario_id, dedo);
      `

      try {
        await client.query(createTableSQL)
        console.log(`   ✓ Tabela digitais_funcionarios criada/verificada`)
      } catch (err) {
        if (err.code === '42P07') {
          console.log(`   - Tabela já existe`)
        } else {
          console.error(`   ✗ Erro: ${err.message}`)
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('Concluído!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('Erro geral:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

addDigitaisTable()
