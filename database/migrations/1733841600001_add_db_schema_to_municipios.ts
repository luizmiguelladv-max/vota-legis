import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'municipios'

  async up() {
    if (!(await this.schema.hasTable(this.tableName))) {
      return
    }

    // Evita falhar em DBs antigos (coluna ja existente).
    if (await this.schema.hasColumn(this.tableName, 'db_schema')) {
      return
    }

    this.schema.alterTable(this.tableName, (table) => {
      table.string('db_schema', 100).nullable().after('db_password')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('db_schema')
    })
  }
}
