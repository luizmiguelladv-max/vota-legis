import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'logs_operacoes'

  async up() {
    if (await this.schema.hasTable(this.tableName)) {
      return
    }

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Relacionamentos
      table.integer('municipio_id').unsigned().nullable().references('id').inTable('municipios')
      table.integer('usuario_master_id').unsigned().nullable().references('id').inTable('usuarios_master')

      // Dados da operação
      table
        .enum('operacao', ['CRIAR_BANCO', 'MIGRATION', 'BACKUP', 'RESTORE', 'SINCRONIZACAO', 'CONFIGURACAO'])
        .notNullable()
      table.enum('status', ['INICIADO', 'SUCESSO', 'ERRO']).notNullable()
      table.jsonb('detalhes').nullable()

      // Timestamp
      table.timestamp('created_at', { useTz: true }).notNullable()

      // Índices
      table.index(['municipio_id'])
      table.index(['operacao'])
      table.index(['status'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
