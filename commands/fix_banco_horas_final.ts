import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

export default class FixBancoHorasFinal extends BaseCommand {
    static commandName = 'db:fix_banco_horas_final'
    static description = 'Fix final da tabela banco_horas'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        this.logger.info('=== FIX FINAL BANCO DE HORAS ===\n')

        try {
            // Usa db_schema (campo correto!)
            const municipios = await db.from('municipios').where('ativo', true)

            this.logger.info(`Encontrados ${municipios.length} municípios ativos`)

            for (const municipio of municipios) {
                // IMPORTANTE: Campo correto é db_schema, não schema_db!
                const schema = municipio.db_schema || municipio.slug

                if (!schema) {
                    this.logger.error(`Município ${municipio.nome} sem schema definido!`)
                    continue
                }

                this.logger.info(`\nProcessando: ${municipio.nome} (schema: ${schema})`)

                try {
                    // Set search_path
                    await db.rawQuery(`SET search_path TO "${schema}", public`)

                    // Drop tabela se existir
                    this.logger.info('Dropando tabela antiga...')
                    await db.rawQuery(`DROP TABLE IF EXISTS banco_horas CASCADE`)

                    // Criar tabela nova
                    this.logger.info('Criando tabela nova...')
                    await db.rawQuery(`
            CREATE TABLE banco_horas (
              id SERIAL PRIMARY KEY,
              funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
              data DATE NOT NULL,
              tipo_operacao VARCHAR(20) NOT NULL 
                CHECK (tipo_operacao IN ('CREDITO', 'DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO', 'AJUSTE')),
              minutos INTEGER NOT NULL,
              saldo_anterior INTEGER DEFAULT 0,
              saldo_atual INTEGER DEFAULT 0,
              origem VARCHAR(30) DEFAULT 'MANUAL' 
                CHECK (origem IN ('AUTOMATICO', 'MANUAL', 'IMPORTACAO')),
              descricao TEXT,
              observacao TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
          `)

                    // Criar índices
                    await db.rawQuery(`CREATE INDEX idx_banco_horas_funcionario ON banco_horas(funcionario_id)`)
                    await db.rawQuery(`CREATE INDEX idx_banco_horas_data ON banco_horas(data)`)
                    await db.rawQuery(`CREATE INDEX idx_banco_horas_tipo ON banco_horas(tipo_operacao)`)

                    // Verificar
                    const columns = await db.rawQuery(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = '${schema}' AND table_name = 'banco_horas'
          `)

                    this.logger.success(`✓ ${municipio.nome} - Colunas: ${columns.rows.map((c: any) => c.column_name).join(', ')}`)
                } catch (error: any) {
                    this.logger.error(`✗ ${municipio.nome}: ${error.message}`)
                }
            }

            await db.rawQuery('SET search_path TO public')
            this.logger.success('\n=== FIX CONCLUÍDO COM SUCESSO! ===')
        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
            this.logger.error(error.stack)
        }
    }
}
