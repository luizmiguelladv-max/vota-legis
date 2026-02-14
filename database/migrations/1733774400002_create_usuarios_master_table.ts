import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'usuarios_master'

  async up() {
    if (await this.schema.hasTable(this.tableName)) {
      return
    }

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Credenciais
      table.string('login', 50).unique().notNullable()
      table.string('senha', 255).notNullable()

      // Dados pessoais
      table.string('nome', 100).notNullable()
      table.string('email', 255).unique().notNullable()

      // Controle de acesso
      table.boolean('ativo').defaultTo(true)
      table.timestamp('ultimo_acesso', { useTz: true }).nullable()

      // Timestamps
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // Índices
      table.index(['login'])
      table.index(['email'])
      table.index(['ativo'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
