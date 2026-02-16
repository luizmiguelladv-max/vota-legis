import type { HttpContext } from '@adonisjs/core/http'
import { dbManager } from '#services/database_manager_service'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import { calculoPontoService } from '#services/calculo_ponto_service'
import EspelhoPontoService from '#services/espelho_ponto_service'

export default class PontoController {
  /**
   * Lista registros de ponto com filtros e paginação
   */
  async listarRegistros({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const municipioId = tenant.municipioId

    // Parâmetros
    const draw = request.input('draw', 1)
    const start = request.input('start', 0)
    const length = request.input('length', 25)
    const searchValue = request.input('search[value]', '')
    const funcionarioId = request.input('funcionario_id')
    const lotacaoId = request.input('lotacao_id')
    const origem = request.input('origem')
    const dataInicio = request.input('data_inicio')
    const dataFim = request.input('data_fim')

    try {
      let baseQuery = `
        FROM registros_ponto rp
        JOIN funcionarios f ON f.id = rp.funcionario_id
        LEFT JOIN equipamentos e ON e.id = rp.equipamento_id
        LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        WHERE 1=1
      `
      const params: any[] = []
      let paramIndex = 1

      // Filtro de funcionário
      if (funcionarioId) {
        baseQuery += ` AND rp.funcionario_id = $${paramIndex++}`
        params.push(funcionarioId)
      }

      // Filtro de lotação
      if (lotacaoId) {
        baseQuery += ` AND f.lotacao_id = $${paramIndex++}`
        params.push(lotacaoId)
      }

      // Filtro de origem
      if (origem) {
        baseQuery += ` AND rp.origem = $${paramIndex++}`
        params.push(origem)
      }

      // Filtro de período
      if (dataInicio) {
        baseQuery += ` AND DATE(rp.data_hora) >= $${paramIndex++}`
        params.push(dataInicio)
      }

      if (dataFim) {
        baseQuery += ` AND DATE(rp.data_hora) <= $${paramIndex++}`
        params.push(dataFim)
      }

      // Filtro de busca
      if (searchValue) {
        baseQuery += ` AND (f.nome ILIKE $${paramIndex} OR f.matricula ILIKE $${paramIndex})`
        params.push(`%${searchValue}%`)
        paramIndex++
      }

      // Total
      const [totalResult] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count ${baseQuery}`,
        params
      )

      // Dados paginados
      const dataQuery = `
        SELECT rp.id, rp.data_hora, rp.tipo, rp.origem, rp.nsr,
               rp.justificativa, rp.justificado_em,
               f.id as funcionario_id, f.nome as funcionario_nome, f.matricula,
               e.nome as equipamento_nome
        ${baseQuery}
        ORDER BY rp.data_hora DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `
      params.push(length, start)

      const data = await dbManager.queryMunicipio(municipioId, dataQuery, params)

      return response.json({
        draw: Number(draw),
        recordsTotal: Number(totalResult?.count || 0),
        recordsFiltered: Number(totalResult?.count || 0),
        data,
      })
    } catch (error) {
      console.error('Erro ao listar registros:', error)
      return response.internalServerError({ error: 'Erro ao listar registros' })
    }
  }

  /**
   * Adiciona marcação manual de ponto
   */
  async adicionarMarcacao({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    // Verifica permissão
    if (
      !tenant.isSuperAdmin &&
      !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')
    ) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    const { funcionario_id, data_hora, tipo, justificativa } = request.only([
      'funcionario_id',
      'data_hora',
      'tipo',
      'justificativa',
    ])

    try {
      const [result] = await dbManager.queryMunicipio<{ id: number }>(
        tenant.municipioId,
        `INSERT INTO registros_ponto (funcionario_id, data_hora, tipo, origem, justificativa, justificado_por, justificado_em)
         VALUES ($1, $2, $3, 'MANUAL', $4, $5, NOW())
         RETURNING id`,
        [funcionario_id, data_hora, tipo || null, justificativa, tenant.usuario?.funcionario_id]
      )

      // Auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'MARCACAO_MANUAL',
        tabela: 'registros_ponto',
        registroId: result.id,
        dadosNovos: { funcionario_id, data_hora, tipo, justificativa },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.created({ success: true, id: result.id })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao adicionar marcação' })
    }
  }

  /**
   * Obtém espelho de ponto de um funcionário
   */
  async obterEspelho({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano } = request.qs()

    if (!funcionario_id || !mes || !ano) {
      return response.badRequest({ error: 'Informe funcionário, mês e ano' })
    }

    try {
      // Busca espelho existente no banco
      const espelhoSalvo = await dbManager.queryMunicipioOne<{
        id: number
        funcionario_id: number
        mes: number
        ano: number
        dias_trabalhados: number
        horas_trabalhadas: number
        horas_extras: number
        horas_faltantes: number
        atrasos: number
        faltas: number
        status: string
        dados: any
      }>(
        tenant.municipioId,
        `SELECT * FROM espelhos_ponto WHERE funcionario_id = $1 AND mes = $2 AND ano = $3`,
        [funcionario_id, mes, ano]
      )

      // Busca funcionário
      const funcionario = await dbManager.queryMunicipioOne(
        tenant.municipioId,
        `SELECT f.*, j.nome as jornada_nome, j.carga_horaria_diaria, j.carga_horaria_semanal,
                l.nome as lotacao_nome, s.nome as secretaria_nome
         FROM funcionarios f
         LEFT JOIN jornadas j ON j.id = f.jornada_id
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
         LEFT JOIN secretarias s ON s.id = f.secretaria_id
         WHERE f.id = $1`,
        [funcionario_id]
      )

      // Se tem espelho salvo, retorna com os dados
      if (espelhoSalvo) {
        return response.json({
          ...espelhoSalvo,
          funcionario,
          calculado: false,
        })
      }

      // Se não existe, calcula em tempo real
      const espelhoCalculado = await calculoPontoService.calcularEspelho(
        tenant.municipioId,
        Number(funcionario_id),
        Number(mes),
        Number(ano)
      )

      return response.json({
        funcionario_id: Number(funcionario_id),
        mes: Number(mes),
        ano: Number(ano),
        status: 'ABERTO',
        dias_trabalhados: espelhoCalculado.totais.diasTrabalhados,
        horas_trabalhadas: espelhoCalculado.totais.horasTrabalhadas,
        horas_extras: espelhoCalculado.totais.horasExtras,
        horas_faltantes: espelhoCalculado.totais.horasFaltantes,
        atrasos: espelhoCalculado.totais.atrasos,
        faltas: espelhoCalculado.totais.faltas,
        dados: { dias: espelhoCalculado.dias },
        funcionario,
        calculado: true,
      })
    } catch (error) {
      console.error('Erro ao obter espelho:', error)
      return response.internalServerError({ error: 'Erro ao obter espelho' })
    }
  }

  /**
   * Lista espelhos de ponto
   */
  async listarEspelhos({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano, status, lotacao_id, jornada_id } = request.qs()

    try {
      let query = `
        SELECT ep.*, f.nome as funcionario_nome, f.matricula,
               l.nome as lotacao_nome, j.nome as jornada_nome
        FROM espelhos_ponto ep
        JOIN funcionarios f ON f.id = ep.funcionario_id
        LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        LEFT JOIN jornadas j ON j.id = f.jornada_id
        WHERE 1=1
      `
      const params: any[] = []
      let paramIndex = 1

      if (funcionario_id) {
        query += ` AND ep.funcionario_id = $${paramIndex++}`
        params.push(funcionario_id)
      }

      if (mes) {
        query += ` AND ep.mes = $${paramIndex++}`
        params.push(mes)
      }

      if (ano) {
        query += ` AND ep.ano = $${paramIndex++}`
        params.push(ano)
      }

      if (status) {
        query += ` AND ep.status = $${paramIndex++}`
        params.push(status)
      }

      if (lotacao_id) {
        query += ` AND f.lotacao_id = $${paramIndex++}`
        params.push(lotacao_id)
      }

      if (jornada_id) {
        query += ` AND f.jornada_id = $${paramIndex++}`
        params.push(jornada_id)
      }

      query += ` ORDER BY f.nome`

      const espelhos = await dbManager.queryMunicipio(tenant.municipioId, query, params)

      return response.json(espelhos)
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao listar espelhos' })
    }
  }

  /**
   * Processa/fecha período de ponto
   * Calcula horas trabalhadas, extras, faltantes, atrasos e faltas
   */
  async processarPeriodo({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    const { mes, ano, funcionario_ids } = request.only(['mes', 'ano', 'funcionario_ids'])

    if (!mes || !ano) {
      return response.badRequest({ error: 'Informe mês e ano' })
    }

    try {
      // Usa o serviço para processar o período
      const resultado = await calculoPontoService.processarPeriodo(
        tenant.municipioId,
        Number(mes),
        Number(ano),
        funcionario_ids
      )

      // Auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'PROCESSAR_PERIODO',
        tabela: 'espelhos_ponto',
        dadosNovos: { mes, ano, funcionario_ids, resultado },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({
        success: true,
        message: `Período processado com sucesso. ${resultado.processados} funcionários processados, ${resultado.erros} erros.`,
        ...resultado,
      })
    } catch (error) {
      console.error('Erro ao processar período:', error)
      return response.internalServerError({ error: 'Erro ao processar período' })
    }
  }

  /**
   * Aprova espelho de ponto
   * Quando aprovado, integra automaticamente com banco de horas:
   * - Horas extras → Crédito no banco de horas
   * - Horas faltantes → Débito no banco de horas
   */
  async aprovarEspelho({ params, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (
      !tenant.isSuperAdmin &&
      !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')
    ) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    try {
      // Busca dados do espelho antes de aprovar
      const espelho = await dbManager.queryMunicipioOne<{
        id: number
        funcionario_id: number
        mes: number
        ano: number
        horas_extras: number
        horas_faltantes: number
        dados: any
      }>(
        tenant.municipioId,
        `SELECT id, funcionario_id, mes, ano,
                COALESCE(horas_extras, 0) as horas_extras,
                COALESCE(horas_faltantes, 0) as horas_faltantes,
                dados
         FROM espelhos_ponto WHERE id = $1`,
        [params.id]
      )

      if (!espelho) {
        return response.notFound({ error: 'Espelho não encontrado' })
      }

      // Verifica configuração de banco de horas
      const configBH = await dbManager.queryMunicipioOne<{
        ativo: boolean
        converter_he_50_para_banco: boolean
      }>(
        tenant.municipioId,
        `SELECT ativo, converter_he_50_para_banco FROM banco_horas_config WHERE id = 1`
      )

      const bancoHorasAtivo = configBH?.ativo !== false

      // Atualiza status do espelho
      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE espelhos_ponto
         SET status = 'APROVADO',
             aprovado_por = $1,
             aprovado_em = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [tenant.usuario?.funcionario_id, params.id]
      )

      // Integração com Banco de Horas (se ativo)
      if (bancoHorasAtivo) {
        const dataReferencia = `${espelho.ano}-${String(espelho.mes).padStart(2, '0')}-01`

        // Busca saldo atual do funcionário
        const [saldoAtual] = await dbManager.queryMunicipio<{ saldo: number }>(
          tenant.municipioId,
          `SELECT COALESCE(SUM(minutos), 0) as saldo FROM banco_horas WHERE funcionario_id = $1`,
          [espelho.funcionario_id]
        )
        const saldoAnterior = saldoAtual?.saldo || 0

        // Se tem horas extras, cria crédito
        if (espelho.horas_extras > 0) {
          const novoSaldo = saldoAnterior + espelho.horas_extras
          await dbManager.queryMunicipio(
            tenant.municipioId,
            `INSERT INTO banco_horas
              (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao)
             VALUES ($1, $2, 'CREDITO', $3, $4, $5, 'ESPELHO', $6)
             ON CONFLICT DO NOTHING`,
            [
              espelho.funcionario_id,
              dataReferencia,
              espelho.horas_extras,
              saldoAnterior,
              novoSaldo,
              `Horas extras - Espelho ${String(espelho.mes).padStart(2, '0')}/${espelho.ano}`
            ]
          )
        }

        // Se tem horas faltantes, cria débito
        if (espelho.horas_faltantes > 0) {
          const saldoAposCredito = saldoAnterior + (espelho.horas_extras || 0)
          const novoSaldo = saldoAposCredito - espelho.horas_faltantes
          await dbManager.queryMunicipio(
            tenant.municipioId,
            `INSERT INTO banco_horas
              (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao)
             VALUES ($1, $2, 'DEBITO', $3, $4, $5, 'ESPELHO', $6)
             ON CONFLICT DO NOTHING`,
            [
              espelho.funcionario_id,
              dataReferencia,
              -espelho.horas_faltantes, // Negativo para débito
              saldoAposCredito,
              novoSaldo,
              `Horas faltantes - Espelho ${String(espelho.mes).padStart(2, '0')}/${espelho.ano}`
            ]
          )
        }
      }

      // Criar notificação para o funcionário
      try {
        const mesNome = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][espelho.mes]
        await dbManager.queryMunicipio(
          tenant.municipioId,
          `INSERT INTO notificacoes (funcionario_id, titulo, mensagem, tipo, categoria, action_url)
           VALUES ($1, $2, $3, 'SUCESSO', 'APROVACAO', '/espelho')`,
          [
            espelho.funcionario_id,
            'Espelho de Ponto Aprovado',
            `Seu espelho de ponto de ${mesNome}/${espelho.ano} foi aprovado.`
          ]
        )
      } catch (e) {
        // Ignora erro de notificação
      }

      return response.json({ success: true, banco_horas_integrado: bancoHorasAtivo })
    } catch (error) {
      console.error('[Espelho] Erro ao aprovar:', error)
      return response.internalServerError({ error: 'Erro ao aprovar espelho' })
    }
  }

  /**
   * Adiciona justificativa ao espelho
   */
  async adicionarJustificativa({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { justificativa } = request.only(['justificativa'])

    try {
      // Busca espelho atual
      const espelho = await dbManager.queryMunicipioOne<{ dados: any }>(
        tenant.municipioId,
        `SELECT dados FROM espelhos_ponto WHERE id = $1`,
        [params.id]
      )

      if (!espelho) {
        return response.notFound({ error: 'Espelho não encontrado' })
      }

      // Adiciona justificativa aos dados
      const dados = espelho.dados || {}
      dados.justificativas = dados.justificativas || []
      dados.justificativas.push({
        texto: justificativa,
        usuario_id: tenant.usuario?.id,
        data: DateTime.now().toISO(),
      })

      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE espelhos_ponto SET dados = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(dados), params.id]
      )

      return response.json({ success: true })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao adicionar justificativa' })
    }
  }

  /**
   * Obtém banco de horas do funcionário
   */
  async obterBancoHoras({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id } = request.qs()

    if (!funcionario_id) {
      return response.badRequest({ error: 'Informe o funcionário' })
    }

    try {
      // Soma de horas extras e faltantes de todos os espelhos aprovados
      const [resultado] = await dbManager.queryMunicipio<{
        total_extras: number
        total_faltantes: number
      }>(
        tenant.municipioId,
        `SELECT
           COALESCE(SUM(horas_extras), 0) as total_extras,
           COALESCE(SUM(horas_faltantes), 0) as total_faltantes
         FROM espelhos_ponto
         WHERE funcionario_id = $1 AND status = 'APROVADO'`,
        [funcionario_id]
      )

      const saldo = (resultado?.total_extras || 0) - (resultado?.total_faltantes || 0)

      return response.json({
        funcionario_id: Number(funcionario_id),
        horas_extras: resultado?.total_extras || 0,
        horas_faltantes: resultado?.total_faltantes || 0,
        saldo,
        saldo_formatado: `${Math.floor(Math.abs(saldo) / 60)}h${Math.abs(saldo) % 60}min`,
        positivo: saldo >= 0,
      })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao obter banco de horas' })
    }
  }

  /**
   * Download do espelho em PDF
   */
  async downloadPDF({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano } = request.qs()

    if (!funcionario_id || !mes || !ano) {
      return response.badRequest({ error: 'Informe funcionário, mês e ano' })
    }

    try {
      const pdfBuffer = await EspelhoPontoService.gerarPDF(
        tenant.municipioId,
        Number(funcionario_id),
        Number(mes),
        Number(ano)
      )

      const funcionario = await dbManager.queryMunicipioOne<{ nome: string }>(
        tenant.municipioId,
        `SELECT nome FROM funcionarios WHERE id = $1`,
        [funcionario_id]
      )

      const nomeArquivo = `espelho_${funcionario?.nome?.replace(/\s+/g, '_') || funcionario_id}_${mes}_${ano}.pdf`

      response.header('Content-Type', 'application/pdf')
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
      return response.send(pdfBuffer)
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      return response.internalServerError({ error: 'Erro ao gerar PDF' })
    }
  }

  /**
   * Download do espelho em Excel
   */
  async downloadExcel({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, mes, ano } = request.qs()

    if (!funcionario_id || !mes || !ano) {
      return response.badRequest({ error: 'Informe funcionário, mês e ano' })
    }

    try {
      const excelBuffer = await EspelhoPontoService.gerarExcel(
        tenant.municipioId,
        Number(funcionario_id),
        Number(mes),
        Number(ano)
      )

      const funcionario = await dbManager.queryMunicipioOne<{ nome: string }>(
        tenant.municipioId,
        `SELECT nome FROM funcionarios WHERE id = $1`,
        [funcionario_id]
      )

      const nomeArquivo = `espelho_${funcionario?.nome?.replace(/\s+/g, '_') || funcionario_id}_${mes}_${ano}.xlsx`

      response.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
      return response.send(excelBuffer)
    } catch (error) {
      console.error('Erro ao gerar Excel:', error)
      return response.internalServerError({ error: 'Erro ao gerar Excel' })
    }
  }

  /**
   * Reabre espelho de ponto (volta de FECHADO para ABERTO)
   */
  async reabrirEspelho({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para reabrir espelhos' })
    }

    const { motivo } = request.only(['motivo'])

    try {
      // Verifica status atual
      const espelho = await dbManager.queryMunicipioOne<{ status: string; dados: any }>(
        tenant.municipioId,
        `SELECT status, dados FROM espelhos_ponto WHERE id = $1`,
        [params.id]
      )

      if (!espelho) {
        return response.notFound({ error: 'Espelho não encontrado' })
      }

      if (espelho.status === 'APROVADO') {
        return response.badRequest({ error: 'Espelho aprovado não pode ser reaberto. Solicite reprovação.' })
      }

      // Adiciona histórico de reabertura
      const dados = espelho.dados || {}
      dados.historico = dados.historico || []
      dados.historico.push({
        acao: 'REABERTO',
        status_anterior: espelho.status,
        motivo,
        usuario_id: tenant.usuario?.id,
        data: DateTime.now().toISO(),
      })

      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE espelhos_ponto
         SET status = 'ABERTO',
             dados = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(dados), params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'REABRIR_ESPELHO',
        tabela: 'espelhos_ponto',
        registroId: Number(params.id),
        dadosNovos: { motivo, status_anterior: espelho.status },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true, message: 'Espelho reaberto com sucesso' })
    } catch (error) {
      console.error('Erro ao reabrir espelho:', error)
      return response.internalServerError({ error: 'Erro ao reabrir espelho' })
    }
  }

  /**
   * Reprova espelho de ponto
   */
  async reprovarEspelho({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para reprovar espelhos' })
    }

    const { motivo } = request.only(['motivo'])

    if (!motivo) {
      return response.badRequest({ error: 'Informe o motivo da reprovação' })
    }

    try {
      const espelho = await dbManager.queryMunicipioOne<{ status: string; dados: any }>(
        tenant.municipioId,
        `SELECT status, dados FROM espelhos_ponto WHERE id = $1`,
        [params.id]
      )

      if (!espelho) {
        return response.notFound({ error: 'Espelho não encontrado' })
      }

      // Adiciona histórico de reprovação
      const dados = espelho.dados || {}
      dados.historico = dados.historico || []
      dados.historico.push({
        acao: 'REPROVADO',
        status_anterior: espelho.status,
        motivo,
        usuario_id: tenant.usuario?.id,
        data: DateTime.now().toISO(),
      })

      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE espelhos_ponto
         SET status = 'ABERTO',
             aprovado_por = NULL,
             aprovado_em = NULL,
             dados = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(dados), params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'REPROVAR_ESPELHO',
        tabela: 'espelhos_ponto',
        registroId: Number(params.id),
        dadosNovos: { motivo, status_anterior: espelho.status },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true, message: 'Espelho reprovado. Funcionário deve corrigir pendências.' })
    } catch (error) {
      console.error('Erro ao reprovar espelho:', error)
      return response.internalServerError({ error: 'Erro ao reprovar espelho' })
    }
  }

  /**
   * Aprova múltiplos espelhos em lote
   */
  async aprovarEmLote({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para aprovar espelhos' })
    }

    const { ids } = request.only(['ids'])

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return response.badRequest({ error: 'Informe os IDs dos espelhos' })
    }

    try {
      // Verifica configuração de banco de horas
      const configBH = await dbManager.queryMunicipioOne<{ ativo: boolean }>(
        tenant.municipioId,
        `SELECT ativo FROM banco_horas_config WHERE id = 1`
      )
      const bancoHorasAtivo = configBH?.ativo !== false

      // Busca dados dos espelhos antes de aprovar (para integração com banco de horas)
      const placeholdersSelect = ids.map((_, i) => `$${i + 1}`).join(',')
      const espelhos = await dbManager.queryMunicipio<{
        id: number
        funcionario_id: number
        mes: number
        ano: number
        horas_extras: number
        horas_faltantes: number
      }>(
        tenant.municipioId,
        `SELECT id, funcionario_id, mes, ano,
                COALESCE(horas_extras, 0) as horas_extras,
                COALESCE(horas_faltantes, 0) as horas_faltantes
         FROM espelhos_ponto
         WHERE id IN (${placeholdersSelect}) AND status = 'FECHADO'`,
        [...ids]
      )

      // Atualiza status dos espelhos
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(',')
      const result = await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE espelhos_ponto
         SET status = 'APROVADO',
             aprovado_por = $1,
             aprovado_em = NOW(),
             updated_at = NOW()
         WHERE id IN (${placeholders}) AND status = 'FECHADO'
         RETURNING id`,
        [tenant.usuario?.funcionario_id, ...ids]
      )

      const aprovados = result.length

      // Integração com Banco de Horas (se ativo)
      if (bancoHorasAtivo && espelhos.length > 0) {
        for (const espelho of espelhos) {
          const dataReferencia = `${espelho.ano}-${String(espelho.mes).padStart(2, '0')}-01`

          // Busca saldo atual do funcionário
          const [saldoAtual] = await dbManager.queryMunicipio<{ saldo: number }>(
            tenant.municipioId,
            `SELECT COALESCE(SUM(minutos), 0) as saldo FROM banco_horas WHERE funcionario_id = $1`,
            [espelho.funcionario_id]
          )
          const saldoAnterior = saldoAtual?.saldo || 0

          // Se tem horas extras, cria crédito
          if (espelho.horas_extras > 0) {
            const novoSaldo = saldoAnterior + espelho.horas_extras
            await dbManager.queryMunicipio(
              tenant.municipioId,
              `INSERT INTO banco_horas
                (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao)
               VALUES ($1, $2, 'CREDITO', $3, $4, $5, 'ESPELHO', $6)
               ON CONFLICT DO NOTHING`,
              [
                espelho.funcionario_id,
                dataReferencia,
                espelho.horas_extras,
                saldoAnterior,
                novoSaldo,
                `Horas extras - Espelho ${String(espelho.mes).padStart(2, '0')}/${espelho.ano}`
              ]
            )
          }

          // Se tem horas faltantes, cria débito
          if (espelho.horas_faltantes > 0) {
            const saldoAposCredito = saldoAnterior + (espelho.horas_extras || 0)
            const novoSaldo = saldoAposCredito - espelho.horas_faltantes
            await dbManager.queryMunicipio(
              tenant.municipioId,
              `INSERT INTO banco_horas
                (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao)
               VALUES ($1, $2, 'DEBITO', $3, $4, $5, 'ESPELHO', $6)
               ON CONFLICT DO NOTHING`,
              [
                espelho.funcionario_id,
                dataReferencia,
                -espelho.horas_faltantes,
                saldoAposCredito,
                novoSaldo,
                `Horas faltantes - Espelho ${String(espelho.mes).padStart(2, '0')}/${espelho.ano}`
              ]
            )
          }
        }
      }

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'APROVAR_ESPELHOS_LOTE',
        tabela: 'espelhos_ponto',
        dadosNovos: { ids, aprovados, banco_horas_integrado: bancoHorasAtivo },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({
        success: true,
        message: `${aprovados} espelho(s) aprovado(s) com sucesso`,
        aprovados,
        banco_horas_integrado: bancoHorasAtivo
      })
    } catch (error) {
      console.error('Erro ao aprovar em lote:', error)
      return response.internalServerError({ error: 'Erro ao aprovar espelhos' })
    }
  }

  /**
   * Edita uma marcação de ponto existente
   */
  async editarMarcacao({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para editar marcações' })
    }

    const { data_hora, justificativa } = request.only(['data_hora', 'justificativa'])

    if (!data_hora) {
      return response.badRequest({ error: 'Informe a nova data/hora' })
    }

    if (!justificativa) {
      return response.badRequest({ error: 'Justificativa é obrigatória para edições' })
    }

    try {
      // Busca registro original
      const registro = await dbManager.queryMunicipioOne<{
        id: number
        funcionario_id: number
        data_hora: string
      }>(
        tenant.municipioId,
        `SELECT id, funcionario_id, data_hora FROM registros_ponto WHERE id = $1`,
        [params.id]
      )

      if (!registro) {
        return response.notFound({ error: 'Registro não encontrado' })
      }

      // Verifica se há espelho aprovado para este período
      const dataRegistro = DateTime.fromISO(registro.data_hora)
      const espelhoAprovado = await dbManager.queryMunicipioOne<{ id: number }>(
        tenant.municipioId,
        `SELECT id FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [registro.funcionario_id, dataRegistro.month, dataRegistro.year]
      )

      if (espelhoAprovado) {
        return response.badRequest({
          error: 'Não é possível editar registros de espelho aprovado. Solicite reprovação primeiro.'
        })
      }

      // Atualiza registro
      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE registros_ponto
         SET data_hora = $1,
             justificativa = $2,
             justificado_por = $3,
             justificado_em = NOW(),
             origem = 'MANUAL',
             updated_at = NOW()
         WHERE id = $4`,
        [data_hora, justificativa, tenant.usuario?.funcionario_id, params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'EDITAR_MARCACAO',
        tabela: 'registros_ponto',
        registroId: Number(params.id),
        dadosAnteriores: { data_hora: registro.data_hora },
        dadosNovos: { data_hora, justificativa },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true, message: 'Marcação atualizada com sucesso' })
    } catch (error) {
      console.error('Erro ao editar marcação:', error)
      return response.internalServerError({ error: 'Erro ao editar marcação' })
    }
  }

  /**
   * Exclui uma marcação de ponto
   */
  async excluirMarcacao({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para excluir marcações' })
    }

    const { justificativa } = request.only(['justificativa'])

    if (!justificativa) {
      return response.badRequest({ error: 'Justificativa é obrigatória para exclusão' })
    }

    try {
      // Busca registro original
      const registro = await dbManager.queryMunicipioOne<{
        id: number
        funcionario_id: number
        data_hora: string
      }>(
        tenant.municipioId,
        `SELECT id, funcionario_id, data_hora FROM registros_ponto WHERE id = $1`,
        [params.id]
      )

      if (!registro) {
        return response.notFound({ error: 'Registro não encontrado' })
      }

      // Verifica se há espelho aprovado
      const dataRegistro = DateTime.fromISO(registro.data_hora)
      const espelhoAprovado = await dbManager.queryMunicipioOne<{ id: number }>(
        tenant.municipioId,
        `SELECT id FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [registro.funcionario_id, dataRegistro.month, dataRegistro.year]
      )

      if (espelhoAprovado) {
        return response.badRequest({
          error: 'Não é possível excluir registros de espelho aprovado.'
        })
      }

      // Exclui registro
      await dbManager.queryMunicipio(
        tenant.municipioId,
        `DELETE FROM registros_ponto WHERE id = $1`,
        [params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'EXCLUIR_MARCACAO',
        tabela: 'registros_ponto',
        registroId: Number(params.id),
        dadosAnteriores: registro,
        dadosNovos: { justificativa },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true, message: 'Marcação excluída com sucesso' })
    } catch (error) {
      console.error('Erro ao excluir marcação:', error)
      return response.internalServerError({ error: 'Erro ao excluir marcação' })
    }
  }

  /**
   * Exporta registros de ponto em Excel ou PDF
   */
  async exportarRegistros({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const formato = request.input('formato', 'excel')
    const funcionarioId = request.input('funcionario_id')
    const lotacaoId = request.input('lotacao_id')
    const origem = request.input('origem')
    const dataInicio = request.input('data_inicio')
    const dataFim = request.input('data_fim')

    try {
      let query = `
        SELECT rp.data_hora, f.nome as funcionario, f.matricula,
               rp.tipo, rp.origem, e.nome as equipamento,
               rp.justificativa, l.nome as lotacao
        FROM registros_ponto rp
        JOIN funcionarios f ON f.id = rp.funcionario_id
        LEFT JOIN equipamentos e ON e.id = rp.equipamento_id
        LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        WHERE 1=1
      `
      const params: any[] = []
      let paramIndex = 1

      if (funcionarioId) {
        query += ` AND rp.funcionario_id = $${paramIndex++}`
        params.push(funcionarioId)
      }

      if (lotacaoId) {
        query += ` AND f.lotacao_id = $${paramIndex++}`
        params.push(lotacaoId)
      }

      if (origem) {
        query += ` AND rp.origem = $${paramIndex++}`
        params.push(origem)
      }

      if (dataInicio) {
        query += ` AND DATE(rp.data_hora) >= $${paramIndex++}`
        params.push(dataInicio)
      }

      if (dataFim) {
        query += ` AND DATE(rp.data_hora) <= $${paramIndex++}`
        params.push(dataFim)
      }

      query += ` ORDER BY rp.data_hora DESC LIMIT 5000`

      const registros = await dbManager.queryMunicipio(tenant.municipioId, query, params)

      if (formato === 'excel') {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Registros de Ponto')

        sheet.columns = [
          { header: 'Data/Hora', key: 'data_hora', width: 20 },
          { header: 'Funcionário', key: 'funcionario', width: 30 },
          { header: 'Matrícula', key: 'matricula', width: 15 },
          { header: 'Lotação', key: 'lotacao', width: 25 },
          { header: 'Tipo', key: 'tipo', width: 12 },
          { header: 'Origem', key: 'origem', width: 12 },
          { header: 'Equipamento', key: 'equipamento', width: 20 },
          { header: 'Justificativa', key: 'justificativa', width: 30 },
        ]

        // Estilo do cabeçalho
        sheet.getRow(1).font = { bold: true }
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        }
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

        registros.forEach((reg: any) => {
          sheet.addRow({
            data_hora: reg.data_hora ? new Date(reg.data_hora).toLocaleString('pt-BR') : '',
            funcionario: reg.funcionario,
            matricula: reg.matricula,
            lotacao: reg.lotacao || '',
            tipo: reg.tipo || 'REG',
            origem: reg.origem || 'REP',
            equipamento: reg.equipamento || '',
            justificativa: reg.justificativa || '',
          })
        })

        const buffer = await workbook.xlsx.writeBuffer()
        const nomeArquivo = `registros_ponto_${dataInicio || 'all'}_${dataFim || 'all'}.xlsx`

        response.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
        return response.send(buffer)
      }

      // PDF
      // @ts-ignore - pdfkit types
      const PDFDocument = (await import('pdfkit')).default
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' })

      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))

      // Cabeçalho
      doc.fontSize(16).text('Relatório de Registros de Ponto', { align: 'center' })
      doc.fontSize(10).text(`Período: ${dataInicio || 'Início'} a ${dataFim || 'Fim'}`, { align: 'center' })
      doc.moveDown()

      // Cabeçalho da tabela
      const startY = doc.y
      const colWidths = [80, 150, 60, 100, 60, 60, 80]
      const headers = ['Data/Hora', 'Funcionário', 'Matrícula', 'Lotação', 'Tipo', 'Origem', 'Equipamento']

      doc.fontSize(8).font('Helvetica-Bold')
      let x = 30
      headers.forEach((h, i) => {
        doc.text(h, x, startY, { width: colWidths[i], align: 'left' })
        x += colWidths[i]
      })

      doc.moveTo(30, startY + 12).lineTo(750, startY + 12).stroke()
      doc.y = startY + 15

      // Dados
      doc.font('Helvetica').fontSize(7)
      registros.slice(0, 100).forEach((reg: any) => {
        if (doc.y > 550) {
          doc.addPage()
          doc.y = 30
        }

        x = 30
        const row = [
          reg.data_hora ? new Date(reg.data_hora).toLocaleString('pt-BR') : '',
          reg.funcionario?.substring(0, 25) || '',
          reg.matricula || '',
          reg.lotacao?.substring(0, 15) || '',
          reg.tipo || 'REG',
          reg.origem || 'REP',
          reg.equipamento?.substring(0, 12) || '',
        ]

        row.forEach((val, i) => {
          doc.text(val, x, doc.y, { width: colWidths[i], align: 'left', lineBreak: false })
          x += colWidths[i]
        })
        doc.moveDown(0.5)
      })

      doc.end()

      return new Promise((resolve) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks)
          const nomeArquivo = `registros_ponto_${dataInicio || 'all'}_${dataFim || 'all'}.pdf`

          response.header('Content-Type', 'application/pdf')
          response.header('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
          resolve(response.send(pdfBuffer))
        })
      })
    } catch (error) {
      console.error('Erro ao exportar registros:', error)
      return response.internalServerError({ error: 'Erro ao exportar registros' })
    }
  }
}
