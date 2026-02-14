import type { HttpContext } from '@adonisjs/core/http'

export default class AnomaliasController {
    /**
     * Lista anomalias de ponto (registros inconsistentes)
     * Considera a jornada do funcionário para detectar registros faltantes
     */
    async index({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            const dataInicio = request.input('data_inicio')
            const dataFim = request.input('data_fim')
            const funcionarioId = request.input('funcionario_id')
            const tipoAnomalia = request.input('tipo')
            const status = request.input('status', 'pendente')

            let whereDate = ''
            const params: any[] = []
            let paramIndex = 1

            if (dataInicio) {
                whereDate += ` AND DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') >= $${paramIndex++}`
                params.push(dataInicio)
            }
            if (dataFim) {
                whereDate += ` AND DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') <= $${paramIndex++}`
                params.push(dataFim)
            }
            if (funcionarioId) {
                whereDate += ` AND rp.funcionario_id = $${paramIndex++}`
                params.push(funcionarioId)
            }

            // Query para detectar anomalias
            const result = await dbManager.queryMunicipio(municipioId, `
                WITH registros_ordenados AS (
                    SELECT
                        rp.id,
                        rp.funcionario_id,
                        f.nome as funcionario_nome,
                        f.matricula,
                        l.nome as lotacao,
                        rp.data_hora,
                        rp.tipo,
                        DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') as data,
                        LAG(rp.tipo) OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as tipo_anterior,
                        LAG(rp.data_hora) OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as hora_anterior,
                        LAG(rp.id) OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as id_anterior,
                        ROW_NUMBER() OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as seq
                    FROM registros_ponto rp
                    INNER JOIN funcionarios f ON f.id = rp.funcionario_id
                    LEFT JOIN lotacoes l ON l.id = f.lotacao_id
                    WHERE f.ativo = true ${whereDate}
                ),
                anomalias AS (
                    SELECT
                        id,
                        funcionario_id,
                        funcionario_nome,
                        matricula,
                        lotacao,
                        data_hora,
                        tipo,
                        data,
                        tipo_anterior,
                        hora_anterior,
                        id_anterior,
                        seq,
                        CASE
                            WHEN tipo = tipo_anterior THEN 'DUPLICADO'
                            WHEN tipo = 'SAIDA' AND seq = 1 THEN 'SAIDA_SEM_ENTRADA'
                            WHEN tipo = 'ENTRADA' AND tipo_anterior = 'ENTRADA' THEN 'ENTRADA_DUPLICADA'
                            WHEN tipo = 'SAIDA' AND tipo_anterior = 'SAIDA' THEN 'SAIDA_DUPLICADA'
                            ELSE NULL
                        END as tipo_anomalia
                    FROM registros_ordenados
                )
                SELECT
                    id,
                    funcionario_id,
                    funcionario_nome,
                    matricula,
                    lotacao,
                    data_hora,
                    tipo,
                    data,
                    tipo_anomalia,
                    hora_anterior,
                    id_anterior
                FROM anomalias
                WHERE tipo_anomalia IS NOT NULL
                ORDER BY data_hora DESC
                LIMIT 200
            `, params)

            // Filtra por tipo se especificado
            let anomalias = result
            if (tipoAnomalia && tipoAnomalia !== 'FALTA_REGISTRO') {
                anomalias = result.filter((a: any) => a.tipo_anomalia === tipoAnomalia)
            }

            // Detecta registros faltantes baseado na jornada
            if (!tipoAnomalia || tipoAnomalia === 'FALTA_REGISTRO') {
                const faltasJornada = await this.detectarFaltasJornada(dbManager, municipioId, dataInicio, dataFim, funcionarioId)
                if (!tipoAnomalia) {
                    anomalias = [...anomalias, ...faltasJornada]
                } else {
                    anomalias = faltasJornada
                }
            }

            // Busca anomalias já resolvidas/ignoradas da tabela de controle
            let anomaliasResolvidas: any[] = []
            try {
                const resolvidasResult = await dbManager.queryMunicipio(municipioId, `
                    SELECT registro_id, status, observacao, resolvido_por, resolvido_em
                    FROM anomalias_resolvidas
                    WHERE registro_id = ANY($1::int[])
                `, [anomalias.map((a: any) => a.id)])
                anomaliasResolvidas = resolvidasResult
            } catch {
                // Tabela pode não existir ainda
            }

            // Mapeia status
            const resolvidasMap = new Map(anomaliasResolvidas.map((r: any) => [r.registro_id, r]))

            const anomaliasComStatus = anomalias.map((a: any) => {
                const resolvida = resolvidasMap.get(a.id)
                return {
                    ...a,
                    status: resolvida?.status || 'pendente',
                    observacao_resolucao: resolvida?.observacao,
                    resolvido_por: resolvida?.resolvido_por,
                    resolvido_em: resolvida?.resolvido_em
                }
            })

            // Filtra por status
            const anomaliasFiltradas = status === 'todos'
                ? anomaliasComStatus
                : anomaliasComStatus.filter((a: any) => a.status === status)

            // Resumo
            const resumo = {
                total: anomaliasComStatus.length,
                pendentes: anomaliasComStatus.filter((a: any) => a.status === 'pendente').length,
                resolvidas: anomaliasComStatus.filter((a: any) => a.status === 'resolvida').length,
                ignoradas: anomaliasComStatus.filter((a: any) => a.status === 'ignorada').length,
                entrada_duplicada: anomaliasComStatus.filter((a: any) => a.tipo_anomalia === 'ENTRADA_DUPLICADA').length,
                saida_duplicada: anomaliasComStatus.filter((a: any) => a.tipo_anomalia === 'SAIDA_DUPLICADA').length,
                saida_sem_entrada: anomaliasComStatus.filter((a: any) => a.tipo_anomalia === 'SAIDA_SEM_ENTRADA').length
            }

            return response.json({
                anomalias: anomaliasFiltradas,
                resumo
            })
        } catch (error: any) {
            console.error('[Anomalias] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', anomalias: [], resumo: {} })
        }
    }

    /**
     * Resumo de anomalias para dashboard
     */
    async resumo({ response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            // Anomalias dos últimos 7 dias
            const result = await dbManager.queryMunicipio(municipioId, `
                WITH registros_ordenados AS (
                    SELECT
                        rp.id,
                        rp.funcionario_id,
                        rp.tipo,
                        DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') as data,
                        LAG(rp.tipo) OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as tipo_anterior,
                        ROW_NUMBER() OVER (PARTITION BY rp.funcionario_id, DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') ORDER BY rp.data_hora) as seq
                    FROM registros_ponto rp
                    INNER JOIN funcionarios f ON f.id = rp.funcionario_id
                    WHERE f.ativo = true
                      AND rp.data_hora >= NOW() - INTERVAL '7 days'
                )
                SELECT COUNT(*) as total
                FROM registros_ordenados
                WHERE (tipo = tipo_anterior)
                   OR (tipo = 'SAIDA' AND seq = 1)
            `, [])

            // Verifica quantas estão pendentes (não resolvidas)
            let pendentes = parseInt(result[0]?.total || '0')
            try {
                const resolvidasResult = await dbManager.queryMunicipio(municipioId, `
                    SELECT COUNT(*) as total
                    FROM anomalias_resolvidas
                    WHERE resolvido_em >= NOW() - INTERVAL '7 days'
                `, [])
                pendentes = Math.max(0, pendentes - parseInt(resolvidasResult[0]?.total || '0'))
            } catch {
                // Tabela pode não existir
            }

            return response.json({
                pendentes,
                periodo: '7 dias'
            })
        } catch (error: any) {
            console.error('[Anomalias Resumo] Erro:', error)
            return response.json({ pendentes: 0, periodo: '7 dias' })
        }
    }

    /**
     * Adicionar registro faltante (correção manual)
     */
    async adicionarRegistro({ request, response, session, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1
            const userId = session.get('user_id') || session.get('admin_id')

            const funcionarioId = request.input('funcionario_id')
            const tipo = request.input('tipo') // ENTRADA ou SAIDA
            const dataHora = request.input('data_hora')
            const observacao = request.input('observacao')

            if (!funcionarioId || !tipo || !dataHora) {
                return response.status(400).json({ error: 'Dados incompletos' })
            }

            // Insere o registro
            const result = await dbManager.queryMunicipio(municipioId, `
                INSERT INTO registros_ponto (funcionario_id, data_hora, tipo, origem, observacao, created_at)
                VALUES ($1, $2, $3, 'CORRECAO_MANUAL', $4, NOW())
                RETURNING id, data_hora, tipo
            `, [funcionarioId, dataHora, tipo, observacao || 'Registro adicionado manualmente'])

            // Registra auditoria
            try {
                await dbManager.queryMunicipio(municipioId, `
                    INSERT INTO audit_logs (usuario_id, acao, tabela, registro_id, dados_novos, created_at)
                    VALUES ($1, 'CORRECAO_PONTO', 'registros_ponto', $2, $3, NOW())
                `, [userId, result[0].id, JSON.stringify({ tipo, data_hora: dataHora, observacao })])
            } catch {
                // Auditoria opcional
            }

            return response.json({
                success: true,
                registro: result[0],
                mensagem: 'Registro adicionado com sucesso'
            })
        } catch (error: any) {
            console.error('[Anomalias AdicionarRegistro] Erro:', error)
            return response.status(500).json({ error: 'Erro ao adicionar registro' })
        }
    }

    /**
     * Resolver/Ignorar anomalia
     */
    async resolver({ request, response, session, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1
            const userId = session.get('user_id') || session.get('admin_id')

            const registroId = request.input('registro_id')
            const status = request.input('status') // 'resolvida' ou 'ignorada'
            const observacao = request.input('observacao')

            if (!registroId || !status) {
                return response.status(400).json({ error: 'Dados incompletos' })
            }

            // Cria tabela se não existir
            try {
                await dbManager.queryMunicipio(municipioId, `
                    CREATE TABLE IF NOT EXISTS anomalias_resolvidas (
                        id SERIAL PRIMARY KEY,
                        registro_id INTEGER NOT NULL,
                        status VARCHAR(20) NOT NULL,
                        observacao TEXT,
                        resolvido_por INTEGER,
                        resolvido_em TIMESTAMPTZ DEFAULT NOW(),
                        UNIQUE(registro_id)
                    )
                `, [])
            } catch {
                // Tabela já existe
            }

            // Insere ou atualiza
            await dbManager.queryMunicipio(municipioId, `
                INSERT INTO anomalias_resolvidas (registro_id, status, observacao, resolvido_por, resolvido_em)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (registro_id) DO UPDATE SET
                    status = $2,
                    observacao = $3,
                    resolvido_por = $4,
                    resolvido_em = NOW()
            `, [registroId, status, observacao, userId])

            return response.json({
                success: true,
                mensagem: status === 'resolvida' ? 'Anomalia marcada como resolvida' : 'Anomalia ignorada'
            })
        } catch (error: any) {
            console.error('[Anomalias Resolver] Erro:', error)
            return response.status(500).json({ error: 'Erro ao resolver anomalia' })
        }
    }

    /**
     * Detecta registros faltantes baseado na jornada do funcionário
     * Analisa se o funcionário deveria ter registrado ponto mas não registrou
     * Considera hora extra: foco em REGISTROS FALTANTES, não em horários específicos
     */
    private async detectarFaltasJornada(
        dbManager: any,
        municipioId: number,
        dataInicio?: string,
        dataFim?: string,
        funcionarioId?: number
    ): Promise<any[]> {
        const anomalias: any[] = []

        try {
            // Define período de análise (últimos 7 dias se não especificado)
            const hoje = new Date()
            const inicio = dataInicio || new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            const fim = dataFim || hoje.toISOString().split('T')[0]

            // Busca funcionários com jornada configurada
            let whereFuncionario = ''

            if (funcionarioId) {
                whereFuncionario = ` AND f.id = $1`
            }

            // Busca funcionários ativos com jornada
            const funcionarios = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    f.id as funcionario_id,
                    f.nome as funcionario_nome,
                    f.matricula,
                    l.nome as lotacao,
                    f.jornada_id
                FROM funcionarios f
                LEFT JOIN lotacoes l ON l.id = f.lotacao_id
                WHERE f.ativo = true
                  AND f.jornada_id IS NOT NULL
                  ${whereFuncionario}
            `, funcionarioId ? [funcionarioId] : [])

            // Para cada funcionário, verifica os dias do período
            for (const func of funcionarios) {
                // Busca horários da jornada
                const jornada = await dbManager.queryMunicipio(municipioId, `
                    SELECT
                        jh.dia_semana,
                        jh.entrada_1,
                        jh.saida_1,
                        jh.entrada_2,
                        jh.saida_2
                    FROM jornada_horarios jh
                    WHERE jh.jornada_id = $1
                `, [func.jornada_id])

                if (jornada.length === 0) continue

                // Cria mapa de dias da semana
                const jornadaMap = new Map(jornada.map((j: any) => [j.dia_semana, j]))

                // Itera pelos dias do período
                const dataAtual = new Date(inicio + 'T00:00:00')
                const dataFinal = new Date(fim + 'T23:59:59')

                while (dataAtual <= dataFinal) {
                    // Não analisa dia de hoje (pode ainda registrar)
                    if (dataAtual.toDateString() === hoje.toDateString()) {
                        dataAtual.setDate(dataAtual.getDate() + 1)
                        continue
                    }

                    const diaSemana = dataAtual.getDay() // 0=Domingo, 1=Segunda, etc
                    const jornadaDia = jornadaMap.get(diaSemana)

                    // Se não tem jornada nesse dia, pula
                    if (!jornadaDia || (!jornadaDia.entrada_1 && !jornadaDia.entrada_2)) {
                        dataAtual.setDate(dataAtual.getDate() + 1)
                        continue
                    }

                    const dataStr = dataAtual.toISOString().split('T')[0]

                    // Busca registros do dia
                    const registros = await dbManager.queryMunicipio(municipioId, `
                        SELECT
                            id,
                            tipo,
                            data_hora,
                            TO_CHAR(data_hora AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') as hora
                        FROM registros_ponto
                        WHERE funcionario_id = $1
                          AND DATE(data_hora AT TIME ZONE 'America/Sao_Paulo') = $2
                        ORDER BY data_hora
                    `, [func.funcionario_id, dataStr])

                    const entradas = registros.filter((r: any) => r.tipo === 'ENTRADA')
                    const saidas = registros.filter((r: any) => r.tipo === 'SAIDA')
                    const totalRegistros = registros.length

                    // Calcula quantos registros deveria ter baseado na jornada
                    // Jornada com intervalo (entrada_2): 4 registros (E1, S1, E2, S2)
                    // Jornada contínua: 2 registros (E1, S1)
                    const temIntervalo = jornadaDia.entrada_2 && jornadaDia.saida_1
                    const registrosEsperados = temIntervalo ? 4 : 2

                    // Se não tem nenhum registro no dia útil, é falta (não anomalia de ponto)
                    // Ignora esse caso aqui - pode ser falta justificada, férias, etc.
                    if (totalRegistros === 0) {
                        dataAtual.setDate(dataAtual.getDate() + 1)
                        continue
                    }

                    // Detecta registros ímpares (entrada sem saída ou vice-versa)
                    // Isso indica registro faltante, independente de hora extra
                    if (entradas.length !== saidas.length) {
                        // Tem mais entradas que saídas = falta saída
                        if (entradas.length > saidas.length) {
                            const ultimaEntrada = entradas[entradas.length - 1]
                            anomalias.push({
                                funcionario_id: func.funcionario_id,
                                funcionario_nome: func.funcionario_nome,
                                matricula: func.matricula,
                                lotacao: func.lotacao,
                                data: dataStr,
                                data_hora: ultimaEntrada.data_hora,
                                tipo_anomalia: 'FALTA_REGISTRO',
                                tipo_esperado: 'SAIDA',
                                hora_esperada: jornadaDia.saida_2?.substring(0, 5) || jornadaDia.saida_1?.substring(0, 5) || '--:--',
                                descricao: `Entrada às ${ultimaEntrada.hora} sem saída correspondente`
                            })
                        }
                        // Tem mais saídas que entradas = falta entrada (raro, mas possível)
                        else {
                            const primeiraSaida = saidas[0]
                            anomalias.push({
                                funcionario_id: func.funcionario_id,
                                funcionario_nome: func.funcionario_nome,
                                matricula: func.matricula,
                                lotacao: func.lotacao,
                                data: dataStr,
                                data_hora: primeiraSaida.data_hora,
                                tipo_anomalia: 'FALTA_REGISTRO',
                                tipo_esperado: 'ENTRADA',
                                hora_esperada: jornadaDia.entrada_1?.substring(0, 5) || '--:--',
                                descricao: `Saída às ${primeiraSaida.hora} sem entrada correspondente`
                            })
                        }
                    }

                    // Se tem jornada com intervalo mas só tem 2 registros (E/S)
                    // Pode ser que não foi almoçar, mas é suspeito - registrar como pendente de verificação
                    if (temIntervalo && totalRegistros === 2 && entradas.length === 1 && saidas.length === 1) {
                        // Verifica se o intervalo entre entrada e saída é muito longo (> 6h sem intervalo)
                        const entrada = new Date(entradas[0].data_hora)
                        const saida = new Date(saidas[0].data_hora)
                        const horasTrabalhadas = (saida.getTime() - entrada.getTime()) / (1000 * 60 * 60)

                        if (horasTrabalhadas > 6) {
                            anomalias.push({
                                funcionario_id: func.funcionario_id,
                                funcionario_nome: func.funcionario_nome,
                                matricula: func.matricula,
                                lotacao: func.lotacao,
                                data: dataStr,
                                data_hora: entradas[0].data_hora,
                                tipo_anomalia: 'FALTA_INTERVALO',
                                tipo_esperado: 'INTERVALO',
                                hora_esperada: jornadaDia.saida_1?.substring(0, 5) || '12:00',
                                descricao: `${horasTrabalhadas.toFixed(1)}h sem registro de intervalo (jornada prevê almoço)`
                            })
                        }
                    }

                    dataAtual.setDate(dataAtual.getDate() + 1)
                }
            }
        } catch (error) {
            console.error('[Anomalias] Erro ao detectar faltas por jornada:', error)
        }

        return anomalias
    }

    /**
     * Dispara verificação automática de anomalias para uma data
     * POST /api/anomalias/verificar
     */
    async verificarAnomalias({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const { verificarAnomaliasPonto } = await import('#services/alertas_service')

            const municipioId = tenant?.municipioId || 1
            const data = request.input('data') // formato: 'YYYY-MM-DD'

            if (!data) {
                return response.status(400).json({ error: 'Data é obrigatória (formato: YYYY-MM-DD)' })
            }

            console.log(`[Anomalias] Verificação manual para ${data}, município ${municipioId}`)

            const anomalias = await verificarAnomaliasPonto(dbManager, municipioId, data)

            return response.json({
                success: true,
                data,
                anomalias_detectadas: anomalias.length,
                anomalias: anomalias,
                mensagem: anomalias.length > 0
                    ? `${anomalias.length} anomalia(s) detectada(s) e registrada(s)`
                    : 'Nenhuma anomalia detectada'
            })
        } catch (error: any) {
            console.error('[Anomalias Verificar] Erro:', error)
            return response.status(500).json({ error: 'Erro ao verificar anomalias: ' + error.message })
        }
    }

    /**
     * Lista anomalias registradas (tabela anomalias)
     * GET /api/anomalias/registradas
     */
    async registradas({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1

            const dataInicio = request.input('data_inicio')
            const dataFim = request.input('data_fim')
            const funcionarioId = request.input('funcionario_id')
            const resolvida = request.input('resolvida')

            let conditions: string[] = []
            const params: any[] = []
            let paramIndex = 1

            if (dataInicio) {
                conditions.push(`a.data >= $${paramIndex++}`)
                params.push(dataInicio)
            }
            if (dataFim) {
                conditions.push(`a.data <= $${paramIndex++}`)
                params.push(dataFim)
            }
            if (funcionarioId) {
                conditions.push(`a.funcionario_id = $${paramIndex++}`)
                params.push(funcionarioId)
            }
            if (resolvida !== undefined && resolvida !== '') {
                conditions.push(`a.resolvida = $${paramIndex++}`)
                params.push(resolvida === 'true' || resolvida === true)
            }

            const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

            const anomalias = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    a.*,
                    f.nome as funcionario_nome,
                    f.matricula,
                    u.nome as resolvido_por_nome
                FROM anomalias a
                LEFT JOIN funcionarios f ON f.id = a.funcionario_id
                LEFT JOIN usuarios u ON u.id = a.resolvida_por
                ${whereClause}
                ORDER BY a.data DESC, a.created_at DESC
                LIMIT 500
            `, params)

            // Resumo
            const [resumoResult] = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE resolvida = false) as pendentes,
                    COUNT(*) FILTER (WHERE resolvida = true) as resolvidas,
                    COUNT(*) FILTER (WHERE tipo = 'SAIDA_NAO_REGISTRADA') as saidas_faltantes,
                    COUNT(*) FILTER (WHERE tipo = 'ENTRADA_NAO_REGISTRADA') as entradas_faltantes,
                    COUNT(*) FILTER (WHERE tipo = 'FALTA_SEM_JUSTIFICATIVA') as faltas
                FROM anomalias
                ${whereClause}
            `, params)

            return response.json({
                anomalias,
                resumo: resumoResult || {
                    total: 0,
                    pendentes: 0,
                    resolvidas: 0,
                    saidas_faltantes: 0,
                    entradas_faltantes: 0,
                    faltas: 0
                }
            })
        } catch (error: any) {
            console.error('[Anomalias Registradas] Erro:', error)
            return response.status(500).json({ error: 'Erro ao buscar anomalias: ' + error.message })
        }
    }

    /**
     * Marca anomalia como resolvida (tabela anomalias)
     * POST /api/anomalias/:id/resolver
     */
    async resolverAnomalia({ params, request, response, session, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1
            const userId = session.get('user_id') || session.get('admin_id')

            const anomaliaId = params.id
            const observacao = request.input('observacao')

            // Atualiza a anomalia
            await dbManager.queryMunicipio(municipioId, `
                UPDATE anomalias
                SET resolvida = true, resolvida_por = $2, resolvida_em = NOW()
                WHERE id = $1
            `, [anomaliaId, userId])

            return response.json({
                success: true,
                mensagem: 'Anomalia marcada como resolvida'
            })
        } catch (error: any) {
            console.error('[Anomalias ResolverAnomalia] Erro:', error)
            return response.status(500).json({ error: 'Erro ao resolver anomalia: ' + error.message })
        }
    }

    /**
     * Monitoramento em tempo real - verifica saídas pendentes
     * POST /api/anomalias/monitorar
     *
     * Verifica funcionários que bateram ENTRADA mas não bateram SAÍDA
     * e já passou do horário esperado de saída + tolerância
     */
    async monitorar({ request, response, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const { monitorarBatidasPendentes } = await import('#services/alertas_service')

            const municipioId = tenant?.municipioId || 1
            const toleranciaMinutos = request.input('tolerancia', 60) // default: 60 min

            console.log(`[Anomalias] Monitoramento manual - tolerância: ${toleranciaMinutos} min`)

            const alertas = await monitorarBatidasPendentes(dbManager, municipioId, toleranciaMinutos)

            return response.json({
                success: true,
                tolerancia_minutos: toleranciaMinutos,
                alertas_gerados: alertas.length,
                alertas: alertas,
                mensagem: alertas.length > 0
                    ? `${alertas.length} funcionário(s) com saída pendente`
                    : 'Nenhuma saída pendente detectada'
            })
        } catch (error: any) {
            console.error('[Anomalias Monitorar] Erro:', error)
            return response.status(500).json({ error: 'Erro ao monitorar: ' + error.message })
        }
    }

    /**
     * Excluir registro de ponto
     */
    async excluirRegistro({ params, response, session, tenant }: HttpContext) {
        try {
            const { dbManager } = await import('#services/database_manager_service')
            const municipioId = tenant?.municipioId || 1
            const userId = session.get('user_id') || session.get('admin_id')
            const registroId = params.id

            // Busca registro antes de excluir (para auditoria)
            const registro = await dbManager.queryMunicipio(municipioId, `
                SELECT * FROM registros_ponto WHERE id = $1
            `, [registroId])

            if (registro.length === 0) {
                return response.status(404).json({ error: 'Registro não encontrado' })
            }

            // Exclui
            await dbManager.queryMunicipio(municipioId, `
                DELETE FROM registros_ponto WHERE id = $1
            `, [registroId])

            // Auditoria
            try {
                await dbManager.queryMunicipio(municipioId, `
                    INSERT INTO audit_logs (usuario_id, acao, tabela, registro_id, dados_anteriores, created_at)
                    VALUES ($1, 'EXCLUSAO_PONTO', 'registros_ponto', $2, $3, NOW())
                `, [userId, registroId, JSON.stringify(registro[0])])
            } catch {
                // Auditoria opcional
            }

            return response.json({
                success: true,
                mensagem: 'Registro excluído com sucesso'
            })
        } catch (error: any) {
            console.error('[Anomalias ExcluirRegistro] Erro:', error)
            return response.status(500).json({ error: 'Erro ao excluir registro' })
        }
    }
}
