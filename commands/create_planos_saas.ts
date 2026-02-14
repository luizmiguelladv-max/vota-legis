import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class CreatePlanosSaas extends BaseCommand {
    static commandName = 'db:create_planos_saas'
    static description = 'Cria tabelas de planos, assinaturas e leads'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Criando tabelas de planos SaaS...')

        try {
            const sql = await readFile(
                join(process.cwd(), 'database', 'migrations', 'public', '010_planos_saas.sql'),
                'utf-8'
            )

            await db.rawQuery(sql)
            this.logger.success('✓ Tabelas de planos, assinaturas e leads criadas!')
            this.logger.success('✓ 5 planos padrão inseridos (Starter, Basic, Pro, Business, Enterprise)')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
