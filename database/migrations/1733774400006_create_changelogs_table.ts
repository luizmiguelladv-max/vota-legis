import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'changelogs'

  async up() {
    if (await this.schema.hasTable(this.tableName)) {
      return
    }

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Dados da versão
      table.string('versao', 20).notNullable()
      table.string('titulo', 200).notNullable()
      table.text('descricao').nullable()
      table.enum('tipo', ['recurso', 'correcao', 'melhoria', 'seguranca']).notNullable()

      // Data de lançamento
      table.date('data_lancamento').notNullable()

      // Controle
      table.integer('criado_por').unsigned().nullable().references('id').inTable('usuarios_master')
      table.boolean('ativo').defaultTo(true)

      // Timestamps
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // Índices
      table.index(['versao'])
      table.index(['tipo'])
      table.index(['data_lancamento'])
      table.index(['ativo'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
