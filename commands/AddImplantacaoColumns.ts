import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import { Pool } from 'pg'

export default class AddImplantacaoColumns extends BaseCommand {
    static commandName = 'db:add_implantacao_columns'
    static description = 'Adiciona colunas de data_inicio_sistema e modo_manutencao na tabela municipios'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Iniciando adição de colunas de implantação...')

        try {
            // 1. Atualiza tabela municipios no public
            this.logger.info('Atualizando tabela public.municipios...')

            await db.rawQuery(`
        ALTER TABLE public.municipios
        ADD COLUMN IF NOT EXISTS data_inicio_sistema DATE DEFAULT NULL;
      `)

            await db.rawQuery(`
        ALTER TABLE public.municipios
        ADD COLUMN IF NOT EXISTS modo_manutencao BOOLEAN DEFAULT false;
      `)

            await db.rawQuery(`
        ALTER TABLE public.municipios
        ADD COLUMN IF NOT EXISTS mensagem_manutencao TEXT DEFAULT NULL;
      `)

            this.logger.success('Colunas adicionadas na tabela public.municipios!')

            // 2. Lista municípios
            const municipios = await db.from('public.municipios').select('*')
            this.logger.info(`Encontrados ${municipios.length} município(s)`)

            // 3. Para cada município, atualiza schema do tenant (se aplicável)
            for (const municipio of municipios) {
                if (!municipio.db_host || !municipio.db_name) {
                    this.logger.warning(`Município ${municipio.nome}: Sem conexão de banco configurada, pulando.`)
                    continue
                }

                try {
                    const pool = new Pool({
                        host: municipio.db_host,
                        port: municipio.db_port || 5432,
                        database: municipio.db_name,
                        user: municipio.db_user,
                        password: municipio.db_password,
                        ssl: { rejectUnauthorized: false },
                    })

                    const schema = municipio.db_schema || 'public'

                    // Adiciona coluna gerar_espelho na tabela funcionarios (para poder excluir de espelhos)
                    await pool.query(`
            ALTER TABLE ${schema}.funcionarios
            ADD COLUMN IF NOT EXISTS gerar_espelho BOOLEAN DEFAULT true;
          `)

                    // Adiciona comentário
                    await pool.query(`
            COMMENT ON COLUMN ${schema}.funcionarios.gerar_espelho IS 'Se false, não gera espelho de ponto para este funcionário';
          `)

                    await pool.end()
                    this.logger.success(`Município ${municipio.nome}: Coluna gerar_espelho adicionada!`)
                } catch (error: any) {
                    this.logger.error(`Município ${municipio.nome}: Erro - ${error.message}`)
                }
            }

            this.logger.success('Processo concluído!')
            this.logger.info('')
            this.logger.info('Campos adicionados:')
            this.logger.info('  - municipios.data_inicio_sistema: Data a partir da qual o sistema contabiliza ponto')
            this.logger.info('  - municipios.modo_manutencao: Se true, sistema fica em modo de teste')
            this.logger.info('  - municipios.mensagem_manutencao: Mensagem a exibir quando em manutenção')
            this.logger.info('  - funcionarios.gerar_espelho: Se false, não gera espelho para este funcionário')

        } catch (error: any) {
            this.logger.error(`Erro: ${error.message}`)
        }
    }
}
