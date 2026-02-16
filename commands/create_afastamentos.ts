import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class CreateAfastamentos extends BaseCommand {
    static commandName = 'db:create_afastamentos'
    static description = 'Cria tabelas de afastamentos'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Criando tabelas de afastamentos...')

        try {
            const sqlPath = join(process.cwd(), 'database', 'migrations', 'tenant', '007_afastamentos.sql')
            const sql = await readFile(sqlPath, 'utf-8')

            const municipios = await db.from('municipios').where('ativo', true)

            for (const municipio of municipios) {
                const schema = municipio.db_schema || municipio.slug
                if (!schema) continue

                try {
                    await db.rawQuery(`SET search_path TO "${schema}", public`)
                    await db.rawQuery(sql)
                    this.logger.success(`✓ ${municipio.nome}`)
                } catch (error: any) {
                    this.logger.error(`✗ ${municipio.nome}: ${error.message}`)
                }
            }

            await db.rawQuery('SET search_path TO public')
            this.logger.success('Tabelas de afastamentos criadas!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
