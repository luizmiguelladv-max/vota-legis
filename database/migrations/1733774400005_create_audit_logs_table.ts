import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    if (await this.schema.hasTable(this.tableName)) {
      return
    }

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Identificação do usuário
      table.integer('usuario_id').unsigned().nullable()
      table.string('usuario_tipo', 20).nullable() // 'master' ou 'municipal'

      // Dados da ação
      table.string('acao', 50).notNullable()
      table.string('tabela', 100).nullable()
      table.integer('registro_id').unsigned().nullable()

      // Dados alterados
      table.jsonb('dados_anteriores').nullable()
      table.jsonb('dados_novos').nullable()

      // Metadados da requisição
      table.string('ip', 45).nullable()
      table.text('user_agent').nullable()

      // Timestamp
      table.timestamp('created_at', { useTz: true }).notNullable()

      // Índices
      table.index(['usuario_id'])
      table.index(['acao'])
      table.index(['tabela'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
