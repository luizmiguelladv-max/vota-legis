#!/usr/bin/env node

/**
 * Script para corrigir a estrutura da tabela espelhos_ponto
 * Adiciona as colunas faltantes se não existirem
 */

import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const { Client } = pg

async function main() {
  // Conexão com banco central
  const centralClient = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  })

  try {
    await centralClient.connect()
    console.log('✅ Conectado ao banco central')

    // Busca todos os municípios ativos
    const municipiosResult = await centralClient.query(
      `SELECT id, nome, db_schema FROM municipios WHERE ativo = true`
    )

    console.log(`\n📋 Encontrados ${municipiosResult.rows.length} municípios ativos\n`)

    for (const municipio of municipiosResult.rows) {
      console.log(`\n🏛️  Processando: ${municipio.nome} (schema: ${municipio.db_schema})`)

      try {
        // Verifica se a tabela existe
        const tableExists = await centralClient.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'espelhos_ponto'
          )`,
          [municipio.db_schema]
        )

        if (!tableExists.rows[0].exists) {
          console.log('   ⚠️  Tabela espelhos_ponto não existe, criando...')

          // Cria a tabela completa
          await centralClient.query(`
            CREATE TABLE IF NOT EXISTS ${municipio.db_schema}.espelhos_ponto (
              id SERIAL PRIMARY KEY,
              funcionario_id INTEGER NOT NULL REFERENCES ${municipio.db_schema}.funcionarios(id),
              mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
              ano INTEGER NOT NULL,
              dias_trabalhados INTEGER DEFAULT 0,
              horas_trabalhadas INTEGER DEFAULT 0,
              horas_extras INTEGER DEFAULT 0,
              horas_faltantes INTEGER DEFAULT 0,
              atrasos INTEGER DEFAULT 0,
              faltas INTEGER DEFAULT 0,
              status VARCHAR(20) DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'FECHADO', 'APROVADO')),
              aprovado_por INTEGER REFERENCES ${municipio.db_schema}.funcionarios(id),
              aprovado_em TIMESTAMPTZ,
              dados JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(funcionario_id, mes, ano)
            )
          `)
          console.log('   ✅ Tabela criada com sucesso!')
          continue
        }

        // Verifica colunas existentes
        const columnsResult = await centralClient.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'espelhos_ponto'`,
          [municipio.db_schema]
        )

        const existingColumns = columnsResult.rows.map(r => r.column_name)
        console.log(`   📊 Colunas existentes: ${existingColumns.join(', ')}`)

        // Colunas que devem existir
        const requiredColumns = [
          { name: 'dias_trabalhados', type: 'INTEGER DEFAULT 0' },
          { name: 'horas_trabalhadas', type: 'INTEGER DEFAULT 0' },
          { name: 'horas_extras', type: 'INTEGER DEFAULT 0' },
          { name: 'horas_faltantes', type: 'INTEGER DEFAULT 0' },
          { name: 'atrasos', type: 'INTEGER DEFAULT 0' },
          { name: 'faltas', type: 'INTEGER DEFAULT 0' },
          { name: 'status', type: "VARCHAR(20) DEFAULT 'ABERTO'" },
          { name: 'aprovado_por', type: 'INTEGER' },
          { name: 'aprovado_em', type: 'TIMESTAMPTZ' },
          { name: 'dados', type: 'JSONB' },
        ]

        // Adiciona colunas faltantes
        for (const col of requiredColumns) {
          if (!existingColumns.includes(col.name)) {
            console.log(`   ➕ Adicionando coluna: ${col.name}`)
            await centralClient.query(
              `ALTER TABLE ${municipio.db_schema}.espelhos_ponto ADD COLUMN ${col.name} ${col.type}`
            )
          }
        }

        // Verifica constraint UNIQUE
        const constraintResult = await centralClient.query(
          `SELECT constraint_name FROM information_schema.table_constraints
           WHERE table_schema = $1 AND table_name = 'espelhos_ponto'
           AND constraint_type = 'UNIQUE'`,
          [municipio.db_schema]
        )

        if (constraintResult.rows.length === 0) {
          console.log('   ➕ Adicionando constraint UNIQUE(funcionario_id, mes, ano)')
          try {
            await centralClient.query(
              `ALTER TABLE ${municipio.db_schema}.espelhos_ponto
               ADD CONSTRAINT espelhos_ponto_funcionario_mes_ano_key
               UNIQUE (funcionario_id, mes, ano)`
            )
          } catch (e) {
            console.log(`   ⚠️  Constraint já existe ou erro: ${e.message}`)
          }
        }

        // Cria índices se não existirem
        const indexes = [
          { name: 'idx_espelhos_ponto_funcionario', column: 'funcionario_id' },
          { name: 'idx_espelhos_ponto_periodo', column: 'ano, mes' },
          { name: 'idx_espelhos_ponto_status', column: 'status' },
        ]

        for (const idx of indexes) {
          try {
            await centralClient.query(
              `CREATE INDEX IF NOT EXISTS ${idx.name}
               ON ${municipio.db_schema}.espelhos_ponto(${idx.column})`
            )
          } catch (e) {
            // Índice pode já existir
          }
        }

        console.log('   ✅ Schema verificado e atualizado!')

      } catch (err) {
        console.log(`   ❌ Erro: ${err.message}`)
      }
    }

    console.log('\n✅ Processo finalizado!\n')

  } catch (err) {
    console.error('❌ Erro geral:', err.message)
  } finally {
    await centralClient.end()
  }
}

main()
