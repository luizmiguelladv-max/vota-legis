import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

export default class DebugBancoHoras extends BaseCommand {
    static commandName = 'db:debug_banco_horas'
    static description = 'Debug completo da tabela banco_horas'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('=== DEBUG BANCO DE HORAS ===\n')

        try {
            // 1. Listar municípios
            const municipios = await db.from('municipios').where('ativo', true)
            this.logger.info(`Municípios ativos: ${municipios.length}`)

            for (const mun of municipios) {
                this.logger.info(`\n=== MUNICÍPIO: ${mun.nome} (schema: ${mun.schema_db}) ===`)

                // 2. Verificar se schema existe
                const schemaExists = await db.rawQuery(`
          SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${mun.schema_db}'
        `)
                this.logger.info(`Schema existe: ${schemaExists.rows.length > 0}`)

                if (schemaExists.rows.length === 0) {
                    this.logger.error(`Schema ${mun.schema_db} NÃO EXISTE!`)
                    continue
                }

                // 3. Verificar se tabela banco_horas existe
                const tableExists = await db.rawQuery(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = '${mun.schema_db}' 
          AND table_name = 'banco_horas'
        `)
                this.logger.info(`Tabela banco_horas existe: ${tableExists.rows.length > 0}`)

                if (tableExists.rows.length === 0) {
                    this.logger.error(`Tabela banco_horas NÃO EXISTE no schema ${mun.schema_db}!`)

                    // Tentar criar a tabela
                    this.logger.info('Tentando criar tabela...')
                    await db.rawQuery(`SET search_path TO ${mun.schema_db}, public`)
                    await db.rawQuery(`
            CREATE TABLE IF NOT EXISTS banco_horas (
              id SERIAL PRIMARY KEY,
              funcionario_id INTEGER NOT NULL,
              data DATE NOT NULL,
              tipo_operacao VARCHAR(20) NOT NULL,
              minutos INTEGER NOT NULL,
              saldo_anterior INTEGER DEFAULT 0,
              saldo_atual INTEGER DEFAULT 0,
              origem VARCHAR(30) DEFAULT 'MANUAL',
              descricao TEXT,
              observacao TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
          `)
                    this.logger.success(`Tabela criada!`)
                    continue
                }

                // 4. Listar colunas da tabela
                const columns = await db.rawQuery(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_schema = '${mun.schema_db}' 
          AND table_name = 'banco_horas'
          ORDER BY ordinal_position
        `)

                this.logger.info(`\nColunas da tabela banco_horas:`)
                for (const col of columns.rows) {
                    this.logger.info(`  - ${col.column_name}: ${col.data_type}`)
                }

                // 5. Verificar se tipo_operacao existe
                const hasTipoOperacao = columns.rows.some((c: any) => c.column_name === 'tipo_operacao')
                if (!hasTipoOperacao) {
                    this.logger.error(`\nCOLUNA tipo_operacao NÃO EXISTE!`)

                    // DROP e RECREATE
                    this.logger.info('Dropando e recriando tabela...')
                    await db.rawQuery(`SET search_path TO ${mun.schema_db}, public`)
                    await db.rawQuery(`DROP TABLE IF EXISTS banco_horas CASCADE`)
                    await db.rawQuery(`
            CREATE TABLE banco_horas (
              id SERIAL PRIMARY KEY,
              funcionario_id INTEGER NOT NULL,
              data DATE NOT NULL,
              tipo_operacao VARCHAR(20) NOT NULL,
              minutos INTEGER NOT NULL,
              saldo_anterior INTEGER DEFAULT 0,
              saldo_atual INTEGER DEFAULT 0,
              origem VARCHAR(30) DEFAULT 'MANUAL',
              descricao TEXT,
              observacao TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
          `)
                    this.logger.success(`Tabela recriada com sucesso!`)

                    // Verificar novamente
                    const newColumns = await db.rawQuery(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = '${mun.schema_db}' AND table_name = 'banco_horas'
          `)
                    this.logger.info(`Novas colunas: ${newColumns.rows.map((c: any) => c.column_name).join(', ')}`)
                } else {
                    this.logger.success(`Coluna tipo_operacao EXISTE!`)
                }
            }

            await db.rawQuery('SET search_path TO public')
            this.logger.info('\n=== DEBUG CONCLUÍDO ===')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
            this.logger.error(error.stack)
        }
    }
}
