import type { HttpContext } from '@adonisjs/core/http'
import AuditLog from '#models/audit_log'
import { DateTime } from 'luxon'

export default class AuditoriaController {
  /**
   * Lista logs de auditoria com filtros
   */
  async listar({ request, response }: HttpContext) {
    try {
      const page = Number(request.input('page', 1))
      const limit = Number(request.input('limit', 50))
      const acao = request.input('acao')
      const tabela = request.input('tabela')
      const usuarioTipo = request.input('usuario_tipo')
      const dataInicio = request.input('data_inicio')
      const dataFim = request.input('data_fim')

      let query = AuditLog.query().orderBy('created_at', 'desc')

      if (acao) {
        query = query.where('acao', acao)
      }

      if (tabela) {
        query = query.where('tabela', tabela)
      }

      if (usuarioTipo) {
        query = query.where('usuario_tipo', usuarioTipo)
      }

      if (dataInicio) {
        query = query.where('created_at', '>=', DateTime.fromISO(dataInicio).startOf('day').toSQL())
      }

      if (dataFim) {
        query = query.where('created_at', '<=', DateTime.fromISO(dataFim).endOf('day').toSQL())
      }

      const logs = await query.paginate(page, limit)

      return response.json({
        data: logs.all().map((l) => ({
          id: l.id,
          usuarioId: l.usuarioId,
          usuarioTipo: l.usuarioTipo,
          acao: l.acao,
          tabela: l.tabela,
          registroId: l.registroId,
          dadosAnteriores: l.dadosAnteriores,
          dadosNovos: l.dadosNovos,
          ip: l.ip,
          userAgent: l.userAgent,
          createdAt: l.createdAt,
        })),
        meta: {
          total: logs.total,
          perPage: logs.perPage,
          currentPage: logs.currentPage,
          lastPage: logs.lastPage,
        },
      })
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao listar logs:', error)
      return response.internalServerError({
        error: 'Erro ao listar logs de auditoria',
        details: error.message,
      })
    }
  }

  /**
   * Obtém detalhes de um log específico
   */
  async obter({ params, response }: HttpContext) {
    try {
      const log = await AuditLog.find(params.id)

      if (!log) {
        return response.notFound({ error: 'Log não encontrado' })
      }

      return response.json(log)
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao obter log:', error)
      return response.internalServerError({
        error: 'Erro ao obter log',
        details: error.message,
      })
    }
  }

  /**
   * Obtém estatísticas de auditoria
   */
  async estatisticas({ response }: HttpContext) {
    try {
      // Total de logs
      const total = await AuditLog.query().count('* as total').first()

      // Logs por ação
      const porAcao = await AuditLog.query()
        .select('acao')
        .count('* as total')
        .groupBy('acao')
        .orderBy('total', 'desc')

      // Logs por tipo de usuário
      const porTipoUsuario = await AuditLog.query()
        .select('usuario_tipo')
        .count('* as total')
        .groupBy('usuario_tipo')

      // Logs das últimas 24 horas
      const ultimas24h = await AuditLog.query()
        .whereRaw("created_at >= NOW() - INTERVAL '24 hours'")
        .count('* as total')
        .first()

      // Logs do último mês por dia
      const ultimoMes = await AuditLog.query()
        .select(AuditLog.raw("DATE(created_at) as data"))
        .count('* as total')
        .whereRaw("created_at >= NOW() - INTERVAL '30 days'")
        .groupByRaw('DATE(created_at)')
        .orderBy('data', 'asc')

      return response.json({
        total: Number(total?.$extras.total) || 0,
        ultimas24h: Number(ultimas24h?.$extras.total) || 0,
        porAcao: porAcao.map((r) => ({
          acao: r.acao,
          total: Number(r.$extras.total),
        })),
        porTipoUsuario: porTipoUsuario.map((r) => ({
          tipo: r.$extras.usuario_tipo || 'Desconhecido',
          total: Number(r.$extras.total),
        })),
        ultimoMes: ultimoMes.map((r) => ({
          data: r.$extras.data,
          total: Number(r.$extras.total),
        })),
      })
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao obter estatísticas:', error)
      return response.internalServerError({
        error: 'Erro ao obter estatísticas',
        details: error.message,
      })
    }
  }

  /**
   * Lista ações disponíveis para filtro
   */
  async acoes({ response }: HttpContext) {
    try {
      const acoes = await AuditLog.query()
        .select('acao')
        .distinct('acao')
        .orderBy('acao', 'asc')

      return response.json({
        acoes: acoes.map((r) => r.acao),
      })
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao listar ações:', error)
      return response.internalServerError({
        error: 'Erro ao listar ações',
        details: error.message,
      })
    }
  }

  /**
   * Lista tabelas disponíveis para filtro
   */
  async tabelas({ response }: HttpContext) {
    try {
      const tabelas = await AuditLog.query()
        .select('tabela')
        .distinct('tabela')
        .whereNotNull('tabela')
        .orderBy('tabela', 'asc')

      return response.json({
        tabelas: tabelas.map((r) => r.tabela).filter(Boolean),
      })
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao listar tabelas:', error)
      return response.internalServerError({
        error: 'Erro ao listar tabelas',
        details: error.message,
      })
    }
  }

  /**
   * Exporta logs de auditoria
   */
  async exportar({ request, response }: HttpContext) {
    try {
      const dataInicio = request.input('data_inicio')
      const dataFim = request.input('data_fim')

      let query = AuditLog.query().orderBy('created_at', 'desc')

      if (dataInicio) {
        query = query.where('created_at', '>=', DateTime.fromISO(dataInicio).startOf('day').toSQL())
      }

      if (dataFim) {
        query = query.where('created_at', '<=', DateTime.fromISO(dataFim).endOf('day').toSQL())
      }

      const logs = await query.limit(10000) // Limite de segurança

      const dados = logs.map((l) => ({
        id: l.id,
        data_hora: l.createdAt?.toISO(),
        usuario_id: l.usuarioId,
        usuario_tipo: l.usuarioTipo,
        acao: l.acao,
        tabela: l.tabela,
        registro_id: l.registroId,
        ip: l.ip,
        dados_anteriores: JSON.stringify(l.dadosAnteriores),
        dados_novos: JSON.stringify(l.dadosNovos),
      }))

      response.header('Content-Type', 'application/json')
      response.header(
        'Content-Disposition',
        `attachment; filename="auditoria_${DateTime.now().toFormat('yyyyMMdd_HHmmss')}.json"`
      )

      return response.send(JSON.stringify(dados, null, 2))
    } catch (error: any) {
      console.error('[AuditoriaController] Erro ao exportar logs:', error)
      return response.internalServerError({
        error: 'Erro ao exportar logs',
        details: error.message,
      })
    }
  }
}
