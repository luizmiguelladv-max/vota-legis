import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'municipios'

  async up() {
    // DBs antigos podem ter a tabela criada sem registro em adonis_schema.
    // Evita falhar o boot por "relation already exists".
    if (await this.schema.hasTable(this.tableName)) {
      return
    }

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Dados básicos do município
      table.string('codigo_ibge', 7).unique().notNullable()
      table.string('nome', 100).notNullable()
      table.string('uf', 2).notNullable()
      table.string('slug', 100).unique().notNullable()

      // Personalização visual
      table.string('logo_url', 500).nullable()
      table.string('cor_primaria', 7).defaultTo('#1a73e8')
      table.string('cor_secundaria', 7).defaultTo('#4285f4')

      // Configurações Supabase
      table.string('supabase_url', 500).nullable()
      table.string('supabase_anon_key', 500).nullable()
      table.string('supabase_service_key', 500).nullable()

      // Configuração de conexão direta
      table.text('db_connection_string').nullable()
      table.string('db_host', 255).nullable()
      table.integer('db_port').defaultTo(5432)
      table.string('db_name', 100).nullable()
      table.string('db_user', 100).nullable()
      table.string('db_password', 255).nullable()

      // Status do município
      table
        .enum('status', ['PENDENTE', 'CRIANDO', 'ATIVO', 'ERRO', 'SUSPENSO'])
        .defaultTo('PENDENTE')
      table.text('status_mensagem').nullable()

      // Controle
      table.boolean('ativo').defaultTo(true)
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // Índices
      table.index(['uf'])
      table.index(['status'])
      table.index(['ativo'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
