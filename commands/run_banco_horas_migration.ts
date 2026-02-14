import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class RunBancoHorasMigration extends BaseCommand {
    static commandName = 'db:banco_horas'
    static description = 'Executa migration de banco de horas e configuração de tenant em todos os municípios'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Executando migration de banco de horas e configuração...')

        try {
            // Lê o arquivo SQL
            const sqlPath = join(process.cwd(), 'database', 'migrations', 'tenant', '002_banco_horas_e_config.sql')
            const sql = await readFile(sqlPath, 'utf-8')

            // Busca todos os municípios ativos
            const municipios = await db.from('municipios').where('ativo', true)

            this.logger.info(`Encontrados ${municipios.length} municípios ativos`)

            for (const municipio of municipios) {
                const schema = municipio.schema_db
                if (!schema) continue

                this.logger.info(`Processando: ${municipio.nome} (${schema})`)

                try {
                    // Define o search_path para o schema do município
                    await db.rawQuery(`SET search_path TO ${schema}, public`)

                    // Executa o SQL
                    await db.rawQuery(sql)

                    this.logger.success(`✓ ${municipio.nome}`)
                } catch (error: any) {
                    this.logger.error(`✗ ${municipio.nome}: ${error.message}`)
                }
            }

            // Volta para o schema public
            await db.rawQuery('SET search_path TO public')

            this.logger.success('Migration concluída!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
