import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'perfis'

  async up() {
    // ============================================
    // TABELAS CENTRAIS (Schema public)
    // Compartilhadas entre todos os tenants
    // ============================================

    // Tabela de Perfis
    this.schema.createTable('perfis', (table) => {
      table.increments('id').primary()
      table.string('codigo', 50).notNullable().unique()
      table.string('nome', 100).notNullable()
      table.text('descricao').nullable()
      table.boolean('ativo').defaultTo(true)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // Tabela de Municipios (Tenants - Camaras Municipais)
    this.schema.createTable('municipios', (table) => {
      table.increments('id').primary()
      table.string('nome', 255).notNullable()
      table.string('slug', 255).notNullable().unique()
      table.string('uf', 2).notNullable()
      table.string('codigo_ibge', 7).nullable()
      table.boolean('ativo').defaultTo(true)
      table.boolean('status').defaultTo(true)
      table.boolean('banco_criado').defaultTo(false)

      // Dados da camara
      table.string('cnpj', 14).nullable()
      table.string('endereco', 500).nullable()
      table.string('telefone', 20).nullable()
      table.string('email', 255).nullable()
      table.string('site', 255).nullable()
      table.string('cep', 8).nullable()
      table.integer('populacao').nullable()
      table.text('observacoes').nullable()
      table.string('latitude', 50).nullable()
      table.string('longitude', 50).nullable()

      // Logo e configuracoes visuais
      table.string('logo_url', 500).nullable()
      table.string('cor_primaria', 7).defaultTo('#1a365d')
      table.string('cor_secundaria', 7).defaultTo('#2c5282')

      // Quantidade de vereadores
      table.integer('total_vereadores').defaultTo(9)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // Tabela de Usuarios
    this.schema.createTable('usuarios', (table) => {
      table.increments('id').primary()
      table.string('nome', 255).notNullable()
      table.string('email', 254).notNullable().unique()
      table.string('login', 100).notNullable().unique()
      table.string('senha', 255).notNullable()
      table.string('celular', 20).nullable()

      table.integer('perfil_id').unsigned().references('id').inTable('perfis').onDelete('RESTRICT')
      table.integer('municipio_id').unsigned().nullable().references('id').inTable('municipios').onDelete('CASCADE')

      table.string('foto', 500).nullable()
      table.boolean('ativo').defaultTo(true)
      table.boolean('dois_fatores_ativo').defaultTo(false)
      table.timestamp('ultimo_login').nullable()
      table.integer('ultimo_municipio_acessado').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // Tabela de Auditoria
    this.schema.createTable('auditoria', (table) => {
      table.increments('id').primary()
      table.integer('usuario_id').unsigned().nullable().references('id').inTable('usuarios').onDelete('SET NULL')
      table.string('usuario_tipo', 50).nullable()
      table.string('acao', 50).notNullable()
      table.string('tabela', 100).notNullable()
      table.integer('registro_id').nullable()
      table.jsonb('dados_antigos').nullable()
      table.jsonb('dados_novos').nullable()
      table.string('ip', 45).nullable()
      table.string('user_agent', 500).nullable()
      table.integer('municipio_id').unsigned().nullable()
      table.timestamp('created_at').notNullable()
    })

    // Tabela de Codigos 2FA
    this.schema.createTable('codigos_2fa', (table) => {
      table.increments('id').primary()
      table.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios').onDelete('CASCADE')
      table.string('codigo', 6).notNullable()
      table.string('telefone', 20).nullable()
      table.integer('tentativas').defaultTo(0)
      table.boolean('usado').defaultTo(false)
      table.timestamp('expira_em').notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['usuario_id', 'usado', 'expira_em'])
    })

    // Tabela de Dispositivos Confiaveis
    this.schema.createTable('dispositivos_confiaveis', (table) => {
      table.increments('id').primary()
      table.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios').onDelete('CASCADE')
      table.string('token', 64).notNullable().unique()
      table.string('nome_dispositivo', 255).nullable()
      table.string('navegador', 50).nullable()
      table.string('ip', 45).nullable()
      table.boolean('ativo').defaultTo(true)
      table.timestamp('ultimo_acesso').nullable()
      table.timestamp('expira_em').notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['usuario_id', 'ativo', 'expira_em'])
      table.index(['token'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('dispositivos_confiaveis')
    this.schema.dropTableIfExists('codigos_2fa')
    this.schema.dropTableIfExists('auditoria')
    this.schema.dropTableIfExists('usuarios')
    this.schema.dropTableIfExists('municipios')
    this.schema.dropTableIfExists('perfis')
  }
}
