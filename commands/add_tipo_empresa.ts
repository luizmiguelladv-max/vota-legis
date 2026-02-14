import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default class AddTipoEmpresa extends BaseCommand {
    static commandName = 'db:add_tipo_empresa'
    static description = 'Adiciona campos de tipo de empresa (público/privado)'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('Adicionando campos de tipo de empresa...')

        try {
            // Migration pública (tabela municipios)
            const sqlPublic = await readFile(
                join(process.cwd(), 'database', 'migrations', 'public', '009_tipo_empresa.sql'),
                'utf-8'
            )
            await db.rawQuery(sqlPublic)
            this.logger.success('✓ Campos adicionados à tabela municipios')

            // Migration tenant (tabela funcionarios)
            const sqlTenant = await readFile(
                join(process.cwd(), 'database', 'migrations', 'tenant', '009_tipos_vinculo.sql'),
                'utf-8'
            )

            const municipios = await db.from('municipios').where('ativo', true)

            for (const municipio of municipios) {
                const schema = municipio.db_schema || municipio.slug
                if (!schema) continue

                try {
                    await db.rawQuery(`SET search_path TO "${schema}", public`)
                    await db.rawQuery(sqlTenant)
                    this.logger.success(`✓ ${municipio.nome}`)
                } catch (error: any) {
                    this.logger.warning(`⚠ ${municipio.nome}: ${error.message}`)
                }
            }

            await db.rawQuery('SET search_path TO public')
            this.logger.success('Tipo de empresa configurado com sucesso!')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
