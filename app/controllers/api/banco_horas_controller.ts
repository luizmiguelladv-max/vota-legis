import type { HttpContext } from '@adonisjs/core/http'
import { dbManager } from '#services/database_manager_service'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'

export default class BancoHorasController {
  /**
   * Lista saldo de banco de horas de todos os funcionários
   */
  async listarSaldos({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      const { lotacao_id, secretaria_id, mes, ano } = request.qs()
      const mesAtual = mes || DateTime.now().month
      const anoAtual = ano || DateTime.now().year

      let query = `
        SELECT
          f.id as funcionario_id,
          f.nome,
          f.matricula,
          l.nome as lotacao_nome,
          COALESCE(bhs.saldo_final, 0) as saldo_atual,
          COALESCE(bhs.creditos, 0) as creditos_mes,
          COALESCE(bhs.debitos, 0) as debitos_mes,
          COALESCE(bhs.compensacoes, 0) as compensacoes_mes,
          (SELECT COALESCE(SUM(CASE WHEN tipo_operacao = 'CREDITO' THEN minutos ELSE -minutos END), 0)
           FROM banco_horas bh WHERE bh.funcionario_id = f.id) as saldo_total
        FROM funcionarios f
        LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        LEFT JOIN secretarias s ON s.id = l.secretaria_id
        LEFT JOIN banco_horas_saldo bhs ON bhs.funcionario_id = f.id
          AND bhs.mes = $1 AND bhs.ano = $2
        WHERE f.ativo = true
      `
      const params: any[] = [mesAtual, anoAtual]
      let paramIndex = 3

      if (lotacao_id) {
        query += ` AND f.lotacao_id = $${paramIndex++}`
        params.push(lotacao_id)
      }

      if (secretaria_id) {
        query += ` AND s.id = $${paramIndex++}`
        params.push(secretaria_id)
      }

      query += ` ORDER BY f.nome`

      const saldos = await dbManager.queryMunicipio(tenant.municipioId, query, params)

      return response.json({
        data: saldos,
        mes: mesAtual,
        ano: anoAtual
      })
    } catch (error) {
      console.error('Erro ao listar saldos:', error)
      return response.internalServerError({ error: 'Erro ao listar saldos' })
    }
  }

  /**
   * Obtém extrato de banco de horas de um funcionário
   */
  async obterExtrato({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, data_inicio, data_fim } = request.qs()

    if (!funcionario_id) {
      return response.badRequest({ error: 'Informe o funcionário' })
    }

    try {
      // Busca funcionário
      const funcionario = await dbManager.queryMunicipioOne(
        tenant.municipioId,
        `SELECT f.*, l.nome as lotacao_nome, j.nome as jornada_nome
         FROM funcionarios f
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
         LEFT JOIN jornadas j ON j.id = f.jornada_id
         WHERE f.id = $1`,
        [funcionario_id]
      )

      if (!funcionario) {
        return response.notFound({ error: 'Funcionário não encontrado' })
      }

      // Query base do extrato
      let query = `
        SELECT bh.*,
               ap.nome as aprovador_nome
        FROM banco_horas bh
        LEFT JOIN funcionarios ap ON ap.id = bh.aprovado_por
        WHERE bh.funcionario_id = $1
      `
      const params: any[] = [funcionario_id]
      let paramIndex = 2

      if (data_inicio) {
        query += ` AND bh.data >= $${paramIndex++}`
        params.push(data_inicio)
      }

      if (data_fim) {
        query += ` AND bh.data <= $${paramIndex++}`
        params.push(data_fim)
      }

      query += ` ORDER BY bh.data DESC, bh.id DESC`

      const movimentacoes = await dbManager.queryMunicipio(tenant.municipioId, query, params)

      // Calcula saldo total
      const [saldoResult] = await dbManager.queryMunicipio<{ saldo: number }>(
        tenant.municipioId,
        `SELECT COALESCE(SUM(
          CASE
            WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
            WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
            ELSE 0
          END
        ), 0) as saldo
        FROM banco_horas
        WHERE funcionario_id = $1`,
        [funcionario_id]
      )

      return response.json({
        funcionario,
        movimentacoes,
        saldo_total: saldoResult?.saldo || 0,
        saldo_formatado: formatarMinutos(saldoResult?.saldo || 0)
      })
    } catch (error) {
      console.error('Erro ao obter extrato:', error)
      return response.internalServerError({ error: 'Erro ao obter extrato' })
    }
  }

  /**
   * Adiciona movimentação no banco de horas
   */
  async adicionarMovimentacao({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    const { funcionario_id, data, tipo_operacao, minutos, descricao, observacao } = request.only([
      'funcionario_id', 'data', 'tipo_operacao', 'minutos', 'descricao', 'observacao'
    ])

    if (!funcionario_id || !data || !tipo_operacao || !minutos) {
      return response.badRequest({ error: 'Campos obrigatórios: funcionario_id, data, tipo_operacao, minutos' })
    }

    try {
      // Busca configurações de limite
      const config = await dbManager.queryMunicipioOne<{
        limite_acumulo_positivo: number
        limite_acumulo_negativo: number
      }>(
        tenant.municipioId,
        `SELECT limite_acumulo_positivo, limite_acumulo_negativo FROM banco_horas_config WHERE id = 1`
      )

      const limitePositivo = config?.limite_acumulo_positivo || 2400 // 40h
      const limiteNegativo = config?.limite_acumulo_negativo || 600 // 10h

      // Verifica se já existe lançamento duplicado (mesmo dia, tipo e funcionário)
      const [duplicado] = await dbManager.queryMunicipio<{ count: number }>(
        tenant.municipioId,
        `SELECT COUNT(*) as count FROM banco_horas
         WHERE funcionario_id = $1 AND data = $2 AND tipo_operacao = $3 AND origem = 'MANUAL'`,
        [funcionario_id, data, tipo_operacao]
      )

      if (duplicado?.count > 0) {
        return response.badRequest({
          error: `Já existe um lançamento de ${tipo_operacao} para este funcionário na data ${data}`
        })
      }

      // Verifica se o período está fechado (espelho aprovado)
      const dataObj = DateTime.fromISO(data)
      const [espelhoFechado] = await dbManager.queryMunicipio<{ count: number }>(
        tenant.municipioId,
        `SELECT COUNT(*) as count FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [funcionario_id, dataObj.month, dataObj.year]
      )

      if (espelhoFechado?.count > 0) {
        return response.badRequest({
          error: `O espelho de ponto de ${dataObj.monthLong}/${dataObj.year} está fechado. Não é possível alterar o banco de horas.`
        })
      }

      // Busca saldo atual
      const [saldoAtual] = await dbManager.queryMunicipio<{ saldo: number }>(
        tenant.municipioId,
        `SELECT COALESCE(SUM(
          CASE
            WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
            WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
            ELSE 0
          END
        ), 0) as saldo
        FROM banco_horas
        WHERE funcionario_id = $1`,
        [funcionario_id]
      )

      const saldoAnterior = saldoAtual?.saldo || 0
      let novoSaldo = saldoAnterior

      // Calcula novo saldo
      if (['CREDITO'].includes(tipo_operacao) || (tipo_operacao === 'AJUSTE' && minutos > 0)) {
        novoSaldo += Math.abs(minutos)
      } else {
        novoSaldo -= Math.abs(minutos)
      }

      // Valida limites de acúmulo
      if (novoSaldo > limitePositivo) {
        return response.badRequest({
          error: `Operação excede o limite de acúmulo positivo (${formatarMinutos(limitePositivo)}). Saldo atual: ${formatarMinutos(saldoAnterior)}, Novo saldo seria: ${formatarMinutos(novoSaldo)}`
        })
      }

      if (novoSaldo < -limiteNegativo) {
        return response.badRequest({
          error: `Operação excede o limite de acúmulo negativo (${formatarMinutos(limiteNegativo)}). Saldo atual: ${formatarMinutos(saldoAnterior)}, Novo saldo seria: ${formatarMinutos(novoSaldo)}`
        })
      }

      // Verifica se está próximo do limite para notificação
      const percentualPositivo = (novoSaldo / limitePositivo) * 100
      const percentualNegativo = Math.abs(novoSaldo) / limiteNegativo * 100
      let alertaSaldo = false

      if (novoSaldo > 0 && percentualPositivo >= 80) {
        alertaSaldo = true
        // Cria notificação para o funcionário e RH
        await dbManager.queryMunicipio(
          tenant.municipioId,
          `INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, link, created_at)
           SELECT u.id, 'Banco de Horas próximo do limite',
             $1, 'ALERTA', '/banco-horas', NOW()
           FROM usuarios u
           WHERE u.funcionario_id = $2 OR u.perfil IN ('ADMIN', 'RH')
           ON CONFLICT DO NOTHING`,
          [
            `O saldo de banco de horas está em ${formatarMinutos(novoSaldo)} (${percentualPositivo.toFixed(0)}% do limite máximo).`,
            funcionario_id
          ]
        )
      } else if (novoSaldo < 0 && percentualNegativo >= 80) {
        alertaSaldo = true
        await dbManager.queryMunicipio(
          tenant.municipioId,
          `INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, link, created_at)
           SELECT u.id, 'Banco de Horas negativo crítico',
             $1, 'ALERTA', '/banco-horas', NOW()
           FROM usuarios u
           WHERE u.funcionario_id = $2 OR u.perfil IN ('ADMIN', 'RH')
           ON CONFLICT DO NOTHING`,
          [
            `O saldo negativo de banco de horas está em ${formatarMinutos(novoSaldo)} (${percentualNegativo.toFixed(0)}% do limite).`,
            funcionario_id
          ]
        )
      }

      // Insere movimentação
      const [result] = await dbManager.queryMunicipio<{ id: number }>(
        tenant.municipioId,
        `INSERT INTO banco_horas
          (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao, observacao, aprovado, aprovado_por, aprovado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $8, true, $9, NOW())
         RETURNING id`,
        [funcionario_id, data, tipo_operacao, Math.abs(minutos), saldoAnterior, novoSaldo, descricao, observacao, tenant.usuario?.funcionario_id]
      )

      // Auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'ADICIONAR_BANCO_HORAS',
        tabela: 'banco_horas',
        registroId: result.id,
        dadosNovos: { funcionario_id, data, tipo_operacao, minutos, descricao },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.created({
        success: true,
        id: result.id,
        saldo_anterior: saldoAnterior,
        saldo_atual: novoSaldo,
        saldo_formatado: formatarMinutos(novoSaldo),
        alerta_saldo: alertaSaldo,
        percentual_limite: novoSaldo > 0 ? percentualPositivo : percentualNegativo
      })
    } catch (error) {
      console.error('Erro ao adicionar movimentação:', error)
      return response.internalServerError({ error: 'Erro ao adicionar movimentação' })
    }
  }

  /**
   * Compensar horas (usar horas do banco)
   */
  async compensarHoras({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    const { funcionario_id, data, minutos, descricao } = request.only([
      'funcionario_id', 'data', 'minutos', 'descricao'
    ])

    if (!funcionario_id || !data || !minutos) {
      return response.badRequest({ error: 'Campos obrigatórios: funcionario_id, data, minutos' })
    }

    try {
      // Verifica se o período está fechado
      const dataObj = DateTime.fromISO(data)
      const [espelhoFechado] = await dbManager.queryMunicipio<{ count: number }>(
        tenant.municipioId,
        `SELECT COUNT(*) as count FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [funcionario_id, dataObj.month, dataObj.year]
      )

      if (espelhoFechado?.count > 0) {
        return response.badRequest({
          error: `O espelho de ponto de ${dataObj.monthLong}/${dataObj.year} está fechado. Não é possível compensar horas.`
        })
      }

      // Verifica saldo disponível
      const [saldoAtual] = await dbManager.queryMunicipio<{ saldo: number }>(
        tenant.municipioId,
        `SELECT COALESCE(SUM(
          CASE
            WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
            WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
            ELSE 0
          END
        ), 0) as saldo
        FROM banco_horas
        WHERE funcionario_id = $1`,
        [funcionario_id]
      )

      const saldo = saldoAtual?.saldo || 0

      if (saldo < minutos) {
        return response.badRequest({
          error: `Saldo insuficiente. Disponível: ${formatarMinutos(saldo)}, Solicitado: ${formatarMinutos(minutos)}`
        })
      }

      const novoSaldo = saldo - Math.abs(minutos)

      // Registra compensação
      const [result] = await dbManager.queryMunicipio<{ id: number }>(
        tenant.municipioId,
        `INSERT INTO banco_horas
          (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao, aprovado, aprovado_por, aprovado_em)
         VALUES ($1, $2, 'COMPENSACAO', $3, $4, $5, 'MANUAL', $6, true, $7, NOW())
         RETURNING id`,
        [funcionario_id, data, Math.abs(minutos), saldo, novoSaldo, descricao || 'Compensação de horas', tenant.usuario?.funcionario_id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'COMPENSAR_BANCO_HORAS',
        tabela: 'banco_horas',
        registroId: result.id,
        dadosNovos: { funcionario_id, data, minutos, descricao },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.created({
        success: true,
        message: `Compensação de ${formatarMinutos(minutos)} registrada`,
        saldo_anterior: saldo,
        saldo_atual: novoSaldo
      })
    } catch (error) {
      console.error('Erro ao compensar horas:', error)
      return response.internalServerError({ error: 'Erro ao compensar horas' })
    }
  }

  /**
   * Obtém configurações do banco de horas
   */
  async obterConfig({ response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      const config = await dbManager.queryMunicipioOne(
        tenant.municipioId,
        `SELECT * FROM banco_horas_config WHERE id = 1`
      )

      return response.json(config || {
        periodo_compensacao: 'SEMESTRAL',
        limite_acumulo_positivo: 2400,
        limite_acumulo_negativo: 600,
        ativo: true
      })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao obter configurações' })
    }
  }

  /**
   * Atualiza configurações do banco de horas
   */
  async atualizarConfig({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && tenant.usuario?.perfil !== 'ADMIN') {
      return response.forbidden({ error: 'Sem permissão' })
    }

    const dados = request.only([
      'periodo_compensacao',
      'limite_acumulo_positivo',
      'limite_acumulo_negativo',
      'converter_he_50_para_banco',
      'converter_he_100_para_banco',
      'fator_conversao_he_50',
      'fator_conversao_he_100',
      'dias_aviso_vencimento',
      'acao_vencimento',
      'ativo'
    ])

    try {
      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE banco_horas_config SET
          periodo_compensacao = COALESCE($1, periodo_compensacao),
          limite_acumulo_positivo = COALESCE($2, limite_acumulo_positivo),
          limite_acumulo_negativo = COALESCE($3, limite_acumulo_negativo),
          converter_he_50_para_banco = COALESCE($4, converter_he_50_para_banco),
          converter_he_100_para_banco = COALESCE($5, converter_he_100_para_banco),
          fator_conversao_he_50 = COALESCE($6, fator_conversao_he_50),
          fator_conversao_he_100 = COALESCE($7, fator_conversao_he_100),
          dias_aviso_vencimento = COALESCE($8, dias_aviso_vencimento),
          acao_vencimento = COALESCE($9, acao_vencimento),
          ativo = COALESCE($10, ativo),
          updated_at = NOW()
         WHERE id = 1`,
        [
          dados.periodo_compensacao,
          dados.limite_acumulo_positivo,
          dados.limite_acumulo_negativo,
          dados.converter_he_50_para_banco,
          dados.converter_he_100_para_banco,
          dados.fator_conversao_he_50,
          dados.fator_conversao_he_100,
          dados.dias_aviso_vencimento,
          dados.acao_vencimento,
          dados.ativo
        ]
      )

      return response.json({ success: true, message: 'Configurações atualizadas' })
    } catch (error) {
      console.error('Erro ao atualizar configurações:', error)
      return response.internalServerError({ error: 'Erro ao atualizar configurações' })
    }
  }

  /**
   * Resumo geral do banco de horas
   */
  async resumo({ response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      // Total de funcionários com saldo positivo
      const [positivos] = await dbManager.queryMunicipio<{ count: number; total: number }>(
        tenant.municipioId,
        `SELECT COUNT(DISTINCT funcionario_id) as count,
                COALESCE(SUM(saldo), 0) as total
         FROM (
           SELECT funcionario_id,
                  SUM(CASE
                    WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
                    WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
                    WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
                    ELSE 0
                  END) as saldo
           FROM banco_horas
           GROUP BY funcionario_id
           HAVING SUM(CASE
                    WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
                    WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
                    WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
                    ELSE 0
                  END) > 0
         ) sub`
      )

      // Total de funcionários com saldo negativo
      const [negativos] = await dbManager.queryMunicipio<{ count: number; total: number }>(
        tenant.municipioId,
        `SELECT COUNT(DISTINCT funcionario_id) as count,
                COALESCE(SUM(saldo), 0) as total
         FROM (
           SELECT funcionario_id,
                  SUM(CASE
                    WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
                    WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
                    WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
                    ELSE 0
                  END) as saldo
           FROM banco_horas
           GROUP BY funcionario_id
           HAVING SUM(CASE
                    WHEN tipo_operacao IN ('CREDITO', 'AJUSTE') AND minutos > 0 THEN minutos
                    WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO', 'VENCIMENTO') THEN -ABS(minutos)
                    WHEN tipo_operacao = 'AJUSTE' AND minutos < 0 THEN minutos
                    ELSE 0
                  END) < 0
         ) sub`
      )

      // Movimentações do mês atual
      const [movMes] = await dbManager.queryMunicipio<{ creditos: number; debitos: number }>(
        tenant.municipioId,
        `SELECT
          COALESCE(SUM(CASE WHEN tipo_operacao = 'CREDITO' THEN minutos ELSE 0 END), 0) as creditos,
          COALESCE(SUM(CASE WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO') THEN minutos ELSE 0 END), 0) as debitos
         FROM banco_horas
         WHERE EXTRACT(MONTH FROM data) = $1 AND EXTRACT(YEAR FROM data) = $2`,
        [DateTime.now().month, DateTime.now().year]
      )

      return response.json({
        funcionarios_positivo: positivos?.count || 0,
        total_positivo: positivos?.total || 0,
        total_positivo_formatado: formatarMinutos(positivos?.total || 0),
        funcionarios_negativo: negativos?.count || 0,
        total_negativo: negativos?.total || 0,
        total_negativo_formatado: formatarMinutos(negativos?.total || 0),
        creditos_mes: movMes?.creditos || 0,
        debitos_mes: movMes?.debitos || 0
      })
    } catch (error) {
      console.error('Erro ao obter resumo:', error)
      return response.internalServerError({ error: 'Erro ao obter resumo' })
    }
  }

  /**
   * Lista movimentações e resumo (para a view existente)
   */
  async listar({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      const { funcionario_id, mes_ano, tipo, status } = request.qs()

      // Query base
      let query = `
        SELECT bh.*, f.nome as funcionario_nome, f.matricula
        FROM banco_horas bh
        JOIN funcionarios f ON f.id = bh.funcionario_id
        WHERE 1=1
      `
      const params: any[] = []
      let paramIndex = 1

      if (funcionario_id) {
        query += ` AND bh.funcionario_id = $${paramIndex++}`
        params.push(funcionario_id)
      }

      if (mes_ano) {
        const [ano, mes] = mes_ano.split('-')
        query += ` AND EXTRACT(YEAR FROM bh.data) = $${paramIndex++}`
        query += ` AND EXTRACT(MONTH FROM bh.data) = $${paramIndex++}`
        params.push(ano, mes)
      }

      if (tipo) {
        query += ` AND bh.tipo_operacao = $${paramIndex++}`
        params.push(tipo)
      }

      if (status === 'pendente') {
        query += ` AND bh.aprovado = false`
      } else if (status === 'aprovado') {
        query += ` AND bh.aprovado = true`
      }

      query += ` ORDER BY bh.data DESC, bh.id DESC`

      const movimentacoes = await dbManager.queryMunicipio(tenant.municipioId, query, params)

      // Resumo
      const [resumoResult] = await dbManager.queryMunicipio<{
        creditos: number
        debitos: number
        compensacoes: number
      }>(
        tenant.municipioId,
        `SELECT
          COALESCE(SUM(CASE WHEN tipo_operacao = 'CREDITO' THEN minutos ELSE 0 END), 0) as creditos,
          COALESCE(SUM(CASE WHEN tipo_operacao = 'DEBITO' THEN ABS(minutos) ELSE 0 END), 0) as debitos,
          COALESCE(SUM(CASE WHEN tipo_operacao = 'COMPENSACAO' THEN ABS(minutos) ELSE 0 END), 0) as compensacoes
         FROM banco_horas`
      )

      const saldo = (resumoResult?.creditos || 0) - (resumoResult?.debitos || 0) - (resumoResult?.compensacoes || 0)

      // Saldos por funcionário
      const saldos = await dbManager.queryMunicipio(
        tenant.municipioId,
        `SELECT
          f.id as funcionario_id,
          f.nome,
          f.matricula,
          l.nome as lotacao_nome,
          COALESCE(SUM(CASE WHEN bh.tipo_operacao = 'CREDITO' THEN bh.minutos ELSE 0 END), 0) as creditos,
          COALESCE(SUM(CASE WHEN bh.tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN ABS(bh.minutos) ELSE 0 END), 0) as debitos,
          COALESCE(SUM(
            CASE
              WHEN bh.tipo_operacao = 'CREDITO' THEN bh.minutos
              WHEN bh.tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(bh.minutos)
              ELSE 0
            END
          ), 0) as saldo
         FROM funcionarios f
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
         LEFT JOIN banco_horas bh ON bh.funcionario_id = f.id
         WHERE f.ativo = true
         GROUP BY f.id, f.nome, f.matricula, l.nome
         HAVING SUM(CASE WHEN bh.id IS NOT NULL THEN 1 ELSE 0 END) > 0
         ORDER BY f.nome`
      )

      return response.json({
        movimentacoes,
        saldos,
        resumo: {
          creditos: resumoResult?.creditos || 0,
          debitos: resumoResult?.debitos || 0,
          compensacoes: resumoResult?.compensacoes || 0,
          saldo
        }
      })
    } catch (error) {
      console.error('Erro ao listar banco de horas:', error)
      return response.internalServerError({ error: 'Erro ao listar banco de horas' })
    }
  }

  /**
   * Criar movimentação (formato alternativo para view existente)
   */
  async criar({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { funcionario_id, data, tipo_operacao, minutos, descricao, aprovado } = request.only([
      'funcionario_id', 'data', 'tipo_operacao', 'minutos', 'descricao', 'aprovado'
    ])

    if (!funcionario_id || !data || !tipo_operacao || minutos === undefined) {
      return response.badRequest({ error: 'Campos obrigatórios: funcionario_id, data, tipo_operacao, minutos' })
    }

    try {
      // Verifica se o período está fechado
      const dataObj = DateTime.fromISO(data)
      const [espelhoFechado] = await dbManager.queryMunicipio<{ count: number }>(
        tenant.municipioId,
        `SELECT COUNT(*) as count FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [funcionario_id, dataObj.month, dataObj.year]
      )

      if (espelhoFechado?.count > 0) {
        return response.badRequest({
          error: `O espelho de ponto de ${dataObj.monthLong}/${dataObj.year} está fechado. Não é possível criar movimentação.`
        })
      }

      // Busca configurações de limite
      const config = await dbManager.queryMunicipioOne<{
        limite_acumulo_positivo: number
        limite_acumulo_negativo: number
      }>(
        tenant.municipioId,
        `SELECT limite_acumulo_positivo, limite_acumulo_negativo FROM banco_horas_config WHERE id = 1`
      )

      const limitePositivo = config?.limite_acumulo_positivo || 2400
      const limiteNegativo = config?.limite_acumulo_negativo || 600

      // Busca saldo atual
      const [saldoAtual] = await dbManager.queryMunicipio<{ saldo: number }>(
        tenant.municipioId,
        `SELECT COALESCE(SUM(
          CASE
            WHEN tipo_operacao = 'CREDITO' THEN minutos
            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
            ELSE 0
          END
        ), 0) as saldo
        FROM banco_horas
        WHERE funcionario_id = $1`,
        [funcionario_id]
      )

      const saldoAnterior = saldoAtual?.saldo || 0
      let novoSaldo = saldoAnterior

      if (tipo_operacao === 'CREDITO') {
        novoSaldo += Math.abs(minutos)
      } else {
        novoSaldo -= Math.abs(minutos)
      }

      // Valida limites de acúmulo
      if (novoSaldo > limitePositivo) {
        return response.badRequest({
          error: `Operação excede o limite de acúmulo positivo (${formatarMinutos(limitePositivo)}). Saldo atual: ${formatarMinutos(saldoAnterior)}, Novo saldo seria: ${formatarMinutos(novoSaldo)}`
        })
      }

      if (novoSaldo < -limiteNegativo) {
        return response.badRequest({
          error: `Operação excede o limite de acúmulo negativo (${formatarMinutos(limiteNegativo)}). Saldo atual: ${formatarMinutos(saldoAnterior)}, Novo saldo seria: ${formatarMinutos(novoSaldo)}`
        })
      }

      const [result] = await dbManager.queryMunicipio<{ id: number }>(
        tenant.municipioId,
        `INSERT INTO banco_horas
          (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao, aprovado, aprovado_por, aprovado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $8, $9, $10)
         RETURNING id`,
        [
          funcionario_id,
          data,
          tipo_operacao,
          minutos,
          saldoAnterior,
          novoSaldo,
          descricao,
          aprovado === true || aprovado === 'true',
          aprovado ? tenant.usuario?.funcionario_id : null,
          aprovado ? DateTime.now().toSQL() : null
        ]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'CRIAR_BANCO_HORAS',
        tabela: 'banco_horas',
        registroId: result.id,
        dadosNovos: { funcionario_id, data, tipo_operacao, minutos },
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.created({ success: true, id: result.id })
    } catch (error) {
      console.error('Erro ao criar movimentação:', error)
      return response.internalServerError({ error: 'Erro ao criar movimentação' })
    }
  }

  /**
   * Aprovar movimentação
   */
  async aprovar({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH', 'GESTOR'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    try {
      await dbManager.queryMunicipio(
        tenant.municipioId,
        `UPDATE banco_horas
         SET aprovado = true, aprovado_por = $1, aprovado_em = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [tenant.usuario?.funcionario_id, params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'APROVAR_BANCO_HORAS',
        tabela: 'banco_horas',
        registroId: Number(params.id),
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao aprovar' })
    }
  }

  /**
   * Excluir movimentação
   */
  async excluirMovimentacao({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão' })
    }

    try {
      const movimentacao = await dbManager.queryMunicipioOne(
        tenant.municipioId,
        `SELECT * FROM banco_horas WHERE id = $1`,
        [params.id]
      )

      if (!movimentacao) {
        return response.notFound({ error: 'Movimentação não encontrada' })
      }

      // Verifica se o período está fechado
      const dataObj = DateTime.fromJSDate(movimentacao.data)
      const [espelhoFechado] = await dbManager.queryMunicipio<{ count: number }>(
        tenant.municipioId,
        `SELECT COUNT(*) as count FROM espelhos_ponto
         WHERE funcionario_id = $1 AND mes = $2 AND ano = $3 AND status = 'APROVADO'`,
        [movimentacao.funcionario_id, dataObj.month, dataObj.year]
      )

      if (espelhoFechado?.count > 0) {
        return response.badRequest({
          error: `O espelho de ponto de ${dataObj.monthLong}/${dataObj.year} está fechado. Não é possível excluir movimentação.`
        })
      }

      await dbManager.queryMunicipio(
        tenant.municipioId,
        `DELETE FROM banco_horas WHERE id = $1`,
        [params.id]
      )

      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'EXCLUIR_BANCO_HORAS',
        tabela: 'banco_horas',
        registroId: Number(params.id),
        dadosAnteriores: movimentacao,
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      return response.json({ success: true, message: 'Movimentação excluída' })
    } catch (error) {
      console.error('Erro ao excluir movimentação:', error)
      return response.internalServerError({ error: 'Erro ao excluir movimentação' })
    }
  }
}

// Helper para formatar minutos
function formatarMinutos(minutos: number): string {
  const negativo = minutos < 0
  const abs = Math.abs(minutos)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${negativo ? '-' : ''}${h}h${m.toString().padStart(2, '0')}`
}
