/**
 * Script para normalizar dados existentes no banco de dados
 * Converte textos para maiúsculas e remove acentos
 *
 * Uso: node scripts/normalizar-dados.mjs
 */

import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

// Função para remover acentos
function removerAcentos(str) {
  if (!str) return str
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Função para normalizar texto (maiúsculas + sem acentos)
function normalizar(str) {
  if (!str) return str
  return removerAcentos(str).toUpperCase()
}

// Conecta ao banco master para pegar lista de municípios
const masterPool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false }
})

async function normalizarTabelaMaster(pool, tabela, campos) {
  console.log(`\n📋 Normalizando tabela public.${tabela}...`)

  try {
    // Busca todos os registros
    const result = await pool.query(`SELECT id, ${campos.join(', ')} FROM public.${tabela}`)

    let atualizados = 0
    for (const row of result.rows) {
      const updates = []
      const values = []
      let paramIndex = 1

      for (const campo of campos) {
        const valorOriginal = row[campo]
        const valorNormalizado = normalizar(valorOriginal)

        if (valorOriginal !== valorNormalizado) {
          updates.push(`${campo} = $${paramIndex}`)
          values.push(valorNormalizado)
          paramIndex++
        }
      }

      if (updates.length > 0) {
        values.push(row.id)
        await pool.query(
          `UPDATE public.${tabela} SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        )
        atualizados++
      }
    }

    console.log(`   ✅ ${atualizados} registros atualizados de ${result.rows.length} total`)
  } catch (error) {
    console.log(`   ⚠️  Tabela não existe ou erro: ${error.message}`)
  }
}

async function normalizarTabelaTenant(pool, schema, tabela, campos) {
  try {
    // Busca todos os registros
    const result = await pool.query(`SELECT id, ${campos.join(', ')} FROM ${schema}.${tabela}`)

    let atualizados = 0
    for (const row of result.rows) {
      const updates = []
      const values = []
      let paramIndex = 1

      for (const campo of campos) {
        const valorOriginal = row[campo]
        const valorNormalizado = normalizar(valorOriginal)

        if (valorOriginal !== valorNormalizado) {
          updates.push(`${campo} = $${paramIndex}`)
          values.push(valorNormalizado)
          paramIndex++
        }
      }

      if (updates.length > 0) {
        values.push(row.id)
        await pool.query(
          `UPDATE ${schema}.${tabela} SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        )
        atualizados++
      }
    }

    // Sempre mostrar resultado da tabela
    console.log(`   📋 ${tabela}: ${result.rows.length} registros, ${atualizados} atualizados`)

    return atualizados
  } catch (error) {
    // Tabela pode não existir no schema
    console.log(`   ⚠️  ${tabela}: não encontrada ou erro`)
    return 0
  }
}

async function main() {
  console.log('🔄 Iniciando normalização de dados...\n')
  console.log('Este script irá:')
  console.log('  - Converter textos para MAIÚSCULAS')
  console.log('  - Remover acentos (á→A, é→E, ç→C, etc.)')
  console.log('')

  try {
    // 1. Normaliza tabelas do schema public (master)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📁 Schema: public (master)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    // Usuários master - apenas nome (login e email não normalizam)
    await normalizarTabelaMaster(masterPool, 'usuarios_master', ['nome'])

    // Municípios - apenas nome (slug não normaliza)
    await normalizarTabelaMaster(masterPool, 'municipios', ['nome'])

    // 2. Busca todos os municípios ativos para normalizar schemas
    const municipios = await masterPool.query(
      `SELECT id, slug, nome, db_host, db_port, db_name, db_user, db_password, db_schema
       FROM public.municipios
       WHERE status = 'ATIVO' AND db_host IS NOT NULL`
    )

    console.log(`\n📊 Encontrados ${municipios.rows.length} municípios ativos`)

    // 3. Para cada município, conecta e normaliza as tabelas
    for (const mun of municipios.rows) {
      const schema = mun.db_schema || mun.slug.replace(/-/g, '_')
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      console.log(`📁 Município: ${mun.nome} (schema: ${schema})`)
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      let tenantPool
      try {
        // Conecta ao banco do município
        tenantPool = new Pool({
          host: mun.db_host,
          port: mun.db_port || 5432,
          user: mun.db_user,
          password: mun.db_password,
          database: mun.db_name || 'postgres',
          ssl: { rejectUnauthorized: false }
        })

        // Tabelas e campos a normalizar
        const tabelas = [
          { nome: 'funcionarios', campos: ['nome'] },
          { nome: 'cargos', campos: ['nome'] },
          { nome: 'lotacoes', campos: ['nome'] },
          { nome: 'secretarias', campos: ['nome', 'sigla'] },
          { nome: 'unidades_gestoras', campos: ['nome', 'nome_fantasia'] },
          { nome: 'tipos_vinculo', campos: ['nome', 'descricao'] },
          { nome: 'jornadas', campos: ['nome', 'descricao'] },
          { nome: 'usuarios', campos: ['nome'] },
          { nome: 'equipamentos', campos: ['nome'] },
          { nome: 'ocorrencias', campos: ['descricao', 'observacao'] },
          { nome: 'departamentos', campos: ['nome'] },
          { nome: 'tipos_ocorrencia', campos: ['nome', 'descricao'] },
        ]

        let totalAtualizados = 0
        for (const tabela of tabelas) {
          const atualizados = await normalizarTabelaTenant(tenantPool, schema, tabela.nome, tabela.campos)
          totalAtualizados += atualizados
        }

        if (totalAtualizados === 0) {
          console.log('   ✅ Nenhum registro precisou ser atualizado')
        }

      } catch (error) {
        console.log(`   ❌ Erro ao conectar: ${error.message}`)
      } finally {
        if (tenantPool) {
          await tenantPool.end()
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Normalização concluída!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  } catch (error) {
    console.error('❌ Erro:', error.message)
  } finally {
    await masterPool.end()
  }
}

main()
