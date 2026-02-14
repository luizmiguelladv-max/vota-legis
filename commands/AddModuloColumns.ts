import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { Pool, PoolConfig } from 'pg'

/**
 * Comando para adicionar colunas de módulos na tabela municipios.
 * Adiciona: modulo_facial, modulo_digital, sync_interval_segundos
 */
export default class AddModuloColumns extends BaseCommand {
    static commandName = 'db:add_modulo_columns'
    static description = 'Adiciona colunas de módulos na tabela municipios'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Adicionando colunas de módulos na tabela municipios...')

        const poolConfig: PoolConfig = {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_DATABASE,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        }

        const pool = new Pool(poolConfig)

        try {
            // Adiciona coluna modulo_facial
            await pool.query(`
        ALTER TABLE public.municipios 
        ADD COLUMN IF NOT EXISTS modulo_facial BOOLEAN DEFAULT true
      `)
            this.logger.success('✅ Coluna modulo_facial adicionada')

            // Adiciona coluna modulo_digital
            await pool.query(`
        ALTER TABLE public.municipios 
        ADD COLUMN IF NOT EXISTS modulo_digital BOOLEAN DEFAULT true
      `)
            this.logger.success('✅ Coluna modulo_digital adicionada')

            // Adiciona coluna sync_interval_segundos
            await pool.query(`
        ALTER TABLE public.municipios 
        ADD COLUMN IF NOT EXISTS sync_interval_segundos INTEGER DEFAULT 30
      `)
            this.logger.success('✅ Coluna sync_interval_segundos adicionada')

            this.logger.success('Todas as colunas foram adicionadas com sucesso!')
        } catch (err) {
            this.logger.error(`Erro: ${err}`)
        } finally {
            await pool.end()
        }
    }
}
