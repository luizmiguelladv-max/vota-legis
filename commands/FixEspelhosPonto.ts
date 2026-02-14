import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { Pool, PoolConfig } from 'pg'

/**
 * Comando para corrigir a tabela espelhos_ponto em todos os schemas de município.
 * Adiciona a coluna 'dias_trabalhados' se não existir.
 */
export default class FixEspelhosPonto extends BaseCommand {
    static commandName = 'fix:espelhos_ponto'
    static description = 'Adiciona coluna dias_trabalhados na tabela espelhos_ponto de todos os tenants'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Iniciando correção da tabela espelhos_ponto...')

        // Cria pool de conexão
        const poolConfig: PoolConfig = {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_DATABASE,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        }

        const pool = new Pool(poolConfig)

        try {
            // Busca todos os municípios ativos
            const municipiosResult = await pool.query(`
        SELECT id, nome, db_schema, slug 
        FROM municipios 
        WHERE ativo = true
      `)

            const municipios = municipiosResult.rows
            this.logger.info(`Encontrados ${municipios.length} município(s) ativo(s)`)

            for (const municipio of municipios) {
                const schema = municipio.db_schema || municipio.slug?.replace(/-/g, '_') || 'public'
                this.logger.info(`Processando: ${municipio.nome} (schema: ${schema})`)

                try {
                    // Verifica se a coluna existe
                    const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = $1 
              AND table_name = 'espelhos_ponto' 
              AND column_name = 'dias_trabalhados'
          `, [schema])

                    if (columnCheck.rows.length === 0) {
                        // Coluna não existe, adiciona
                        await pool.query(`
              ALTER TABLE ${schema}.espelhos_ponto 
              ADD COLUMN IF NOT EXISTS dias_trabalhados INTEGER DEFAULT 0
            `)
                        this.logger.success(`✅ Coluna 'dias_trabalhados' adicionada em ${schema}.espelhos_ponto`)
                    } else {
                        this.logger.info(`⏭️  Coluna já existe em ${schema}.espelhos_ponto`)
                    }
                } catch (err) {
                    this.logger.error(`❌ Erro ao processar ${municipio.nome}: ${err}`)
                }
            }

            this.logger.success('Correção concluída!')
        } catch (err) {
            this.logger.error(`Erro geral: ${err}`)
        } finally {
            await pool.end()
        }
    }
}
