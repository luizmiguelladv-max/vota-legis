/**
 * App Controller - API para o App Mobile PWA
 *
 * Endpoints:
 * - POST /api/app/login - Login do funcionário
 * - GET /api/app/me - Dados do funcionário logado
 * - GET /api/app/perfil - Dados completos do funcionário
 * - GET /api/app/status - Status do dia (horas, banco, último registro)
 * - GET /api/app/dia-info - Info do dia (feriado, facultativo)
 * - POST /api/app/registrar - Registrar ponto
 * - GET /api/app/registros-hoje - Lista de registros do dia
 * - GET /api/app/jornada - Jornada do funcionário
 * - GET /api/app/espelho/:mes/:ano - Espelho de ponto
 * - GET /api/app/mensagens - Mensagens para o funcionário
 * - POST /api/app/logout - Logout
 */

import type { HttpContext } from '@adonisjs/core/http'

export default class AppController {
    /**
     * Login do funcionário via CPF + Matrícula + Senha
     * Busca automaticamente em todas as entidades
     * Senha padrão: últimos 4 dígitos do CPF (primeiro acesso)
     */
    async login({ request, response, session }: HttpContext) {
        const { cpf, matricula, senha } = request.only(['cpf', 'matricula', 'senha'])

        if (!cpf || !matricula || !senha) {
            return response.status(400).json({ error: 'CPF, matrícula e senha são obrigatórios' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Limpa formatação do CPF
            const cpfLimpo = cpf.replace(/\D/g, '')
            const matriculaLimpa = matricula.toString().replace(/\D/g, '')

            console.log('[App Login] CPF:', cpfLimpo, 'Matrícula:', matriculaLimpa)

            // Busca todas as entidades ativas
            const entidades = await dbManager.queryCentral<{ id: number; db_schema: string; nome: string }>(
                'SELECT id, db_schema, nome FROM public.entidades WHERE ativo = true AND db_schema IS NOT NULL'
            )

            let funcionarioEncontrado: any = null
            let entidadeEncontrada: any = null

            // Busca o funcionário em cada entidade
            for (const entidade of entidades) {
                try {
                    const result = await dbManager.queryCentral<any>(`
                        SELECT id, nome, cpf, matricula
                        FROM ${entidade.db_schema}.funcionarios
                        WHERE cpf = $1 AND matricula = $2 AND ativo = true
                        LIMIT 1
                    `, [cpfLimpo, matriculaLimpa])

                    if (result.length > 0) {
                        funcionarioEncontrado = result[0]
                        entidadeEncontrada = entidade
                        console.log('[App Login] Encontrado em:', entidade.nome)
                        break
                    }
                } catch (err) {
                    // Ignora erros de schema inexistente
                }
            }

            if (!funcionarioEncontrado) {
                return response.status(401).json({ error: 'CPF e matrícula não encontrados' })
            }

            // Verifica se existe usuário vinculado ao funcionário
            const usuarios = await dbManager.queryCentral<any>(`
                SELECT id, senha, primeiro_acesso
                FROM ${entidadeEncontrada.db_schema}.usuarios
                WHERE funcionario_id = $1 AND ativo = true
                LIMIT 1
            `, [funcionarioEncontrado.id])

            let usuario = usuarios[0]
            const cpfFuncionario = funcionarioEncontrado.cpf?.replace(/\D/g, '') || ''
            const senhaDefault = cpfFuncionario.slice(-4) // Últimos 4 dígitos

            // Se não existe usuário, cria automaticamente
            if (!usuario) {
                const bcryptModule = await import('bcryptjs')
                const bcrypt = bcryptModule.default || bcryptModule
                const senhaHash = await bcrypt.hash(senhaDefault, 10)

                await dbManager.queryCentral(`
                    INSERT INTO ${entidadeEncontrada.db_schema}.usuarios
                    (funcionario_id, login, senha, nome, email, perfil, ativo, primeiro_acesso, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, 'FUNCIONARIO', true, true, NOW(), NOW())
                `, [
                    funcionarioEncontrado.id,
                    cpfLimpo,
                    senhaHash,
                    funcionarioEncontrado.nome,
                    cpfLimpo + '@ponto.local'
                ])

                // Busca o usuário criado
                const newUsers = await dbManager.queryCentral<any>(`
                    SELECT id, senha, primeiro_acesso
                    FROM ${entidadeEncontrada.db_schema}.usuarios
                    WHERE funcionario_id = $1
                    LIMIT 1
                `, [funcionarioEncontrado.id])
                usuario = newUsers[0]
            }

            // Verifica senha
            const bcryptModule2 = await import('bcryptjs')
            const bcrypt2 = bcryptModule2.default || bcryptModule2
            let senhaValida = false

            console.log('[App Login] Verificando senha...')
            console.log('[App Login] primeiro_acesso:', usuario.primeiro_acesso)
            console.log('[App Login] senha recebida:', senha)
            console.log('[App Login] senhaDefault (4 últimos):', senhaDefault)

            // Primeiro acesso: aceita últimos 4 dígitos do CPF
            if (usuario.primeiro_acesso && senha === senhaDefault) {
                console.log('[App Login] Usando senha padrão (primeiro acesso)')
                senhaValida = true
            } else {
                // Verifica senha com hash
                console.log('[App Login] Comparando com hash...')
                senhaValida = await bcrypt2.compare(senha, usuario.senha)
                console.log('[App Login] Resultado bcrypt.compare:', senhaValida)
            }

            if (!senhaValida) {
                return response.status(401).json({
                    error: usuario.primeiro_acesso
                        ? 'Senha incorreta. No primeiro acesso, use os últimos 4 dígitos do seu CPF.'
                        : 'Senha incorreta.'
                })
            }

            // Atualiza último acesso
            await dbManager.queryCentral(`
                UPDATE ${entidadeEncontrada.db_schema}.usuarios SET ultimo_acesso = NOW() WHERE id = $1
            `, [usuario.id])

            // Salva na sessão
            session.put('app_funcionario_id', funcionarioEncontrado.id)
            session.put('app_entidade_id', entidadeEncontrada.id)
            session.put('app_schema', entidadeEncontrada.db_schema)

            return response.json({
                success: true,
                primeiroAcesso: usuario.primeiro_acesso,
                funcionario: {
                    id: funcionarioEncontrado.id,
                    nome: funcionarioEncontrado.nome
                },
                entidade: {
                    id: entidadeEncontrada.id,
                    nome: entidadeEncontrada.nome
                }
            })
        } catch (error: any) {
            console.error('[App Login] Erro:', error)
            return response.status(500).json({ error: 'Erro interno. Tente novamente.' })
        }
    }

    /**
     * Altera senha do funcionário (obrigatório no primeiro acesso)
     */
    async alterarSenha({ request, response, session }: HttpContext) {
        const { novaSenha, confirmarSenha } = request.only(['novaSenha', 'confirmarSenha'])
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        if (!novaSenha || novaSenha.length < 6) {
            return response.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' })
        }

        if (novaSenha !== confirmarSenha) {
            return response.status(400).json({ error: 'Senhas não conferem' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const bcryptModule = await import('bcryptjs')
            const bcrypt = bcryptModule.default || bcryptModule

            const senhaHash = await bcrypt.hash(novaSenha, 10)

            await dbManager.queryCentral(`
                UPDATE ${schema}.usuarios
                SET senha = $1, primeiro_acesso = false, updated_at = NOW()
                WHERE funcionario_id = $2
            `, [senhaHash, funcionarioId])

            return response.json({ success: true, message: 'Senha alterada com sucesso!' })
        } catch (error: any) {
            console.error('[App AlterarSenha] Erro:', error)
            return response.status(500).json({ error: 'Erro ao alterar senha' })
        }
    }

    /**
     * Retorna dados do funcionário logado
     */
    async me({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            const result = await dbManager.queryCentral<any>(`
                SELECT f.id, f.nome, f.cpf, f.matricula, c.nome as cargo
                FROM ${schema}.funcionarios f
                LEFT JOIN ${schema}.cargos c ON c.id = f.cargo_id
                WHERE f.id = $1 AND f.ativo = true
            `, [funcionarioId])

            if (result.length === 0) {
                session.forget('app_funcionario_id')
                session.forget('app_schema')
                session.forget('app_entidade_id')
                return response.status(401).json({ error: 'Funcionário não encontrado' })
            }

            const func = result[0]

            return response.json({
                id: func.id,
                nome: func.nome,
                cpf: func.cpf,
                matricula: func.matricula,
                cargo: func.cargo || 'Funcionário'
            })
        } catch (error: any) {
            console.error('[App Me] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Retorna status do dia atual
     */
    async status({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const hoje = new Date().toISOString().split('T')[0]

            // Busca registros do dia
            const registros = await dbManager.queryCentral<any>(`
                SELECT id, data_hora, sentido
                FROM ${schema}.registros_ponto
                WHERE funcionario_id = $1 AND DATE(data_hora) = $2
                ORDER BY data_hora ASC
            `, [funcionarioId, hoje])

            // Calcula horas trabalhadas hoje
            let horasHoje = 0
            for (let i = 0; i < registros.length - 1; i += 2) {
                if (registros[i + 1]) {
                    const entrada = new Date(registros[i].data_hora)
                    const saida = new Date(registros[i + 1].data_hora)
                    horasHoje += (saida.getTime() - entrada.getTime()) / (1000 * 60 * 60)
                }
            }

            // Se está "dentro" (último registro foi entrada), conta até agora
            const ultimoRegistro = registros.length > 0 ? registros[registros.length - 1] : null
            if (ultimoRegistro && ultimoRegistro.sentido === 'ENTRADA') {
                const entrada = new Date(ultimoRegistro.data_hora)
                const agora = new Date()
                horasHoje += (agora.getTime() - entrada.getTime()) / (1000 * 60 * 60)
            }

            // Formata horas
            const horasInt = Math.floor(horasHoje)
            const minutosInt = Math.round((horasHoje - horasInt) * 60)
            const horasHojeFormatado = `${String(horasInt).padStart(2, '0')}:${String(minutosInt).padStart(2, '0')}`

            // Busca banco de horas (soma de todos os movimentos)
            let bancoHoras = '00:00'
            try {
                const bancoResult = await dbManager.queryCentral<any>(`
                    SELECT COALESCE(SUM(
                        CASE 
                            WHEN tipo_operacao = 'CREDITO' THEN minutos
                            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
                            ELSE minutos
                        END
                    ), 0) as saldo
                    FROM ${schema}.banco_horas
                    WHERE funcionario_id = $1
                `, [funcionarioId])

                if (bancoResult.length > 0) {
                    const saldoMin = bancoResult[0].saldo || 0
                    const horas = Math.floor(Math.abs(saldoMin) / 60)
                    const mins = Math.abs(saldoMin) % 60
                    bancoHoras = `${saldoMin < 0 ? '-' : '+'}${String(horas).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
                }
            } catch {
                // Tabela pode não existir
            }

            return response.json({
                horas_hoje: horasHojeFormatado,
                banco_horas: bancoHoras,
                registros_hoje: registros.length,
                ultimo_registro: ultimoRegistro ? {
                    tipo: ultimoRegistro.sentido,
                    hora: new Date(ultimoRegistro.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                } : null
            })
        } catch (error: any) {
            console.error('[App Status] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Registra ponto (entrada ou saída) com suporte a GPS e foto
     */
    async registrar({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')
        const entidadeId = session.get('app_entidade_id')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        // Obtém dados de GPS e foto (opcionais)
        const { latitude, longitude, precisao_gps, foto_base64, localizacao_aproximada, sem_gps, data_hora_offline, offline } = request.only([
            'latitude', 'longitude', 'precisao_gps', 'foto_base64', 'localizacao_aproximada', 'sem_gps', 'data_hora_offline', 'offline'
        ])

        try {
            const { dbManager } = await import('#services/database_manager_service')
            // Se vier de modo offline, usa a data/hora original do registro
            const now = data_hora_offline ? new Date(data_hora_offline) : new Date()
            const isOffline = offline || !!data_hora_offline
            // Formata a data como YYYY-MM-DD usando timezone de Brasília
            const hoje = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

            // Busca funcionário
            const funcResult = await dbManager.queryCentral<any>(
                `SELECT id, nome, pis FROM ${schema}.funcionarios WHERE id = $1`,
                [funcionarioId]
            )

            if (funcResult.length === 0) {
                return response.status(404).json({ error: 'Funcionário não encontrado' })
            }

            const funcionario = funcResult[0]

            // Verifica cooldown (60 segundos) - pula para registros offline
            if (!isOffline) {
                const ultimoRegistro = await dbManager.queryCentral<any>(
                    `SELECT data_hora FROM ${schema}.registros_ponto
                     WHERE funcionario_id = $1
                     ORDER BY data_hora DESC LIMIT 1`,
                    [funcionarioId]
                )

                if (ultimoRegistro.length > 0) {
                    const ultimaDataHora = new Date(ultimoRegistro[0].data_hora)
                    const realNow = new Date()
                    const diffSegundos = Math.floor((realNow.getTime() - ultimaDataHora.getTime()) / 1000)

                    if (diffSegundos < 60) {
                        return response.status(429).json({
                            error: `Aguarde ${60 - diffSegundos} segundos para registrar novamente`,
                            aguardar: 60 - diffSegundos
                        })
                    }
                }
            }

            // Conta batidas do dia para determinar tipo (usa a data sem conversão de timezone)
            const batidasResult = await dbManager.queryCentral<any>(
                `SELECT COUNT(*) as total FROM ${schema}.registros_ponto
                 WHERE funcionario_id = $1
                 AND DATE(data_hora) = $2`,
                [funcionarioId, hoje]
            )
            const totalBatidas = parseInt(batidasResult[0]?.total || '0')
            const sentido = totalBatidas % 2 === 0 ? 'ENTRADA' : 'SAIDA'

            // Gera NSR
            const nsrResult = await dbManager.queryCentral<any>(
                `SELECT COALESCE(MAX(nsr), 0) + 1 as next_nsr FROM ${schema}.registros_ponto WHERE nsr IS NOT NULL`
            )
            const nsr = String(nsrResult[0]?.next_nsr || 1).padStart(9, '0')

            // Registra ponto com GPS e foto (se fornecidos)
            const origem = isOffline ? 'APP_MOBILE_OFFLINE' : 'APP_MOBILE'
            await dbManager.queryCentral(
                `INSERT INTO ${schema}.registros_ponto
                 (funcionario_id, data_hora, sentido, tipo, origem, nsr, latitude, longitude, precisao_gps, foto_registro, localizacao_aproximada, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [funcionarioId, now, sentido, 'ORIGINAL', origem, nsr,
                 latitude || null, longitude || null, precisao_gps || null, foto_base64 || null,
                 localizacao_aproximada || sem_gps || false, new Date()]
            )

            const logGps = latitude ? ` GPS: ${latitude},${longitude}` : ''
            const logOffline = isOffline ? ' [OFFLINE]' : ''
            console.log(`[App Mobile] ${funcionario.nome} - ${sentido} às ${now.toLocaleTimeString('pt-BR')}${logGps}${logOffline}`)

            // Emite WebSocket
            try {
                const { websocketService } = await import('#services/websocket_service')
                websocketService.emitNovaBatida(entidadeId, {
                    funcionario_id: funcionario.id,
                    funcionario_nome: funcionario.nome,
                    data_hora: now.toISOString(),
                    sentido: sentido,
                    origem: 'APP_MOBILE',
                    latitude,
                    longitude
                })
            } catch {
                // Ignora erro de WebSocket
            }

            return response.json({
                success: true,
                registro: {
                    tipo: sentido,
                    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    latitude,
                    longitude
                }
            })
        } catch (error: any) {
            console.error('[App Registrar] Erro:', error)
            return response.status(500).json({ error: 'Erro ao registrar ponto' })
        }
    }

    /**
     * Lista registros do dia (com coordenadas GPS)
     */
    async registrosHoje({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            // Usar timezone de Brasília para consistência com o registro
            const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
            console.log('[App RegistrosHoje] Buscando registros de', hoje, 'para funcionario', funcionarioId)

            const registros = await dbManager.queryCentral<any>(`
                SELECT id, data_hora, sentido as tipo, latitude, longitude
                FROM ${schema}.registros_ponto
                WHERE funcionario_id = $1 AND DATE(data_hora AT TIME ZONE 'America/Sao_Paulo') = $2
                ORDER BY data_hora DESC
            `, [funcionarioId, hoje])
            
            console.log('[App RegistrosHoje] Encontrados', registros.length, 'registros')

            return response.json({
                registros: registros.map((r: any) => ({
                    id: r.id,
                    tipo: r.tipo,
                    hora: new Date(r.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    latitude: r.latitude,
                    longitude: r.longitude
                }))
            })
        } catch (error: any) {
            console.error('[App Registros] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Logout
     */
    async logout({ response, session }: HttpContext) {
        session.forget('app_funcionario_id')
        session.forget('app_schema')
        session.forget('app_entidade_id')
        return response.json({ success: true })
    }

    /**
     * Histórico de registros (últimos 30 dias)
     */
    async historico({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Busca registros dos últimos 30 dias
            const registros = await dbManager.queryCentral<any>(`
                SELECT id, data_hora, sentido as tipo
                FROM ${schema}.registros_ponto
                WHERE funcionario_id = $1
                  AND data_hora >= NOW() - INTERVAL '30 days'
                ORDER BY data_hora DESC
            `, [funcionarioId])

            return response.json({
                registros: registros.map((r: any) => ({
                    id: r.id,
                    data: new Date(r.data_hora).toISOString().split('T')[0],
                    tipo: r.tipo,
                    hora: new Date(r.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                }))
            })
        } catch (error: any) {
            console.error('[App Historico] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Banco de horas do funcionário
     */
    async bancoHoras({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Calcula saldo total
            const saldoResult = await dbManager.queryCentral<any>(`
                SELECT COALESCE(SUM(
                    CASE
                        WHEN tipo_operacao = 'CREDITO' THEN minutos
                        WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
                        ELSE minutos
                    END
                ), 0) as saldo
                FROM ${schema}.banco_horas
                WHERE funcionario_id = $1
            `, [funcionarioId])

            const saldo = parseInt(saldoResult[0]?.saldo || '0')

            // Busca últimas movimentações
            const movimentacoes = await dbManager.queryCentral<any>(`
                SELECT id, data, tipo_operacao, minutos, descricao
                FROM ${schema}.banco_horas
                WHERE funcionario_id = $1
                ORDER BY data DESC, created_at DESC
                LIMIT 20
            `, [funcionarioId])

            return response.json({
                saldo,
                movimentacoes: movimentacoes.map((m: any) => ({
                    id: m.id,
                    data: m.data,
                    tipo_operacao: m.tipo_operacao,
                    minutos: m.tipo_operacao === 'CREDITO' ? m.minutos : -Math.abs(m.minutos),
                    descricao: m.descricao
                }))
            })
        } catch (error: any) {
            console.error('[App Banco Horas] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', saldo: 0, movimentacoes: [] })
        }
    }

    /**
     * Perfil completo do funcionário
     */
    async perfil({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            const result = await dbManager.queryCentral<any>(`
                SELECT
                    f.id, f.nome, f.cpf, f.matricula, f.pis,
                    f.data_nascimento, f.data_admissao,
                    c.nome as cargo,
                    l.nome as lotacao,
                    s.nome as secretaria,
                    j.nome as jornada_nome,
                    j.carga_horaria_diaria,
                    tv.nome as tipo_vinculo
                FROM ${schema}.funcionarios f
                LEFT JOIN ${schema}.cargos c ON c.id = f.cargo_id
                LEFT JOIN ${schema}.lotacoes l ON l.id = f.lotacao_id
                LEFT JOIN ${schema}.secretarias s ON s.id = l.secretaria_id
                LEFT JOIN ${schema}.jornadas j ON j.id = f.jornada_id
                LEFT JOIN ${schema}.tipos_vinculo tv ON tv.id = f.tipo_vinculo_id
                WHERE f.id = $1 AND f.ativo = true
            `, [funcionarioId])

            if (result.length === 0) {
                return response.status(404).json({ error: 'Funcionário não encontrado' })
            }

            const func = result[0]

            return response.json({
                id: func.id,
                nome: func.nome,
                cpf: func.cpf,
                matricula: func.matricula,
                pis: func.pis,
                data_nascimento: func.data_nascimento,
                data_admissao: func.data_admissao,
                cargo: func.cargo || 'Não informado',
                lotacao: func.lotacao || 'Não informada',
                secretaria: func.secretaria || 'Não informada',
                jornada: func.jornada_nome || 'Não informada',
                carga_horaria: func.carga_horaria_diaria ? `${Math.floor(func.carga_horaria_diaria / 60)}h` : '8h',
                tipo_vinculo: func.tipo_vinculo || 'Não informado'
            })
        } catch (error: any) {
            console.error('[App Perfil] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Informações do dia (feriado, ponto facultativo)
     */
    async diaInfo({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const hoje = new Date().toISOString().split('T')[0]
            const diaSemana = new Date().getDay() // 0=Dom, 6=Sab

            // Verifica feriado
            let feriado = null
            try {
                const feriadoResult = await dbManager.queryCentral<any>(`
                    SELECT nome, tipo FROM ${schema}.feriados
                    WHERE data = $1 AND ativo = true
                    LIMIT 1
                `, [hoje])

                if (feriadoResult.length > 0) {
                    feriado = feriadoResult[0]
                }
            } catch {
                // Tabela pode não existir
            }

            // Verifica ponto facultativo
            let pontoFacultativo = null
            try {
                const facultativoResult = await dbManager.queryCentral<any>(`
                    SELECT descricao FROM ${schema}.pontos_facultativos
                    WHERE data = $1 AND ativo = true
                    LIMIT 1
                `, [hoje])

                if (facultativoResult.length > 0) {
                    pontoFacultativo = facultativoResult[0].descricao
                }
            } catch {
                // Tabela pode não existir
            }

            // Verifica se é fim de semana
            const fimDeSemana = diaSemana === 0 || diaSemana === 6

            return response.json({
                data: hoje,
                dia_semana: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][diaSemana],
                feriado: feriado ? { nome: feriado.nome, tipo: feriado.tipo } : null,
                ponto_facultativo: pontoFacultativo,
                fim_de_semana: fimDeSemana,
                trabalhar: !feriado && !fimDeSemana
            })
        } catch (error: any) {
            console.error('[App DiaInfo] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Jornada do funcionário
     */
    async jornada({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Busca jornada do funcionário
            const jornadaResult = await dbManager.queryCentral<any>(`
                SELECT j.*
                FROM ${schema}.funcionarios f
                JOIN ${schema}.jornadas j ON j.id = f.jornada_id
                WHERE f.id = $1
            `, [funcionarioId])

            if (jornadaResult.length === 0) {
                return response.json({
                    nome: 'Jornada Padrão',
                    carga_horaria: '08:00',
                    horarios: null
                })
            }

            const jornada = jornadaResult[0]

            // Busca horários por dia da semana
            let horarios: any[] = []
            try {
                horarios = await dbManager.queryCentral<any>(`
                    SELECT dia_semana, entrada_1, saida_1, entrada_2, saida_2, folga
                    FROM ${schema}.jornada_horarios
                    WHERE jornada_id = $1
                    ORDER BY dia_semana
                `, [jornada.id])
            } catch {
                // Tabela pode não existir
            }

            const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

            return response.json({
                nome: jornada.nome,
                carga_horaria: jornada.carga_horaria_diaria ?
                    `${String(Math.floor(jornada.carga_horaria_diaria / 60)).padStart(2, '0')}:${String(jornada.carga_horaria_diaria % 60).padStart(2, '0')}` : '08:00',
                tolerancia_entrada: jornada.tolerancia_entrada || 10,
                tolerancia_saida: jornada.tolerancia_saida || 10,
                horarios: horarios.map((h: any) => ({
                    dia: diasSemana[h.dia_semana],
                    folga: h.folga,
                    entrada_1: h.entrada_1?.substring(0, 5),
                    saida_1: h.saida_1?.substring(0, 5),
                    entrada_2: h.entrada_2?.substring(0, 5),
                    saida_2: h.saida_2?.substring(0, 5)
                }))
            })
        } catch (error: any) {
            console.error('[App Jornada] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Espelho de ponto do mês
     */
    async espelho({ params, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        console.log('[API Espelho] funcionarioId:', funcionarioId, 'schema:', schema, 'mes:', params.mes, 'ano:', params.ano)

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        const mes = parseInt(params.mes) || new Date().getMonth() + 1
        const ano = parseInt(params.ano) || new Date().getFullYear()
        
        console.log('[API Espelho] Buscando mes:', mes, 'ano:', ano)

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const { DateTime } = await import('luxon')

            // Busca espelho de ponto
            const espelhoResult = await dbManager.queryCentral<any>(`
                SELECT
                    ep.*,
                    f.nome as aprovador_nome
                FROM ${schema}.espelhos_ponto ep
                LEFT JOIN ${schema}.funcionarios f ON f.id = ep.aprovado_por
                WHERE ep.funcionario_id = $1 AND ep.mes = $2 AND ep.ano = $3
            `, [funcionarioId, mes, ano])

            // Se não tem espelho gerado, busca registros diretamente
            if (espelhoResult.length === 0) {
                const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`
                const ultimoDia = new Date(ano, mes, 0).getDate()
                const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`

                const registros = await dbManager.queryCentral<any>(`
                    SELECT DATE(data_hora) as data, data_hora, sentido
                    FROM ${schema}.registros_ponto
                    WHERE funcionario_id = $1
                      AND data_hora >= $2
                      AND data_hora <= $3::date + interval '1 day'
                    ORDER BY data_hora
                `, [funcionarioId, dataInicio, dataFim])

                // Agrupa por dia
                const diasMap: Record<string, any[]> = {}
                for (const r of registros) {
                    const dataStr = new Date(r.data_hora).toISOString().split('T')[0]
                    if (!diasMap[dataStr]) diasMap[dataStr] = []
                    diasMap[dataStr].push(r)
                }

                const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
                const dias: any[] = []

                // Gera lista de dias do mês
                for (let d = 1; d <= ultimoDia; d++) {
                    const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                    const dataObj = new Date(dataStr + 'T12:00:00')
                    const regs = diasMap[dataStr] || []
                    
                    let entrada = '--:--'
                    let saida = '--:--'
                    let total = '--:--'

                    if (regs.length > 0) {
                        // Primeira entrada
                        const entradas = regs.filter((r: any) => r.sentido === 'ENTRADA')
                        const saidas = regs.filter((r: any) => r.sentido === 'SAIDA')
                        
                        if (entradas.length > 0) {
                            entrada = new Date(entradas[0].data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                        }
                        if (saidas.length > 0) {
                            saida = new Date(saidas[saidas.length - 1].data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                        }

                        // Calcula total (simplificado)
                        if (entradas.length > 0 && saidas.length > 0) {
                            let totalMin = 0
                            for (let i = 0; i < Math.min(entradas.length, saidas.length); i++) {
                                const e = new Date(entradas[i].data_hora)
                                const s = new Date(saidas[i].data_hora)
                                totalMin += (s.getTime() - e.getTime()) / 60000
                            }
                            const h = Math.floor(totalMin / 60)
                            const m = Math.floor(totalMin % 60)
                            total = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                        }
                    }

                    dias.push({
                        dia: d,
                        dia_semana: diasSemana[dataObj.getDay()],
                        entrada,
                        saida,
                        total,
                        feriado: false,
                        falta: regs.length === 0 && dataObj.getDay() !== 0 && dataObj.getDay() !== 6
                    })
                }

                console.log('[API Espelho] Retornando', dias.length, 'dias para', mes + '/' + ano)
                return response.json({
                    mes, ano,
                    status: 'NAO_GERADO',
                    dias,
                    total_mes: null
                })
            }

            const espelho = espelhoResult[0]

            // Formata horas
            const formatarMinutos = (min: number) => {
                const h = Math.floor(Math.abs(min) / 60)
                const m = Math.abs(min) % 60
                return `${min < 0 ? '-' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
            }

            // Quando tem espelho gerado, converte os dados para formato do frontend
            const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
            let diasRaw: any[] = []
            if (espelho.dados) {
                if (Array.isArray(espelho.dados)) {
                    diasRaw = espelho.dados
                } else if (espelho.dados.dias && Array.isArray(espelho.dados.dias)) {
                    diasRaw = espelho.dados.dias
                }
            }
            
            // Converter para formato esperado pelo frontend
            const dias = diasRaw.map((d: any) => {
                // Extrair dia do mês da data
                const diaNum = d.data ? new Date(d.data + 'T12:00:00').getDate() : d.dia
                
                // Extrair entrada/saída dos registros ou usar direto
                let entrada = d.entrada || '--:--'
                let saida = d.saida || '--:--'
                if (d.registros && d.registros.length > 0) {
                    // Registros podem ser strings ISO ou objetos
                    const registrosNormalizados = d.registros.map((r: any, idx: number) => {
                        if (typeof r === 'string') {
                            // É uma string ISO - converter para objeto
                            const dt = new Date(r)
                            const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
                            // Determinar tipo pelo índice (par=entrada, ímpar=saída)
                            return { hora, tipo: idx % 2 === 0 ? 'ENTRADA' : 'SAIDA' }
                        }
                        return r
                    })
                    
                    const entradas = registrosNormalizados.filter((r: any) => r.tipo === 'ENTRADA' || r.sentido === 'ENTRADA')
                    const saidas = registrosNormalizados.filter((r: any) => r.tipo === 'SAIDA' || r.sentido === 'SAIDA')
                    
                    if (entradas.length > 0 && entrada === '--:--') {
                        entrada = entradas[0].hora || '--:--'
                    }
                    if (saidas.length > 0 && saida === '--:--') {
                        saida = saidas[saidas.length - 1].hora || '--:--'
                    }
                }
                
                // Calcular total
                let total = d.total || '--:--'
                if (!d.total && d.horasTrabalhadas && d.horasTrabalhadas > 0) {
                    const h = Math.floor(d.horasTrabalhadas / 60)
                    const m = d.horasTrabalhadas % 60
                    total = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
                }
                
                // Dia da semana
                const diaSemanaNum = d.diaSemana !== undefined ? d.diaSemana : (d.data ? new Date(d.data + 'T12:00:00').getDay() : null)
                const diaSemanaStr = d.dia_semana || (diaSemanaNum !== null ? diasSemana[diaSemanaNum] : '')
                
                return {
                    dia: diaNum,
                    dia_semana: diaSemanaStr,
                    entrada,
                    saida,
                    total,
                    falta: d.falta || false,
                    feriado: d.feriado || false,
                    folga: d.folga || false
                }
            })
            
            console.log('[API Espelho] Espelho gerado, dias:', dias.length, 'primeiro:', JSON.stringify(dias[0]))

            return response.json({
                mes, ano,
                status: espelho.status,
                dias_trabalhados: espelho.dias_trabalhados,
                horas_trabalhadas: formatarMinutos(espelho.horas_trabalhadas || 0),
                horas_extras: formatarMinutos(espelho.horas_extras || 0),
                horas_faltantes: formatarMinutos(espelho.horas_faltantes || 0),
                atrasos: formatarMinutos(espelho.atrasos || 0),
                faltas: espelho.faltas || 0,
                aprovado_por: espelho.aprovador_nome,
                aprovado_em: espelho.aprovado_em,
                total_mes: formatarMinutos(espelho.horas_trabalhadas || 0),
                dias: dias
            })
        } catch (error: any) {
            console.error('[App Espelho] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Mensagens para o funcionário
     */
    async mensagens({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Busca notificações do funcionário (últimos 30 dias)
            // Para notificações de "todos" (funcionario_id IS NULL), verifica a tabela de leituras
            // Exclui notificações marcadas como ocultas pelo funcionário
            let mensagens: any[] = []
            console.log('[API Mensagens] Buscando para funcionarioId:', funcionarioId, 'schema:', schema)
            try {
                mensagens = await dbManager.queryCentral<any>(`
                    SELECT
                        n.id, n.titulo, n.mensagem, n.tipo, n.categoria, n.funcionario_id, n.created_at,
                        CASE
                            WHEN n.funcionario_id IS NOT NULL THEN n.lida
                            ELSE (nl.id IS NOT NULL)
                        END as lida,
                        COALESCE(n.lida_em, nl.lida_em) as lida_em
                    FROM ${schema}.notificacoes n
                    LEFT JOIN ${schema}.notificacoes_leituras nl ON nl.notificacao_id = n.id AND nl.funcionario_id = $1
                    WHERE (n.funcionario_id = $2 OR n.funcionario_id IS NULL)
                      AND n.created_at >= CURRENT_DATE - INTERVAL '30 days'
                      AND (nl.oculta IS NULL OR nl.oculta = false)
                    ORDER BY n.created_at DESC
                    LIMIT 20
                `, [funcionarioId, funcionarioId])
            } catch (err: any) {
                console.log('[API Mensagens] Erro na query:', err?.message)
            }
            console.log('[API Mensagens] Encontradas:', mensagens.length, 'mensagens')

            return response.json({
                mensagens: mensagens.map((m: any) => ({
                    id: m.id,
                    titulo: m.titulo,
                    mensagem: m.mensagem,
                    tipo: m.tipo || 'INFO',
                    categoria: m.categoria || 'SISTEMA',
                    lida: m.lida || false,
                    created_at: m.created_at
                })),
                nao_lidas: mensagens.filter((m: any) => !m.lida).length
            })
        } catch (error: any) {
            console.error('[App Mensagens] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', mensagens: [], nao_lidas: 0 })
        }
    }

    /**
     * Marcar mensagem como lida
     */
    async marcarMensagemLida({ params, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')
        const mensagemId = params.id

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Verifica se a notificação existe e se é individual ou para todos
            const notificacao = await dbManager.queryCentral<any>(`
                SELECT id, funcionario_id FROM ${schema}.notificacoes WHERE id = $1
            `, [mensagemId])

            if (notificacao.length === 0) {
                return response.status(404).json({ error: 'Notificação não encontrada' })
            }

            if (notificacao[0].funcionario_id !== null) {
                // Notificação individual - atualiza diretamente
                await dbManager.queryCentral(`
                    UPDATE ${schema}.notificacoes
                    SET lida = true, lida_em = NOW()
                    WHERE id = $1 AND funcionario_id = $2
                `, [mensagemId, funcionarioId])
            } else {
                // Notificação para todos - registra na tabela de leituras
                await dbManager.queryCentral(`
                    INSERT INTO ${schema}.notificacoes_leituras (notificacao_id, funcionario_id, lida_em)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (notificacao_id, funcionario_id) DO NOTHING
                `, [mensagemId, funcionarioId])
            }

            return response.json({ success: true })
        } catch (error: any) {
            console.error('[App Mensagem Lida] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Excluir mensagem
     * Só permite exclusão se a mensagem foi lida
     */
        async excluirMensagem({ params, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')
        const mensagemId = params.id

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Verifica se a notificação existe
            const notificacao = await dbManager.queryCentral<any>(`
                SELECT id, titulo FROM ${schema}.notificacoes WHERE id = $1
            `, [mensagemId])

            if (notificacao.length === 0) {
                return response.status(404).json({ error: 'Notificação não encontrada' })
            }

            // Para mensagens de TESTE, permite excluir diretamente
            const isTeste = notificacao[0].titulo?.toUpperCase().includes('TESTE')
            
            if (isTeste) {
                // Exclui da tabela de leituras primeiro (se existir)
                await dbManager.queryCentral(`
                    DELETE FROM ${schema}.notificacoes_leituras WHERE notificacao_id = $1
                `, [mensagemId]).catch(() => {})
                
                // Exclui a notificação
                await dbManager.queryCentral(`
                    DELETE FROM ${schema}.notificacoes WHERE id = $1
                `, [mensagemId])
                
                return response.json({ success: true, deleted: true })
            }

            // Para outras mensagens, apenas marca como oculta
            try {
                await dbManager.queryCentral(`
                    INSERT INTO ${schema}.notificacoes_leituras (notificacao_id, funcionario_id, lida_em, oculta)
                    VALUES ($1, $2, NOW(), true)
                    ON CONFLICT (notificacao_id, funcionario_id)
                    DO UPDATE SET oculta = true
                `, [mensagemId, funcionarioId])
            } catch (e) {
                // Se falhar o INSERT, tenta apenas marcar a notificação como lida
                await dbManager.queryCentral(`
                    UPDATE ${schema}.notificacoes SET lida = true WHERE id = $1
                `, [mensagemId]).catch(() => {})
            }

            return response.json({ success: true })
        } catch (error: any) {
            console.error('[App Mensagem Excluir] Erro:', error)
            return response.status(500).json({ error: 'Erro interno: ' + error.message })
        }
    }

    /**
     * Excluir múltiplas mensagens
     * Só exclui mensagens que foram lidas
     */
    async excluirMensagensLote({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')
        const { ids } = request.only(['ids'])

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        if (!Array.isArray(ids) || ids.length === 0) {
            return response.status(400).json({ error: 'Nenhuma mensagem selecionada' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            let excluidas = 0

            for (const mensagemId of ids) {
                // Verifica se a notificação existe e foi lida
                const notificacao = await dbManager.queryCentral<any>(`
                    SELECT n.id, n.funcionario_id, n.lida,
                           (SELECT COUNT(*) FROM ${schema}.notificacoes_leituras nl WHERE nl.notificacao_id = n.id AND nl.funcionario_id = $2) as lida_todos
                    FROM ${schema}.notificacoes n
                    WHERE n.id = $1
                `, [mensagemId, funcionarioId])

                if (notificacao.length === 0) continue

                const notif = notificacao[0]
                const foiLida = notif.funcionario_id !== null ? notif.lida : (parseInt(notif.lida_todos) > 0)

                if (!foiLida) continue // Ignora não lidas

                // Marca como oculta na tabela de leituras (não apaga do banco)
                await dbManager.queryCentral(`
                    INSERT INTO ${schema}.notificacoes_leituras (notificacao_id, funcionario_id, lida_em, oculta)
                    VALUES ($1, $2, NOW(), true)
                    ON CONFLICT (notificacao_id, funcionario_id)
                    DO UPDATE SET oculta = true
                `, [mensagemId, funcionarioId])
                excluidas++
            }

            return response.json({ success: true, excluidas })
        } catch (error: any) {
            console.error('[App Mensagens Excluir Lote] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Configuracao de presenca do funcionario
     * Retorna intervalo_presenca se o funcionario precisa marcar presenca
     */
    async presencaConfig({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Nao autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Garante que a coluna existe
            try {
                await dbManager.queryCentral(`
                    ALTER TABLE ${schema}.funcionarios ADD COLUMN IF NOT EXISTS
                    intervalo_presenca INTEGER DEFAULT NULL
                `, [])
            } catch {
                // Ignora se coluna ja existe
            }

            // Busca configuracao do funcionario
            const result = await dbManager.queryCentral<any>(`
                SELECT intervalo_presenca FROM ${schema}.funcionarios WHERE id = $1
            `, [funcionarioId])

            const intervalo = result[0]?.intervalo_presenca || null

            return response.json({
                ativo: intervalo !== null && intervalo > 0,
                intervalo_presenca: intervalo, // em minutos
                mensagem: intervalo ? `Marcar presenca a cada ${intervalo} minutos` : null
            })
        } catch (error: any) {
            console.error('[App PresencaConfig] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Ultima presenca registrada do funcionario
     */
    async ultimaPresenca({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Nao autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Garante que a tabela existe
            try {
                await dbManager.queryCentral(`
                    CREATE TABLE IF NOT EXISTS ${schema}.registros_presenca (
                        id SERIAL PRIMARY KEY,
                        funcionario_id INTEGER NOT NULL REFERENCES ${schema}.funcionarios(id),
                        data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        latitude DECIMAL(10, 8),
                        longitude DECIMAL(11, 8),
                        precisao_gps INTEGER,
                        foto_registro TEXT,
                        observacao TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                `, [])
            } catch {
                // Tabela ja existe
            }

            // Busca ultima presenca do dia
            const result = await dbManager.queryCentral<any>(`
                SELECT id, data_hora, latitude, longitude
                FROM ${schema}.registros_presenca
                WHERE funcionario_id = $1
                  AND data_hora::date = CURRENT_DATE
                ORDER BY data_hora DESC
                LIMIT 1
            `, [funcionarioId])

            if (result.length === 0) {
                // Se nao tem presenca, busca a hora da primeira ENTRADA do dia
                const entradaResult = await dbManager.queryCentral<any>(`
                    SELECT data_hora
                    FROM ${schema}.registros_ponto
                    WHERE funcionario_id = $1
                      AND DATE(data_hora AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE
                      AND sentido = 'ENTRADA'
                    ORDER BY data_hora ASC
                    LIMIT 1
                `, [funcionarioId])

                return response.json({
                    ultima_presenca: null,
                    primeira_entrada: entradaResult.length > 0 ? entradaResult[0].data_hora : null,
                    mensagem: 'Nenhuma presenca registrada hoje'
                })
            }

            const ultima = result[0]
            return response.json({
                ultima_presenca: {
                    id: ultima.id,
                    data_hora: ultima.data_hora,
                    latitude: ultima.latitude,
                    longitude: ultima.longitude
                }
            })
        } catch (error: any) {
            console.error('[App UltimaPresenca] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Registrar presenca com foto e GPS
     */
    async marcarPresenca({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Nao autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Dados da requisicao
            const latitude = request.input('latitude')
            const longitude = request.input('longitude')
            const precisao_gps = request.input('precisao_gps')
            const foto_base64 = request.input('foto_base64')
            const observacao = request.input('observacao')
            const data_hora_offline = request.input('data_hora_offline')
            const offline = request.input('offline')

            // Se vier de modo offline, usa a data/hora original do registro
            const dataHoraRegistro = data_hora_offline ? new Date(data_hora_offline) : new Date()
            const isOffline = offline || !!data_hora_offline

            // Garante que a tabela existe com coluna de origem
            try {
                await dbManager.queryCentral(`
                    CREATE TABLE IF NOT EXISTS ${schema}.registros_presenca (
                        id SERIAL PRIMARY KEY,
                        funcionario_id INTEGER NOT NULL REFERENCES ${schema}.funcionarios(id),
                        data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        latitude DECIMAL(10, 8),
                        longitude DECIMAL(11, 8),
                        precisao_gps INTEGER,
                        foto_registro TEXT,
                        observacao TEXT,
                        origem VARCHAR(50) DEFAULT 'APP_MOBILE',
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                `, [])
            } catch {
                // Tabela ja existe
            }

            // Adiciona coluna origem se nao existir
            try {
                await dbManager.queryCentral(`
                    ALTER TABLE ${schema}.registros_presenca ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'APP_MOBILE'
                `, [])
            } catch {
                // Coluna ja existe
            }

            // Insere registro de presenca
            const origem = isOffline ? 'APP_MOBILE_OFFLINE' : 'APP_MOBILE'
            const result = await dbManager.queryCentral<any>(`
                INSERT INTO ${schema}.registros_presenca
                    (funcionario_id, data_hora, latitude, longitude, precisao_gps, foto_registro, observacao, origem, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING id, data_hora
            `, [funcionarioId, dataHoraRegistro, latitude, longitude, precisao_gps, foto_base64, observacao, origem])

            if (isOffline) {
                console.log(`[App MarcarPresenca] Presenca offline sincronizada para funcionario ${funcionarioId}`)
            }

            const registro = result[0]

            // Busca intervalo para calcular proxima presenca
            const configResult = await dbManager.queryCentral<any>(`
                SELECT intervalo_presenca FROM ${schema}.funcionarios WHERE id = $1
            `, [funcionarioId])

            const intervalo = configResult[0]?.intervalo_presenca || 30
            const dataHora = new Date(registro.data_hora)
            const proximaPresenca = new Date(dataHora.getTime() + intervalo * 60000)

            return response.json({
                success: true,
                registro: {
                    id: registro.id,
                    data_hora: registro.data_hora,
                    hora: dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                },
                proxima_presenca: proximaPresenca.toISOString(),
                proxima_hora: proximaPresenca.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                mensagem: `Presenca registrada! Proxima as ${proximaPresenca.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            })
        } catch (error: any) {
            console.error('[App MarcarPresenca] Erro:', error)
            return response.status(500).json({ error: 'Erro ao registrar presenca' })
        }
    }

    /**
     * Historico de presencas do dia
     */
    async presencasHoje({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Nao autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            const result = await dbManager.queryCentral<any>(`
                SELECT id, data_hora, latitude, longitude, foto_registro
                FROM ${schema}.registros_presenca
                WHERE funcionario_id = $1
                  AND data_hora::date = CURRENT_DATE
                ORDER BY data_hora DESC
            `, [funcionarioId])

            return response.json({
                presencas: result.map((p: any) => ({
                    id: p.id,
                    data_hora: p.data_hora,
                    hora: new Date(p.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    latitude: p.latitude,
                    longitude: p.longitude,
                    foto_registro: p.foto_registro
                })),
                total: result.length
            })
        } catch (error: any) {
            console.error('[App PresencasHoje] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', presencas: [], total: 0 })
        }
    }

    // =========================================================================
    // MÓDULO DE ATENDIMENTOS (Agentes de Saúde, Visitas Domiciliares, etc)
    // =========================================================================

    /**
     * Configuração de atendimentos do funcionário
     * Retorna metas e configurações
     */
    async atendimentosConfig({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')
        console.log('[API AtendConfig] funcionarioId:', funcionarioId, 'schema:', schema)

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Busca cargo e lotação do funcionário
            const func = await dbManager.queryCentral<any>(`
                SELECT cargo_id, lotacao_id FROM ${schema}.funcionarios WHERE id = $1
            `, [funcionarioId])

            console.log('[API AtendConfig] Funcionario cargo_id:', func[0]?.cargo_id, 'lotacao_id:', func[0]?.lotacao_id)
            if (func.length === 0) {
                console.log('[API AtendConfig] Funcionario nao encontrado')
                return response.json({ ativo: false })
            }

            // Busca configuração (por funcionário, cargo ou lotação)
            const config = await dbManager.queryCentral<any>(`
                SELECT * FROM ${schema}.atendimentos_config
                WHERE ativo = true
                  AND (funcionario_id = $1 OR cargo_id = $2 OR lotacao_id = $3 OR (funcionario_id IS NULL AND cargo_id IS NULL AND lotacao_id IS NULL))
                ORDER BY funcionario_id NULLS LAST, cargo_id NULLS LAST, lotacao_id NULLS LAST
                LIMIT 1
            `, [funcionarioId, func[0].cargo_id, func[0].lotacao_id])

            console.log('[API AtendConfig] Config encontrada:', config.length > 0 ? 'SIM' : 'NAO')
            if (config.length === 0) {
                console.log('[API AtendConfig] Nenhuma config encontrada')
                return response.json({ ativo: false })
            }

            const cfg = config[0]
            console.log('[API AtendConfig] Retornando ativo=true')
            return response.json({
                ativo: true,
                tipo_atendimento: cfg.tipo_atendimento,
                meta_diaria: cfg.meta_diaria,
                meta_semanal: cfg.meta_semanal,
                meta_mensal: cfg.meta_mensal,
                tempo_minimo: cfg.tempo_minimo_minutos,
                tempo_maximo: cfg.tempo_maximo_minutos,
                exige_foto: cfg.exige_foto,
                exige_gps: cfg.exige_gps
            })
        } catch (error: any) {
            console.error('[App AtendimentosConfig] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', ativo: false })
        }
    }

    /**
     * Inicia um novo atendimento
     */
    async iniciarAtendimento({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            const body = request.body()
            
            // Aceita campos tanto do formato antigo quanto do novo
            const tipo_atendimento = body.tipo_atendimento || 'DOMICILIAR'
            const endereco = body.endereco || null
            const numero = body.numero || null
            const complemento = body.complemento || null
            const bairro = body.bairro || null
            const cidade = body.cidade || null
            const cep = body.cep || null
            const referencia = body.referencia || null
            const nome_atendido = body.nome_atendido || null
            const documento_atendido = body.documento_atendido || null
            const telefone_atendido = body.telefone_atendido || null
            
            // Converter latitude/longitude para número ou null
            const latRaw = body.latitude || body.latitude_inicio
            const lngRaw = body.longitude || body.longitude_inicio
            const latitude = latRaw ? parseFloat(latRaw) : null
            const longitude = lngRaw ? parseFloat(lngRaw) : null
            
            // Converter precisao para inteiro ou null
            const precRaw = body.precisao_gps || body.precisao_gps_inicio
            const precisao_gps = precRaw ? Math.round(parseFloat(precRaw)) : null
            
            const foto_base64 = body.foto_base64 || body.foto_inicio || null
            
            console.log('[IniciarAtendimento] Dados:', { latitude, longitude, precisao_gps })

            // Verifica se já tem atendimento em andamento
            const emAndamento = await dbManager.queryCentral<any>(`
                SELECT id FROM ${schema}.atendimentos
                WHERE funcionario_id = $1 AND status = 'EM_ANDAMENTO'
                LIMIT 1
            `, [funcionarioId])

            if (emAndamento.length > 0) {
                return response.status(400).json({
                    error: 'Você já possui um atendimento em andamento',
                    atendimento_id: emAndamento[0].id
                })
            }

            // Insere atendimento
            const result = await dbManager.queryCentral<any>(`
                INSERT INTO ${schema}.atendimentos (
                    funcionario_id, tipo_atendimento,
                    endereco, numero, complemento, bairro, cidade, cep, referencia,
                    nome_atendido, documento_atendido, telefone_atendido,
                    data_hora_inicio, latitude_inicio, longitude_inicio, precisao_gps_inicio, foto_inicio,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, 'EM_ANDAMENTO')
                RETURNING id, data_hora_inicio
            `, [
                funcionarioId, tipo_atendimento || 'DOMICILIAR',
                endereco, numero, complemento, bairro, cidade, cep, referencia,
                nome_atendido, documento_atendido, telefone_atendido,
                latitude, longitude, precisao_gps, foto_base64
            ])

            const atendimento = result[0]
            console.log(`[App Atendimento] Funcionário ${funcionarioId} iniciou atendimento ${atendimento.id}`)

            return response.json({
                success: true,
                atendimento: {
                    id: atendimento.id,
                    data_hora_inicio: atendimento.data_hora_inicio,
                    status: 'EM_ANDAMENTO'
                }
            })
        } catch (error: any) {
            console.error('[App IniciarAtendimento] Erro:', error)
            return response.status(500).json({ error: 'Erro ao iniciar atendimento' })
        }
    }

    /**
     * Finaliza um atendimento em andamento
     */
    async finalizarAtendimento({ params, request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const atendimentoId = params.id

            const body = request.body()
            
            // Aceita campos tanto do formato antigo quanto do novo
            // Converter latitude/longitude para número ou null
            const latRaw = body.latitude || body.latitude_fim
            const lngRaw = body.longitude || body.longitude_fim
            const latitude = latRaw ? parseFloat(latRaw) : null
            const longitude = lngRaw ? parseFloat(lngRaw) : null
            
            // Converter precisao para inteiro ou null
            const precRaw = body.precisao_gps || body.precisao_gps_fim
            const precisao_gps = precRaw ? Math.round(parseFloat(precRaw)) : null
            
            const foto_base64 = body.foto_base64 || body.foto_fim || null
            const observacoes = body.observacoes || null
            
            console.log('[FinalizarAtendimento] Dados:', { latitude, longitude, precisao_gps })

            // Busca atendimento
            const atendimento = await dbManager.queryCentral<any>(`
                SELECT id, data_hora_inicio, status
                FROM ${schema}.atendimentos
                WHERE id = $1 AND funcionario_id = $2
            `, [atendimentoId, funcionarioId])

            if (atendimento.length === 0) {
                return response.status(404).json({ error: 'Atendimento não encontrado' })
            }

            if (atendimento[0].status !== 'EM_ANDAMENTO') {
                return response.status(400).json({ error: 'Atendimento já foi finalizado' })
            }

            // Calcula duração
            const inicio = new Date(atendimento[0].data_hora_inicio)
            const fim = new Date()
            const duracaoMinutos = Math.round((fim.getTime() - inicio.getTime()) / 60000)

            // Atualiza atendimento
            await dbManager.queryCentral(`
                UPDATE ${schema}.atendimentos SET
                    data_hora_fim = NOW(),
                    latitude_fim = $1,
                    longitude_fim = $2,
                    precisao_gps_fim = $3,
                    foto_fim = $4,
                    observacoes = $5,
                    duracao_minutos = $6,
                    status = 'FINALIZADO',
                    updated_at = NOW()
                WHERE id = $7
            `, [latitude, longitude, precisao_gps, foto_base64, observacoes, duracaoMinutos, atendimentoId])

            console.log(`[App Atendimento] Funcionário ${funcionarioId} finalizou atendimento ${atendimentoId} (${duracaoMinutos} min)`)

            return response.json({
                success: true,
                duracao_minutos: duracaoMinutos
            })
        } catch (error: any) {
            console.error('[App FinalizarAtendimento] Erro:', error)
            return response.status(500).json({ error: 'Erro ao finalizar atendimento' })
        }
    }

    /**
     * Cancela um atendimento em andamento
     */
    async cancelarAtendimento({ params, request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const atendimentoId = params.id
            const { motivo } = request.body()

            // Atualiza atendimento
            const result = await dbManager.queryCentral(`
                UPDATE ${schema}.atendimentos SET
                    status = 'CANCELADO',
                    motivo_cancelamento = $1,
                    updated_at = NOW()
                WHERE id = $2 AND funcionario_id = $3 AND status = 'EM_ANDAMENTO'
            `, [motivo || 'Cancelado pelo usuário', atendimentoId, funcionarioId])

            return response.json({ success: true })
        } catch (error: any) {
            console.error('[App CancelarAtendimento] Erro:', error)
            return response.status(500).json({ error: 'Erro ao cancelar atendimento' })
        }
    }

    /**
     * Lista atendimentos do funcionário
     */
    async listarAtendimentos({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const { data, status } = request.qs()

            let whereClause = 'WHERE funcionario_id = $1'
            const params: any[] = [funcionarioId]
            let paramIndex = 2

            if (data) {
                whereClause += ` AND DATE(data_hora_inicio AT TIME ZONE 'America/Sao_Paulo') = $${paramIndex++}`
                params.push(data)
            } else {
                // Últimos 7 dias por padrão
                whereClause += ` AND data_hora_inicio >= NOW() - INTERVAL '7 days'`
            }

            if (status) {
                whereClause += ` AND status = $${paramIndex++}`
                params.push(status)
            }

            const atendimentos = await dbManager.queryCentral<any>(`
                SELECT id, tipo_atendimento, endereco, numero, bairro,
                       nome_atendido, data_hora_inicio, data_hora_fim,
                       status, duracao_minutos, observacoes,
                       latitude_inicio, longitude_inicio
                FROM ${schema}.atendimentos
                ${whereClause}
                ORDER BY data_hora_inicio DESC
                LIMIT 50
            `, params)

            return response.json({
                atendimentos: atendimentos.map((a: any) => ({
                    id: a.id,
                    tipo: a.tipo_atendimento,
                    endereco: a.endereco ? `${a.endereco}, ${a.numero || 'S/N'} - ${a.bairro || ''}` : null,
                    nome_atendido: a.nome_atendido,
                    data_hora_inicio: a.data_hora_inicio,
                    inicio: a.data_hora_inicio,
                    fim: a.data_hora_fim,
                    status: a.status,
                    duracao_minutos: a.duracao_minutos,
                    duracao: a.duracao_minutos,
                    observacoes: a.observacoes,
                    latitude_inicio: a.latitude_inicio ? parseFloat(a.latitude_inicio) : null,
                    longitude_inicio: a.longitude_inicio ? parseFloat(a.longitude_inicio) : null
                }))
            })
        } catch (error: any) {
            console.error('[App ListarAtendimentos] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', atendimentos: [] })
        }
    }

    /**
     * Atendimento em andamento (se houver)
     */
    async atendimentoEmAndamento({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            const atendimento = await dbManager.queryCentral<any>(`
                SELECT id, tipo_atendimento, endereco, numero, bairro,
                       nome_atendido, data_hora_inicio
                FROM ${schema}.atendimentos
                WHERE funcionario_id = $1 AND status = 'EM_ANDAMENTO'
                LIMIT 1
            `, [funcionarioId])

            if (atendimento.length === 0) {
                return response.json({ em_andamento: false })
            }

            const a = atendimento[0]
            const inicio = new Date(a.data_hora_inicio)
            const agora = new Date()
            const duracaoAtual = Math.round((agora.getTime() - inicio.getTime()) / 60000)

            return response.json({
                em_andamento: true,
                atendimento: {
                    id: a.id,
                    tipo: a.tipo_atendimento,
                    endereco: a.endereco ? `${a.endereco}, ${a.numero || 'S/N'} - ${a.bairro || ''}` : null,
                    nome_atendido: a.nome_atendido,
                    inicio: a.data_hora_inicio,
                    duracao_atual: duracaoAtual
                }
            })
        } catch (error: any) {
            console.error('[App AtendimentoEmAndamento] Erro:', error)
            return response.status(500).json({ error: 'Erro interno', em_andamento: false })
        }
    }

    /**
     * Resumo de atendimentos (metas vs realizado)
     */
    async resumoAtendimentos({ response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')

            // Busca cargo e lotação
            const func = await dbManager.queryCentral<any>(`
                SELECT cargo_id, lotacao_id FROM ${schema}.funcionarios WHERE id = $1
            `, [funcionarioId])

            // Busca configuração de metas
            let meta = { meta_diaria: 0, meta_semanal: 0, meta_mensal: 0 }
            if (func.length > 0) {
                const config = await dbManager.queryCentral<any>(`
                    SELECT meta_diaria, meta_semanal, meta_mensal
                    FROM ${schema}.atendimentos_config
                    WHERE ativo = true
                      AND (funcionario_id = $1 OR cargo_id = $2 OR lotacao_id = $3 OR (funcionario_id IS NULL AND cargo_id IS NULL AND lotacao_id IS NULL))
                    ORDER BY funcionario_id NULLS LAST, cargo_id NULLS LAST
                    LIMIT 1
                `, [funcionarioId, func[0].cargo_id, func[0].lotacao_id])

                if (config.length > 0) {
                    meta = config[0]
                }
            }

            // Conta atendimentos finalizados
            const hoje = await dbManager.queryCentral<any>(`
                SELECT COUNT(*) as total
                FROM ${schema}.atendimentos
                WHERE funcionario_id = $1
                  AND status = 'FINALIZADO'
                  AND DATE(data_hora_inicio AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE
            `, [funcionarioId])

            const semana = await dbManager.queryCentral<any>(`
                SELECT COUNT(*) as total
                FROM ${schema}.atendimentos
                WHERE funcionario_id = $1
                  AND status = 'FINALIZADO'
                  AND data_hora_inicio >= DATE_TRUNC('week', CURRENT_DATE)
            `, [funcionarioId])

            const mes = await dbManager.queryCentral<any>(`
                SELECT COUNT(*) as total
                FROM ${schema}.atendimentos
                WHERE funcionario_id = $1
                  AND status = 'FINALIZADO'
                  AND data_hora_inicio >= DATE_TRUNC('month', CURRENT_DATE)
            `, [funcionarioId])

            return response.json({
                hoje: {
                    realizado: parseInt(hoje[0].total),
                    meta: meta.meta_diaria,
                    percentual: meta.meta_diaria > 0 ? Math.round((parseInt(hoje[0].total) / meta.meta_diaria) * 100) : 0
                },
                semana: {
                    realizado: parseInt(semana[0].total),
                    meta: meta.meta_semanal,
                    percentual: meta.meta_semanal > 0 ? Math.round((parseInt(semana[0].total) / meta.meta_semanal) * 100) : 0
                },
                mes: {
                    realizado: parseInt(mes[0].total),
                    meta: meta.meta_mensal,
                    percentual: meta.meta_mensal > 0 ? Math.round((parseInt(mes[0].total) / meta.meta_mensal) * 100) : 0
                }
            })
        } catch (error: any) {
            console.error('[App ResumoAtendimentos] Erro:', error)
            return response.status(500).json({ error: 'Erro interno' })
        }
    }

    /**
     * Sincroniza registros offline do app Android
     * Recebe registro com CPF/matricula para identificar funcionario

    /**
     * Sincroniza registros offline do app Android
     */
    async syncOffline({ request, response }: HttpContext) {
        const { cpf, matricula, tipo, dataHora, latitude, longitude, id } = request.only([
            "cpf", "matricula", "tipo", "dataHora", "latitude", "longitude", "id"
        ])

        if (!cpf || !matricula || !dataHora) {
            return response.status(400).json({ error: "Dados incompletos" })
        }

        try {
            const { dbManager } = await import("#services/database_manager_service")

            const cpfLimpo = cpf.replace(/\D/g, "")
            const matriculaLimpa = matricula.toString().replace(/\D/g, "")

            const entidades = await dbManager.queryCentral<{ id: number; db_schema: string; nome: string }>(
                "SELECT id, db_schema, nome FROM public.entidades WHERE ativo = true AND db_schema IS NOT NULL"
            )

            let funcionarioEncontrado: any = null
            let entidadeEncontrada: any = null
            let schema: string = ""

            for (const entidade of entidades) {
                try {
                    const result = await dbManager.queryCentral<any>(`
                        SELECT id, nome, pis FROM ${entidade.db_schema}.funcionarios
                        WHERE cpf = $1 AND matricula = $2 AND ativo = true
                        LIMIT 1
                    `, [cpfLimpo, matriculaLimpa])

                    if (result.length > 0) {
                        funcionarioEncontrado = result[0]
                        entidadeEncontrada = entidade
                        schema = entidade.db_schema
                        break
                    }
                } catch (_err) { }
            }

            if (!funcionarioEncontrado || !schema) {
                return response.status(404).json({ error: "Funcionario nao encontrado" })
            }

            const dataHoraRegistro = new Date(dataHora)
            const hoje = dataHoraRegistro.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })

            // Verifica duplicata por data/hora exata
            const duplicata = await dbManager.queryCentral<any>(
                `SELECT id FROM ${schema}.registros_ponto WHERE funcionario_id = $1 AND data_hora = $2 LIMIT 1`,
                [funcionarioEncontrado.id, dataHoraRegistro]
            )
            if (duplicata.length > 0) {
                return response.json({ success: true, message: "Registro ja existe", id })
            }

            let sentido = tipo
            if (!sentido || (sentido !== "ENTRADA" && sentido !== "SAIDA")) {
                const batidasResult = await dbManager.queryCentral<any>(
                    `SELECT COUNT(*) as total FROM ${schema}.registros_ponto
                     WHERE funcionario_id = $1 AND DATE(data_hora) = $2`,
                    [funcionarioEncontrado.id, hoje]
                )
                const totalBatidas = parseInt(batidasResult[0]?.total || "0")
                sentido = totalBatidas % 2 === 0 ? "ENTRADA" : "SAIDA"
            }

            const nsrResult = await dbManager.queryCentral<any>(
                `SELECT COALESCE(MAX(nsr), 0) + 1 as next_nsr FROM ${schema}.registros_ponto WHERE nsr IS NOT NULL`
            )
            const nsr = String(nsrResult[0]?.next_nsr || 1).padStart(9, "0")

            await dbManager.queryCentral(
                `INSERT INTO ${schema}.registros_ponto
                 (funcionario_id, data_hora, sentido, tipo, origem, nsr, latitude, longitude, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [funcionarioEncontrado.id, dataHoraRegistro, sentido, "ORIGINAL", "APP_ANDROID_OFFLINE", nsr,
                 latitude || null, longitude || null, new Date()]
            )

            console.log(`[Sync Offline] ${funcionarioEncontrado.nome} - ${sentido} em ${dataHoraRegistro.toLocaleString("pt-BR")}`)

            try {
                const { websocketService } = await import("#services/websocket_service")
                websocketService.emitNovaBatida(entidadeEncontrada.id, {
                    funcionario_id: funcionarioEncontrado.id,
                    funcionario_nome: funcionarioEncontrado.nome,
                    data_hora: dataHoraRegistro.toISOString(),
                    sentido: sentido,
                    origem: "APP_ANDROID_OFFLINE",
                    latitude,
                    longitude
                })
            } catch (_wsErr) { }

            return response.json({ success: true, id, sentido })
        } catch (error: any) {
            console.error("[Sync Offline] Erro:", error)
            return response.status(500).json({ error: "Erro ao sincronizar" })
        }
    }

    // Registrar presença não marcada (falta)
    async registrarFaltaPresenca({ request, response, session }: HttpContext) {
        const funcionarioId = session.get('app_funcionario_id')
        const schema = session.get('app_schema')

        if (!funcionarioId || !schema) {
            return response.status(401).json({ error: 'Não autenticado' })
        }

        try {
            const { dbManager } = await import('#services/database_manager_service')
            const { hora_alvo, motivo } = request.body()

            // Insere registro de presença com status NAO_MARCADA
            await dbManager.queryCentral(`
                INSERT INTO ${schema}.registros_presenca 
                (funcionario_id, data_hora, status, observacao, created_at)
                VALUES ($1, $2, 'NAO_MARCADA', $3, NOW())
            `, [funcionarioId, hora_alvo, motivo || 'Não marcada dentro do prazo de 10 minutos'])

            console.log('[Presenca] Falta registrada para funcionario:', funcionarioId, 'hora:', hora_alvo)
            return response.json({ success: true })
        } catch (e: any) {
            console.error('[Presenca] Erro ao registrar falta:', e)
            return response.status(500).json({ error: e.message })
        }
    }

}