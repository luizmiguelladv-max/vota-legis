/**
 * Script de migração para suportar múltiplas amostras por dedo
 *
 * Alterações:
 * 1. Adiciona coluna 'amostra' (1, 2, 3) para identificar cada captura
 * 2. Modifica constraint UNIQUE para (funcionario_id, dedo, amostra)
 * 3. Permite até 3 amostras por dedo (total de 9 templates por funcionário)
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

async function migrate() {
  const client = await pool.connect()

  try {
    console.log('='.repeat(60))
    console.log('Migrando tabela digitais_funcionarios para múltiplas amostras')
    console.log('='.repeat(60))

    // Busca todos os municípios
    const municipios = await client.query('SELECT id, nome, slug, db_schema FROM municipios WHERE ativo = true')
    console.log(`\nEncontrados ${municipios.rows.length} município(s)\n`)

    for (const mun of municipios.rows) {
      const schema = mun.db_schema || mun.slug?.replace(/-/g, '_') || `municipio_${mun.id}`
      console.log(`\n>>> ${mun.nome} (${schema})`)

      try {
        // 1. Verifica se a coluna 'amostra' já existe
        const colCheck = await client.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = $1
          AND table_name = 'digitais_funcionarios'
          AND column_name = 'amostra'
        `, [schema])

        if (colCheck.rows.length === 0) {
          // 2. Adiciona coluna amostra com default 1
          console.log('   → Adicionando coluna "amostra"...')
          await client.query(`
            ALTER TABLE ${schema}.digitais_funcionarios
            ADD COLUMN IF NOT EXISTS amostra INTEGER DEFAULT 1 CHECK (amostra BETWEEN 1 AND 3)
          `)

          // 3. Remove constraint UNIQUE antiga
          console.log('   → Removendo constraint antiga...')
          try {
            await client.query(`
              ALTER TABLE ${schema}.digitais_funcionarios
              DROP CONSTRAINT IF EXISTS digitais_funcionarios_funcionario_id_dedo_key
            `)
          } catch (e) {
            // Pode não existir
          }

          // 4. Cria nova constraint UNIQUE
          console.log('   → Criando nova constraint UNIQUE...')
          await client.query(`
            ALTER TABLE ${schema}.digitais_funcionarios
            ADD CONSTRAINT digitais_funcionarios_func_dedo_amostra_key
            UNIQUE (funcionario_id, dedo, amostra)
          `)

          // 5. Cria índice para performance
          console.log('   → Criando índice para amostras...')
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_digitais_amostra
            ON ${schema}.digitais_funcionarios(funcionario_id, dedo, amostra)
          `)

          console.log('   ✓ Migração concluída!')
        } else {
          console.log('   - Já migrado anteriormente')
        }

      } catch (err) {
        console.error(`   ✗ Erro: ${err.message}`)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('Migração concluída!')
    console.log('='.repeat(60))
    console.log('\nAgora cada dedo pode ter até 3 amostras.')
    console.log('Total máximo: 3 dedos x 3 amostras = 9 templates por funcionário')

  } catch (error) {
    console.error('Erro geral:', error.message)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
