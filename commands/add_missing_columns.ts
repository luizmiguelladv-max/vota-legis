import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class AddMissingColumns extends BaseCommand {
    static commandName = 'db:add_missing_columns'
    static description = 'Adiciona colunas faltantes na tabela banco_horas'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Adicionando colunas faltantes...')

        try {
            const sqlPath = join(process.cwd(), 'database', 'migrations', 'tenant', '004_add_missing_columns.sql')
            const sql = await readFile(sqlPath, 'utf-8')

            const municipios = await db.from('municipios').where('ativo', true)

            this.logger.info(`Encontrados ${municipios.length} municípios ativos`)

            for (const municipio of municipios) {
                const schema = municipio.schema_db
                if (!schema) continue

                this.logger.info(`Processando: ${municipio.nome} (${schema})`)

                try {
                    await db.rawQuery(`SET search_path TO ${schema}, public`)
                    await db.rawQuery(sql)
                    this.logger.success(`✓ ${municipio.nome}`)
                } catch (error: any) {
                    this.logger.error(`✗ ${municipio.nome}: ${error.message}`)
                }
            }

            await db.rawQuery('SET search_path TO public')
            this.logger.success('Colunas adicionadas!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
