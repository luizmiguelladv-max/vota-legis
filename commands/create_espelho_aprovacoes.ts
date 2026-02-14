import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class CreateEspelhoAprovacoes extends BaseCommand {
    static commandName = 'db:create_espelho_aprovacoes'
    static description = 'Cria tabelas de aprovação de espelho'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Criando tabelas de aprovação de espelho...')

        try {
            const sqlPath = join(process.cwd(), 'database', 'migrations', 'tenant', '008_espelho_aprovacoes.sql')
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
            this.logger.success('Tabelas de aprovação criadas!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
