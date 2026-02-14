/**
 * Serviço de Alertas Automáticos
 *
 * Gera notificações automáticas baseadas em regras do sistema
 */

import { emailService } from './email_service.js'

interface AlertaConfig {
    limiteNegativoMinutos: number  // Ex: -120 (2 horas negativas)
    alertarGestor: boolean
    alertarFuncionario: boolean
    enviarEmail?: boolean  // Se true, envia email além da notificação
}

/**
 * Verifica e gera alertas de banco de horas negativo
 */
async function verificarBancoHorasNegativo(
    dbManager: any,
    municipioId: number,
    funcionarioId: number,
    config: AlertaConfig = { limiteNegativoMinutos: -120, alertarGestor: true, alertarFuncionario: true }
) {
    try {
        // Busca saldo atual do funcionário
        const [saldo] = await dbManager.queryMunicipio(municipioId, `
      SELECT COALESCE(SUM(minutos), 0) as saldo FROM banco_horas WHERE funcionario_id = $1
    `, [funcionarioId])

        const saldoAtual = saldo?.saldo || 0

        // Se saldo está abaixo do limite, gera alerta
        if (saldoAtual < config.limiteNegativoMinutos) {
            // Verifica se já existe notificação recente (últimas 24h)
            const [notificacaoExistente] = await dbManager.queryMunicipio(municipioId, `
        SELECT id FROM notificacoes 
        WHERE funcionario_id = $1 
        AND categoria = 'BANCO_HORAS' 
        AND tipo = 'ALERTA'
        AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `, [funcionarioId])

            if (!notificacaoExistente) {
                // Busca dados do funcionário
                const [funcionario] = await dbManager.queryMunicipio(municipioId, `
          SELECT nome, matricula, gestor_id FROM funcionarios WHERE id = $1
        `, [funcionarioId])

                const horas = Math.floor(Math.abs(saldoAtual) / 60)
                const mins = Math.abs(saldoAtual) % 60
                const saldoFormatado = `-${horas}h${mins.toString().padStart(2, '0')}m`

                // Notificação para o funcionário
                if (config.alertarFuncionario) {
                    await dbManager.queryMunicipio(municipioId, `
            INSERT INTO notificacoes (funcionario_id, titulo, mensagem, tipo, categoria, action_url)
            VALUES ($1, $2, $3, 'ALERTA', 'BANCO_HORAS', '/banco-horas')
          `, [
                        funcionarioId,
                        'Banco de Horas Negativo',
                        `Seu saldo está negativo: ${saldoFormatado}. Regularize sua situação.`
                    ])

                    // Envia email se configurado
                    if (config.enviarEmail && emailService.isEnabled()) {
                        const [funcEmail] = await dbManager.queryMunicipio(municipioId, `
                            SELECT email FROM funcionarios WHERE id = $1 AND email IS NOT NULL
                        `, [funcionarioId])

                        if (funcEmail?.email) {
                            emailService.notificarBancoHoras(funcEmail.email, {
                                funcionario: funcionario.nome,
                                saldo: saldoFormatado,
                                percentual: Math.round((Math.abs(saldoAtual) / Math.abs(config.limiteNegativoMinutos)) * 100),
                                tipo: 'negativo'
                            }).catch(e => console.error('[Alertas] Erro ao enviar email:', e))
                        }
                    }
                }

                // Notificação para o gestor (se houver)
                if (config.alertarGestor && funcionario?.gestor_id) {
                    await dbManager.queryMunicipio(municipioId, `
            INSERT INTO notificacoes (funcionario_id, titulo, mensagem, tipo, categoria, action_url)
            VALUES ($1, $2, $3, 'ALERTA', 'BANCO_HORAS', '/banco-horas')
          `, [
                        funcionario.gestor_id,
                        'Funcionário com Banco Negativo',
                        `${funcionario.nome} (${funcionario.matricula}) está com saldo negativo: ${saldoFormatado}`
                    ])
                }

                return true // Alerta gerado
            }
        }

        return false // Sem alerta
    } catch (error: any) {
        console.error('[Alertas] Erro ao verificar banco negativo:', error.message)
        return false
    }
}

/**
 * Verifica múltiplos funcionários de uma vez
 */
async function verificarTodosBancosNegativos(
    dbManager: any,
    municipioId: number,
    config?: AlertaConfig
) {
    try {
        // Busca funcionários com saldo negativo
        const funcionarios = await dbManager.queryMunicipio(municipioId, `
      SELECT funcionario_id, SUM(minutos) as saldo
      FROM banco_horas
      GROUP BY funcionario_id
      HAVING SUM(minutos) < $1
    `, [config?.limiteNegativoMinutos || -120])

        let alertasGerados = 0

        for (const f of funcionarios) {
            const gerou = await verificarBancoHorasNegativo(dbManager, municipioId, f.funcionario_id, config)
            if (gerou) alertasGerados++
        }

        return alertasGerados
    } catch (error: any) {
        console.error('[Alertas] Erro ao verificar bancos negativos:', error.message)
        return 0
    }
}

/**
 * Verifica anomalias de ponto para um dia específico
 * Detecta:
 * - Funcionários com número ímpar de batidas (ex: só ENTRADA, sem SAÍDA)
 * - Funcionários que deveriam trabalhar mas não bateram ponto
 */
async function verificarAnomaliasPonto(
    dbManager: any,
    municipioId: number,
    data: string // formato: 'YYYY-MM-DD'
) {
    const anomaliasDetectadas: any[] = []

    try {
        // 1. Busca funcionários ativos com jornada (que deveriam trabalhar)
        const funcionarios = await dbManager.queryMunicipio(municipioId, `
            SELECT f.id, f.nome, f.matricula, f.jornada_id, j.nome as jornada_nome
            FROM funcionarios f
            LEFT JOIN jornadas j ON j.id = f.jornada_id
            WHERE f.ativo = true
            AND f.data_demissao IS NULL
        `)

        // Determina dia da semana (0=domingo, 6=sábado)
        const dataObj = new Date(data + 'T12:00:00')
        const diaSemana = dataObj.getDay()

        for (const func of funcionarios) {
            // Busca batidas do dia
            const batidas = await dbManager.queryMunicipio(municipioId, `
                SELECT id, sentido, data_hora, origem
                FROM registros_ponto
                WHERE funcionario_id = $1
                AND DATE(data_hora) = $2
                ORDER BY data_hora
            `, [func.id, data])

            const totalBatidas = batidas.length

            // Verifica se deveria trabalhar nesse dia
            let deveTrabalhar = true
            if (func.jornada_id) {
                const [horarioDia] = await dbManager.queryMunicipio(municipioId, `
                    SELECT folga FROM jornada_horarios
                    WHERE jornada_id = $1 AND dia_semana = $2
                `, [func.jornada_id, diaSemana])
                if (horarioDia?.folga) {
                    deveTrabalhar = false
                }
            }

            // Verifica se tem afastamento
            const [afastamento] = await dbManager.queryMunicipio(municipioId, `
                SELECT id FROM afastamentos
                WHERE funcionario_id = $1
                AND $2 BETWEEN data_inicio AND COALESCE(data_fim, $2)
            `, [func.id, data])

            if (afastamento) {
                deveTrabalhar = false
            }

            // Verifica se é feriado
            const [feriado] = await dbManager.queryMunicipio(municipioId, `
                SELECT id FROM feriados
                WHERE (data = $1 OR (recorrente = true AND EXTRACT(MONTH FROM data) = EXTRACT(MONTH FROM $1::date) AND EXTRACT(DAY FROM data) = EXTRACT(DAY FROM $1::date)))
                AND ativo = true
            `, [data])

            if (feriado) {
                deveTrabalhar = false
            }

            // ANOMALIA 1: Número ímpar de batidas (faltou saída)
            if (totalBatidas > 0 && totalBatidas % 2 !== 0) {
                const ultimaBatida = batidas[batidas.length - 1]
                const tipoAnomalia = ultimaBatida.sentido === 'ENTRADA' ? 'SAIDA_NAO_REGISTRADA' : 'ENTRADA_NAO_REGISTRADA'

                // Verifica se já existe anomalia para este funcionário/data/tipo
                const [anomaliaExistente] = await dbManager.queryMunicipio(municipioId, `
                    SELECT id FROM anomalias
                    WHERE funcionario_id = $1 AND data = $2 AND tipo = $3
                `, [func.id, data, tipoAnomalia])

                if (!anomaliaExistente) {
                    // Cria anomalia
                    await dbManager.queryMunicipio(municipioId, `
                        INSERT INTO anomalias (funcionario_id, data, tipo, descricao, resolvida, created_at)
                        VALUES ($1, $2, $3, $4, false, NOW())
                    `, [
                        func.id,
                        data,
                        tipoAnomalia,
                        tipoAnomalia === 'SAIDA_NAO_REGISTRADA'
                            ? `Funcionário registrou ${totalBatidas} batida(s), última foi ENTRADA às ${new Date(ultimaBatida.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Faltou registrar SAÍDA.`
                            : `Funcionário registrou ${totalBatidas} batida(s), última foi SAÍDA às ${new Date(ultimaBatida.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Faltou registrar ENTRADA.`
                    ])

                    // Cria notificação
                    await dbManager.queryMunicipio(municipioId, `
                        INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, lida, created_at)
                        SELECT u.id, $2, $3, 'ALERTA', false, NOW()
                        FROM usuarios u
                        WHERE u.perfil IN ('admin', 'gestor', 'rh')
                        AND u.ativo = true
                    `, [
                        null,
                        'Batida de Ponto Irregular',
                        `${func.nome} (${func.matricula}) - ${tipoAnomalia === 'SAIDA_NAO_REGISTRADA' ? 'Não registrou saída' : 'Não registrou entrada'} em ${new Date(data).toLocaleDateString('pt-BR')}`
                    ])

                    anomaliasDetectadas.push({
                        funcionario_id: func.id,
                        funcionario_nome: func.nome,
                        tipo: tipoAnomalia,
                        data,
                        batidas: totalBatidas
                    })
                }
            }

            // ANOMALIA 2: Deveria trabalhar mas não bateu ponto
            if (deveTrabalhar && totalBatidas === 0) {
                // Verifica se já existe anomalia para este funcionário/data/tipo
                const [anomaliaExistente] = await dbManager.queryMunicipio(municipioId, `
                    SELECT id FROM anomalias
                    WHERE funcionario_id = $1 AND data = $2 AND tipo = 'FALTA_SEM_JUSTIFICATIVA'
                `, [func.id, data])

                if (!anomaliaExistente) {
                    // Cria anomalia
                    await dbManager.queryMunicipio(municipioId, `
                        INSERT INTO anomalias (funcionario_id, data, tipo, descricao, resolvida, created_at)
                        VALUES ($1, $2, 'FALTA_SEM_JUSTIFICATIVA', $3, false, NOW())
                    `, [
                        func.id,
                        data,
                        `Funcionário não registrou nenhum ponto em dia útil (${func.jornada_nome || 'Jornada padrão'}).`
                    ])

                    // Cria notificação
                    await dbManager.queryMunicipio(municipioId, `
                        INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, lida, created_at)
                        SELECT u.id, $2, $3, 'ALERTA', false, NOW()
                        FROM usuarios u
                        WHERE u.perfil IN ('admin', 'gestor', 'rh')
                        AND u.ativo = true
                    `, [
                        null,
                        'Ausência não Justificada',
                        `${func.nome} (${func.matricula}) não registrou ponto em ${new Date(data).toLocaleDateString('pt-BR')}`
                    ])

                    anomaliasDetectadas.push({
                        funcionario_id: func.id,
                        funcionario_nome: func.nome,
                        tipo: 'FALTA_SEM_JUSTIFICATIVA',
                        data,
                        batidas: 0
                    })
                }
            }
        }

        console.log(`[Alertas] ${data}: ${anomaliasDetectadas.length} anomalias detectadas`)
        return anomaliasDetectadas
    } catch (error: any) {
        console.error('[Alertas] Erro ao verificar anomalias de ponto:', error.message)
        return []
    }
}

/**
 * Verifica anomalias para todos os municípios (multi-tenant)
 * Deve ser chamado por um job agendado no final do dia
 */
async function verificarTodasAnomaliasPonto(
    dbManager: any,
    data?: string // Se não informado, usa ontem
) {
    const dataVerificar = data || new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

    try {
        // Busca todos os municípios ativos
        const municipios = await dbManager.queryCentral(`
            SELECT id FROM municipios WHERE ativo = true
        `)

        let totalAnomalias = 0

        for (const mun of municipios) {
            const anomalias = await verificarAnomaliasPonto(dbManager, mun.id, dataVerificar)
            totalAnomalias += anomalias.length
        }

        console.log(`[Alertas] Total geral: ${totalAnomalias} anomalias em ${municipios.length} município(s)`)
        return totalAnomalias
    } catch (error: any) {
        console.error('[Alertas] Erro ao verificar anomalias em todos municípios:', error.message)
        return 0
    }
}

/**
 * Monitoramento em tempo real de batidas pendentes
 *
 * Verifica funcionários que:
 * - Bateram ENTRADA mas não bateram SAÍDA
 * - Já passou do horário esperado de saída + tolerância
 *
 * Se o funcionário faz hora extra, ele deve bater SAÍDA no horário normal
 * e depois ENTRADA novamente para registrar a hora extra.
 *
 * @param toleranciaMinutos - Tempo extra após horário de saída (default: 60 min)
 */
async function monitorarBatidasPendentes(
    dbManager: any,
    municipioId: number,
    toleranciaMinutos: number = 60
) {
    const alertas: any[] = []

    try {
        const agora = new Date()
        const horaAtual = agora.getHours()
        const minutoAtual = agora.getMinutes()
        const horaAtualMinutos = horaAtual * 60 + minutoAtual

        const hoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        const diaSemana = agora.getDay() // 0=domingo, 6=sábado

        // Busca funcionários ativos com jornada configurada
        const funcionarios = await dbManager.queryMunicipio(municipioId, `
            SELECT
                f.id, f.nome, f.matricula, f.jornada_id,
                j.nome as jornada_nome, j.tipo as jornada_tipo
            FROM funcionarios f
            LEFT JOIN jornadas j ON j.id = f.jornada_id
            WHERE f.ativo = true
            AND f.data_demissao IS NULL
            AND f.jornada_id IS NOT NULL
            AND j.tipo != 'PLANTAO'
        `)

        for (const func of funcionarios) {
            // Busca horário de saída esperado para hoje
            const [horarioDia] = await dbManager.queryMunicipio(municipioId, `
                SELECT
                    folga,
                    saida_1,
                    saida_2,
                    EXTRACT(HOUR FROM COALESCE(saida_2, saida_1)) * 60 +
                    EXTRACT(MINUTE FROM COALESCE(saida_2, saida_1)) as saida_minutos
                FROM jornada_horarios
                WHERE jornada_id = $1 AND dia_semana = $2
            `, [func.jornada_id, diaSemana])

            // Se é folga ou não tem horário configurado, pula
            if (!horarioDia || horarioDia.folga || !horarioDia.saida_minutos) {
                continue
            }

            const horarioSaidaEsperado = parseInt(horarioDia.saida_minutos)
            const horarioLimite = horarioSaidaEsperado + toleranciaMinutos

            // Se ainda não passou do horário limite, pula
            if (horaAtualMinutos < horarioLimite) {
                continue
            }

            // Busca batidas do dia
            const batidas = await dbManager.queryMunicipio(municipioId, `
                SELECT id, sentido, data_hora
                FROM registros_ponto
                WHERE funcionario_id = $1
                AND DATE(data_hora) = $2
                ORDER BY data_hora DESC
            `, [func.id, hoje])

            const totalBatidas = batidas.length

            // Se não tem batidas ou número par (já completou), pula
            if (totalBatidas === 0 || totalBatidas % 2 === 0) {
                continue
            }

            // Última batida foi ENTRADA - funcionário não bateu saída
            const ultimaBatida = batidas[0]
            if (ultimaBatida.sentido !== 'ENTRADA') {
                continue
            }

            // Verifica se já existe alerta para este funcionário hoje
            const [alertaExistente] = await dbManager.queryMunicipio(municipioId, `
                SELECT id FROM anomalias
                WHERE funcionario_id = $1
                AND data = $2
                AND tipo = 'SAIDA_PENDENTE'
                AND resolvida = false
            `, [func.id, hoje])

            if (alertaExistente) {
                continue // Já tem alerta, não cria outro
            }

            // Calcula quanto tempo passou do horário esperado
            const atrasoMinutos = horaAtualMinutos - horarioSaidaEsperado
            const horaEsperada = `${Math.floor(horarioSaidaEsperado / 60).toString().padStart(2, '0')}:${(horarioSaidaEsperado % 60).toString().padStart(2, '0')}`

            // Cria anomalia
            await dbManager.queryMunicipio(municipioId, `
                INSERT INTO anomalias (funcionario_id, data, tipo, descricao, resolvida, created_at)
                VALUES ($1, $2, 'SAIDA_PENDENTE', $3, false, NOW())
            `, [
                func.id,
                hoje,
                `Funcionário deveria ter saído às ${horaEsperada} (${func.jornada_nome}). Já se passaram ${atrasoMinutos} minutos. Última batida: ENTRADA às ${new Date(ultimaBatida.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
            ])

            // Cria notificação para gestores
            await dbManager.queryMunicipio(municipioId, `
                INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, lida, created_at)
                SELECT u.id, $2, $3, 'ALERTA', false, NOW()
                FROM usuarios u
                WHERE u.perfil IN ('admin', 'gestor', 'rh')
                AND u.ativo = true
            `, [
                null,
                'Saída Não Registrada',
                `${func.nome} (${func.matricula}) deveria ter saído às ${horaEsperada} mas não registrou saída. Verifique se é hora extra ou esquecimento.`
            ])

            alertas.push({
                funcionario_id: func.id,
                funcionario_nome: func.nome,
                matricula: func.matricula,
                horario_esperado: horaEsperada,
                atraso_minutos: atrasoMinutos,
                jornada: func.jornada_nome
            })

            console.log(`[Alertas] ⚠️ ${func.nome} - Saída pendente (esperado: ${horaEsperada}, atraso: ${atrasoMinutos}min)`)
        }

        if (alertas.length > 0) {
            console.log(`[Alertas] ${hoje}: ${alertas.length} funcionário(s) com saída pendente`)
        }

        return alertas
    } catch (error: any) {
        console.error('[Alertas] Erro no monitoramento em tempo real:', error.message)
        return []
    }
}

/**
 * Monitora batidas pendentes em todos os municípios
 */
async function monitorarTodosBatidasPendentes(
    dbManager: any,
    toleranciaMinutos: number = 60
) {
    try {
        // Busca todos os municípios ativos
        const municipios = await dbManager.queryCentral(`
            SELECT id, nome FROM municipios WHERE ativo = true
        `)

        let totalAlertas = 0

        for (const mun of municipios) {
            const alertas = await monitorarBatidasPendentes(dbManager, mun.id, toleranciaMinutos)
            totalAlertas += alertas.length
        }

        return totalAlertas
    } catch (error: any) {
        console.error('[Alertas] Erro ao monitorar todos municípios:', error.message)
        return 0
    }
}

export {
    verificarBancoHorasNegativo,
    verificarTodosBancosNegativos,
    verificarAnomaliasPonto,
    verificarTodasAnomaliasPonto,
    monitorarBatidasPendentes,
    monitorarTodosBatidasPendentes
}
