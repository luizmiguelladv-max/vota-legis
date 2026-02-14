import type { HttpContext } from '@adonisjs/core/http'

export default class RondasController {
    /**
     * Lista funcionarios com presenca configurada
     */
    async funcionarios({ response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            const result = await dbManager.queryMunicipio(municipioId, `
                SELECT f.id, f.nome, f.intervalo_presenca, l.nome as lotacao
                FROM funcionarios f
                LEFT JOIN lotacoes l ON l.id = f.lotacao_id
                WHERE f.intervalo_presenca IS NOT NULL
                  AND f.intervalo_presenca > 0
                  AND f.ativo = true
                ORDER BY f.nome
            `, [])

            return response.json({
                funcionarios: result
            })
        } catch (error: any) {
            console.error('[Rondas] Erro ao listar funcionarios:', error)
            return response.status(500).json({ error: 'Erro interno', funcionarios: [] })
        }
    }

    /**
     * Lista rondas com filtros
     */
    async index({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            const funcionarioId = request.input('funcionario_id')
            const dataInicio = request.input('data_inicio')
            const dataFim = request.input('data_fim')
            const status = request.input('status')

            let where = 'WHERE f.intervalo_presenca IS NOT NULL AND f.intervalo_presenca > 0'
            const params: any[] = []
            let paramIndex = 1

            if (funcionarioId) {
                where += ` AND rp.funcionario_id = $${paramIndex++}`
                params.push(funcionarioId)
            }

            if (dataInicio) {
                where += ` AND rp.data_hora::date >= $${paramIndex++}`
                params.push(dataInicio)
            }

            if (dataFim) {
                where += ` AND rp.data_hora::date <= $${paramIndex++}`
                params.push(dataFim)
            }

            // Query principal
            const result = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    rp.id,
                    rp.funcionario_id,
                    f.nome as funcionario_nome,
                    l.nome as lotacao,
                    f.intervalo_presenca,
                    rp.data_hora,
                    rp.latitude,
                    rp.longitude,
                    rp.foto_registro,
                    CASE
                        WHEN LAG(rp.data_hora) OVER (PARTITION BY rp.funcionario_id ORDER BY rp.data_hora) IS NULL THEN 'em_dia'
                        WHEN EXTRACT(EPOCH FROM (rp.data_hora - LAG(rp.data_hora) OVER (PARTITION BY rp.funcionario_id ORDER BY rp.data_hora))) / 60 > f.intervalo_presenca + 2 THEN 'atrasado'
                        ELSE 'em_dia'
                    END as status
                FROM registros_presenca rp
                INNER JOIN funcionarios f ON f.id = rp.funcionario_id
                LEFT JOIN lotacoes l ON l.id = f.lotacao_id
                ${where}
                ORDER BY rp.data_hora DESC
                LIMIT 500
            `, params)

            // Filtra por status se necessario
            let rondas = result
            if (status) {
                rondas = result.filter((r: any) => r.status === status)
            }

            // Resumo
            const hoje = new Date().toISOString().split('T')[0]
            const rondasHoje = result.filter((r: any) =>
                new Date(r.data_hora).toISOString().split('T')[0] === hoje
            )

            const resumo = {
                total_hoje: rondasHoje.length,
                em_dia: rondasHoje.filter((r: any) => r.status === 'em_dia').length,
                atrasados: rondasHoje.filter((r: any) => r.status === 'atrasado').length
            }

            return response.json({
                rondas,
                resumo,
                total: rondas.length
            })
        } catch (error: any) {
            console.error('[Rondas] Erro ao listar:', error)
            return response.status(500).json({ error: 'Erro interno', rondas: [], resumo: {} })
        }
    }

    /**
     * Historico de um funcionario
     */
    async historico({ params, request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1
            const funcionarioId = params.id

            const dataInicio = request.input('data_inicio')
            const dataFim = request.input('data_fim')

            let where = 'WHERE rp.funcionario_id = $1'
            const queryParams: any[] = [funcionarioId]
            let paramIndex = 2

            if (dataInicio) {
                where += ` AND rp.data_hora::date >= $${paramIndex++}`
                queryParams.push(dataInicio)
            }

            if (dataFim) {
                where += ` AND rp.data_hora::date <= $${paramIndex++}`
                queryParams.push(dataFim)
            }

            // Busca intervalo do funcionario
            const funcResult = await dbManager.queryMunicipio(municipioId, `
                SELECT intervalo_presenca FROM funcionarios WHERE id = $1
            `, [funcionarioId])

            const intervalo = funcResult[0]?.intervalo_presenca || 30

            // Busca presencas
            const result = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    rp.id,
                    rp.data_hora,
                    rp.latitude,
                    rp.longitude,
                    CASE
                        WHEN LAG(rp.data_hora) OVER (ORDER BY rp.data_hora) IS NULL THEN 'em_dia'
                        WHEN EXTRACT(EPOCH FROM (rp.data_hora - LAG(rp.data_hora) OVER (ORDER BY rp.data_hora))) / 60 > $${paramIndex} + 2 THEN 'atrasado'
                        ELSE 'em_dia'
                    END as status
                FROM registros_presenca rp
                ${where}
                ORDER BY rp.data_hora DESC
                LIMIT 100
            `, [...queryParams, intervalo])

            const presencas = result

            const resumo = {
                total: presencas.length,
                em_dia: presencas.filter((p: any) => p.status === 'em_dia').length,
                atrasados: presencas.filter((p: any) => p.status === 'atrasado').length
            }

            return response.json({
                presencas,
                resumo,
                intervalo_presenca: intervalo
            })
        } catch (error: any) {
            console.error('[Rondas] Erro ao buscar historico:', error)
            return response.status(500).json({ error: 'Erro interno', presencas: [], resumo: {} })
        }
    }

    /**
     * Exportar rondas em CSV
     */
    async exportar({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            const funcionarioId = request.input('funcionario_id')
            const dataInicio = request.input('data_inicio')
            const dataFim = request.input('data_fim')

            let where = 'WHERE f.intervalo_presenca IS NOT NULL'
            const params: any[] = []
            let paramIndex = 1

            if (funcionarioId) {
                where += ` AND rp.funcionario_id = $${paramIndex++}`
                params.push(funcionarioId)
            }

            if (dataInicio) {
                where += ` AND rp.data_hora::date >= $${paramIndex++}`
                params.push(dataInicio)
            }

            if (dataFim) {
                where += ` AND rp.data_hora::date <= $${paramIndex++}`
                params.push(dataFim)
            }

            const result = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    f.nome as funcionario,
                    l.nome as lotacao,
                    f.intervalo_presenca,
                    rp.data_hora,
                    rp.latitude,
                    rp.longitude,
                    CASE
                        WHEN LAG(rp.data_hora) OVER (PARTITION BY rp.funcionario_id ORDER BY rp.data_hora) IS NULL THEN 'Em Dia'
                        WHEN EXTRACT(EPOCH FROM (rp.data_hora - LAG(rp.data_hora) OVER (PARTITION BY rp.funcionario_id ORDER BY rp.data_hora))) / 60 > f.intervalo_presenca + 2 THEN 'Atrasado'
                        ELSE 'Em Dia'
                    END as status
                FROM registros_presenca rp
                INNER JOIN funcionarios f ON f.id = rp.funcionario_id
                LEFT JOIN lotacoes l ON l.id = f.lotacao_id
                ${where}
                ORDER BY rp.data_hora DESC
            `, params)

            // Gera CSV
            const header = 'Funcionario;Lotacao;Intervalo (min);Data/Hora;Latitude;Longitude;Status\n'
            const rows = result.map((r: any) => {
                const dataHora = new Date(r.data_hora).toLocaleString('pt-BR')
                return `${r.funcionario};${r.lotacao || ''};${r.intervalo_presenca};${dataHora};${r.latitude || ''};${r.longitude || ''};${r.status}`
            }).join('\n')

            const csv = header + rows

            response.header('Content-Type', 'text/csv; charset=utf-8')
            response.header('Content-Disposition', `attachment; filename=rondas_${dataInicio || 'todos'}_${dataFim || 'todos'}.csv`)

            return response.send(csv)
        } catch (error: any) {
            console.error('[Rondas] Erro ao exportar:', error)
            return response.status(500).json({ error: 'Erro ao exportar' })
        }
    }
}
