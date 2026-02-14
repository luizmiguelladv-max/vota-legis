import type { HttpContext } from '@adonisjs/core/http'
import { dbManager } from '#services/database_manager_service'
import { DateTime } from 'luxon'

export default class DashboardController {
  /**
   * Exibe a página do dashboard
   */
  async index({ view, tenant, response }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.redirect('/selecionar-municipio')
    }
    return view.render('pages/dashboard')
  }

  /**
   * Retorna estatísticas do dashboard (API)
   */
  async stats({ response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const municipioId = tenant.municipioId
    const hoje = DateTime.now().toFormat('yyyy-MM-dd')
    const inicioMes = DateTime.now().startOf('month').toFormat('yyyy-MM-dd')
    const fimMes = DateTime.now().endOf('month').toFormat('yyyy-MM-dd')

    try {
      // Total de funcionários ativos
      const [totalFuncionarios] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM funcionarios WHERE ativo = true`
      )

      // Registros de hoje
      const [registrosHoje] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM registros_ponto
         WHERE DATE(data_hora) = $1`,
        [hoje]
      )

      // Pendências (espelhos abertos do mês)
      const [pendencias] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM espelhos_ponto
         WHERE status = 'ABERTO'
         AND mes = $1 AND ano = $2`,
        [DateTime.now().month, DateTime.now().year]
      )

      // Equipamentos online
      const [equipamentosOnline] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM equipamentos
         WHERE ativo = true AND status = 'ONLINE'`
      )

      // Total de equipamentos
      const [totalEquipamentos] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM equipamentos WHERE ativo = true`
      )

      // Presentes hoje (funcionários com ao menos um registro)
      const [presentesHoje] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(DISTINCT funcionario_id) as count FROM registros_ponto
         WHERE DATE(data_hora) = $1`,
        [hoje]
      )

      // Últimos registros
      const ultimosRegistros = await dbManager.queryMunicipio(
        municipioId,
        `SELECT rp.id, rp.data_hora, rp.tipo, rp.origem,
                f.nome as funcionario_nome, f.matricula
         FROM registros_ponto rp
         JOIN funcionarios f ON f.id = rp.funcionario_id
         ORDER BY rp.data_hora DESC
         LIMIT 10`
      )

      // Ocorrências pendentes de aprovação
      const [ocorrenciasPendentes] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM ocorrencias WHERE aprovado = false`
      )

      // Gera alertas do sistema
      const alertas: any[] = []

      // Alerta de espelhos pendentes
      if (Number(pendencias?.count) > 0) {
        alertas.push({
          tipo: 'warning',
          icone: 'exclamation-triangle',
          titulo: 'Espelhos Pendentes',
          mensagem: `${pendencias?.count} espelho(s) aguardando aprovacao`,
          link: '/espelho-aprovacoes'
        })
      }

      // Alerta de funcionarios com saldo negativo critico
      const [saldoCritico] = await dbManager.queryMunicipio<{ count: number }>(
        municipioId,
        `SELECT COUNT(*) as count FROM (
          SELECT funcionario_id
          FROM banco_horas
          GROUP BY funcionario_id
          HAVING SUM(
            CASE WHEN tipo_operacao = 'CREDITO' THEN minutos
                 WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
                 ELSE minutos END
          ) < -300
        ) sub`
      )

      if (Number(saldoCritico?.count) > 0) {
        alertas.push({
          tipo: 'danger',
          icone: 'wallet2',
          titulo: 'Saldo Critico',
          mensagem: `${saldoCritico?.count} funcionario(s) com saldo negativo superior a 5 horas`,
          link: '/banco-horas'
        })
      }

      // Alerta de equipamentos offline
      const equipOffline = Number(totalEquipamentos?.count) - Number(equipamentosOnline?.count)
      if (equipOffline > 0) {
        alertas.push({
          tipo: 'info',
          icone: 'router',
          titulo: 'Equipamentos Offline',
          mensagem: `${equipOffline} equipamento(s) nao estao comunicando`,
          link: '/equipamentos'
        })
      }

      return response.json({
        totalFuncionarios: Number(totalFuncionarios?.count || 0),
        registrosHoje: Number(registrosHoje?.count || 0),
        pendencias: Number(pendencias?.count || 0),
        equipamentosOnline: Number(equipamentosOnline?.count || 0),
        totalEquipamentos: Number(totalEquipamentos?.count || 0),
        presentesHoje: Number(presentesHoje?.count || 0),
        ocorrenciasPendentes: Number(ocorrenciasPendentes?.count || 0),
        ultimosRegistros,
        alertas,
      })
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error)
      return response.internalServerError({ error: 'Erro ao carregar estatísticas' })
    }
  }

  /**
   * Retorna dados do gráfico de presença
   */
  async chartPresenca({ response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const municipioId = tenant.municipioId
    const hoje = DateTime.now()

    try {
      // Dados dos últimos 7 dias
      const dados = []

      for (let i = 6; i >= 0; i--) {
        const data = hoje.minus({ days: i }).toFormat('yyyy-MM-dd')
        const diaSemana = hoje.minus({ days: i }).toFormat('ccc')

        const [result] = await dbManager.queryMunicipio<{
          presentes: number
          registros: number
        }>(
          municipioId,
          `SELECT
             COUNT(DISTINCT funcionario_id) as presentes,
             COUNT(*) as registros
           FROM registros_ponto
           WHERE DATE(data_hora) = $1`,
          [data]
        )

        dados.push({
          data,
          diaSemana,
          presentes: Number(result?.presentes || 0),
          registros: Number(result?.registros || 0),
        })
      }

      return response.json(dados)
    } catch (error) {
      console.error('Erro ao carregar gráfico:', error)
      return response.internalServerError({ error: 'Erro ao carregar dados do gráfico' })
    }
  }
}
