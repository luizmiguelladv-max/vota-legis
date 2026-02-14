import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

export default class DebugMunicipios extends BaseCommand {
    static commandName = 'db:debug_municipios'
    static description = 'Debug estrutura municipios'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('=== DEBUG MUNICIPIOS ===\n')

        try {
            // 1. Listar colunas da tabela municipios
            const columns = await db.rawQuery(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'municipios'
        ORDER BY ordinal_position
      `)

            this.logger.info('Colunas da tabela municipios:')
            for (const col of columns.rows) {
                this.logger.info(`  - ${col.column_name}: ${col.data_type}`)
            }

            // 2. Listar dados do município
            const municipios = await db.rawQuery('SELECT * FROM municipios WHERE ativo = true LIMIT 5')

            this.logger.info('\nDados dos municípios:')
            for (const mun of municipios.rows) {
                this.logger.info(JSON.stringify(mun, null, 2))
            }

            // 3. Listar schemas existentes
            const schemas = await db.rawQuery(`
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY schema_name
      `)

            this.logger.info('\nSchemas existentes:')
            for (const s of schemas.rows) {
                this.logger.info(`  - ${s.schema_name}`)
            }

        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
