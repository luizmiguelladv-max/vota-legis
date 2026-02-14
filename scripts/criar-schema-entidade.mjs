/**
 * Script para criar schema de uma entidade no banco de dados
 *
 * Uso: node scripts/criar-schema-entidade.mjs <entidade_id>
 *
 * Este script:
 * 1. Busca a entidade no banco central
 * 2. Determina o nome do schema (baseado no slug do município + categoria)
 * 3. Cria o schema se não existir
 * 4. Cria as tabelas básicas copiando a estrutura do schema do município
 */

import pg from 'pg'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const { Pool } = pg

// Configuração do banco central
const centralPool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

async function criarSchemaEntidade(entidadeId) {
  console.log(`\n=== Criando schema para entidade ID: ${entidadeId} ===\n`)

  const client = await centralPool.connect()

  try {
    // 1. Buscar dados da entidade e município
    const { rows: [entidade] } = await client.query(`
      SELECT e.id, e.nome, e.tipo, e.categoria, e.db_schema,
             m.slug as municipio_slug, m.db_schema as municipio_schema
      FROM entidades e
      JOIN municipios m ON m.id = e.municipio_id
      WHERE e.id = $1
    `, [entidadeId])

    if (!entidade) {
      console.error('❌ Entidade não encontrada!')
      return
    }

    console.log(`📋 Entidade: ${entidade.nome}`)
    console.log(`   Tipo: ${entidade.tipo}`)
    console.log(`   Categoria: ${entidade.categoria}`)
    console.log(`   Slug do Município: ${entidade.municipio_slug}`)

    // 2. Determinar nome do schema
    let schemaName = entidade.db_schema
    if (!schemaName) {
      schemaName = `${entidade.municipio_slug}_${entidade.categoria.toLowerCase()}`
    }

    console.log(`\n🎯 Schema alvo: ${schemaName}`)

    // 3. Verificar se schema já existe
    const { rows: [schemaExiste] } = await client.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
    `, [schemaName])

    if (schemaExiste) {
      console.log(`✅ Schema ${schemaName} já existe!`)

      // Verificar se tem tabelas
      const { rows: tabelas } = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 ORDER BY table_name
      `, [schemaName])

      console.log(`\n📊 Tabelas existentes (${tabelas.length}):`)
      tabelas.forEach(t => console.log(`   - ${t.table_name}`))

      // Continua para criar tabelas faltantes
      console.log('\n🔧 Verificando tabelas faltantes...')
    } else {
      // 4. Criar o schema
      console.log(`\n🔧 Criando schema ${schemaName}...`)
      await client.query(`CREATE SCHEMA ${schemaName}`)
      console.log(`✅ Schema criado!`)
    }

    // 5. Copiar estrutura do schema do município (ou usar template)
    const schemaOrigem = entidade.municipio_schema || entidade.municipio_slug

    console.log(`\n📋 Copiando estrutura de ${schemaOrigem} para ${schemaName}...`)

    // Lista de tabelas para copiar (sem dados)
    // IMPORTANTE: A ordem importa para respeitar dependências de FK
    const tabelasParaCopiar = [
      // Tabelas base (sem dependências)
      'unidades_gestoras',
      'secretarias',
      'lotacoes',
      'tipos_vinculo',
      'cargos',
      'jornadas',
      'jornada_horarios',
      'equipamentos',
      'feriados',
      'tipos_ocorrencia',
      'configuracoes_sistema',
      'banco_horas_config',
      'configuracao_tenant',
      // Tabelas com dependências
      'funcionarios',
      'funcionarios_fotos',
      'digitais_funcionarios',
      'registros_ponto',
      'espelhos_ponto',
      'ocorrencias',
      'banco_horas',
      'notificacoes',
      'afastamentos',
      'funcionario_templates'
    ]

    for (const tabela of tabelasParaCopiar) {
      try {
        // Verificar se tabela existe na origem
        const { rows: [existe] } = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
        `, [schemaOrigem, tabela])

        if (!existe) {
          console.log(`   ⏭️  ${tabela} - não existe na origem, pulando`)
          continue
        }

        // Copiar estrutura (CREATE TABLE ... LIKE)
        await client.query(`
          CREATE TABLE ${schemaName}.${tabela}
          (LIKE ${schemaOrigem}.${tabela} INCLUDING ALL)
        `)
        console.log(`   ✅ ${tabela}`)
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`   ⏭️  ${tabela} - já existe`)
        } else {
          console.log(`   ❌ ${tabela} - ${err.message}`)
        }
      }
    }

    // 6. Atualizar db_schema da entidade se estava vazio
    if (!entidade.db_schema) {
      await client.query(`
        UPDATE entidades SET db_schema = $1 WHERE id = $2
      `, [schemaName, entidadeId])
      console.log(`\n✅ Campo db_schema da entidade atualizado para: ${schemaName}`)
    }

    console.log(`\n🎉 Schema ${schemaName} configurado com sucesso!`)
    console.log('\nAgora você pode acessar a entidade e cadastrar funcionários próprios.')

  } catch (error) {
    console.error('❌ Erro:', error.message)
    console.error(error.stack)
  } finally {
    client.release()
    await centralPool.end()
  }
}

// Executar
const entidadeId = process.argv[2]
if (!entidadeId) {
  console.log('Uso: node scripts/criar-schema-entidade.mjs <entidade_id>')
  console.log('\nExemplo: node scripts/criar-schema-entidade.mjs 2')
  process.exit(1)
}

criarSchemaEntidade(parseInt(entidadeId))
