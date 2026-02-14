import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'municipios'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('db_schema', 100).nullable().after('db_password')
    })

    // Atualiza o município de Santo André com o schema correto
    this.defer(async (db) => {
      await db.rawQuery(`
        UPDATE municipios 
        SET db_schema = 'santo_andre' 
        WHERE slug = 'santo-andre' OR codigo_ibge = '2513851'
      `)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('db_schema')
    })
  }
}
