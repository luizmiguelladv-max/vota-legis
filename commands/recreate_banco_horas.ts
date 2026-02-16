import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class RecreateBancoHoras extends BaseCommand {
    static commandName = 'db:recreate_banco_horas'
    static description = 'Recria tabela banco_horas com estrutura completa'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Recriando tabela banco_horas...')

        try {
            const sqlPath = join(process.cwd(), 'database', 'migrations', 'tenant', '005_recreate_banco_horas.sql')
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
            this.logger.success('Tabela banco_horas recriada com sucesso!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
