import type { HttpContext } from '@adonisjs/core/http'
import Changelog from '#models/changelog'
import AuditService from '#services/audit_service'

export default class ChangelogController {
  /**
   * Lista todos os changelogs
   */
  async listar({ request, response }: HttpContext) {
    try {
      const page = Number(request.input('page', 1))
      const limit = Number(request.input('limit', 20))

      const changelogs = await Changelog.query()
        .where('ativo', true)
        .orderBy('data_lancamento', 'desc')
        .paginate(page, limit)

      return response.json({
        data: changelogs.all().map((c) => ({
          id: c.id,
          versao: c.versao,
          titulo: c.titulo,
          descricao: c.descricao,
          tipo: c.tipo,
          dataLancamento: c.dataLancamento,
          criadoPor: c.criadoPor,
          createdAt: c.createdAt,
        })),
        meta: {
          total: changelogs.total,
          perPage: changelogs.perPage,
          currentPage: changelogs.currentPage,
          lastPage: changelogs.lastPage,
        },
      })
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao listar changelogs:', error)
      return response.internalServerError({
        error: 'Erro ao listar changelogs',
        details: error.message,
      })
    }
  }

  /**
   * Obtém um changelog específico
   */
  async obter({ params, response }: HttpContext) {
    try {
      const changelog = await Changelog.find(params.id)

      if (!changelog) {
        return response.notFound({ error: 'Changelog não encontrado' })
      }

      return response.json(changelog)
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao obter changelog:', error)
      return response.internalServerError({
        error: 'Erro ao obter changelog',
        details: error.message,
      })
    }
  }

  /**
   * Cria um novo changelog
   */
  async criar({ request, response, tenant, auth }: HttpContext) {
    const dados = request.only(['versao', 'titulo', 'descricao', 'tipo', 'dataLancamento'])

    try {
      // Valida campos obrigatórios
      if (!dados.versao || !dados.titulo || !dados.descricao) {
        return response.badRequest({ error: 'Versão, título e descrição são obrigatórios' })
      }

      const changelog = await Changelog.create({
        versao: dados.versao,
        titulo: dados.titulo,
        descricao: dados.descricao,
        tipo: dados.tipo || 'feature',
        dataLancamento: dados.dataLancamento || new Date(),
        criadoPor: auth.user?.nome || 'Sistema',
        ativo: true,
      })

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'CREATE',
          tabela: 'changelogs',
          registroId: changelog.id,
          dadosNovos: { versao: changelog.versao, titulo: changelog.titulo },
        }
      )

      return response.created({
        success: true,
        message: 'Changelog criado com sucesso',
        changelog,
      })
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao criar changelog:', error)
      return response.internalServerError({
        error: 'Erro ao criar changelog',
        details: error.message,
      })
    }
  }

  /**
   * Atualiza um changelog
   */
  async atualizar({ params, request, response, tenant }: HttpContext) {
    const dados = request.only(['versao', 'titulo', 'descricao', 'tipo', 'dataLancamento', 'ativo'])

    try {
      const changelog = await Changelog.find(params.id)

      if (!changelog) {
        return response.notFound({ error: 'Changelog não encontrado' })
      }

      const dadosAnteriores = {
        versao: changelog.versao,
        titulo: changelog.titulo,
        tipo: changelog.tipo,
      }

      changelog.merge(dados)
      await changelog.save()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'UPDATE',
          tabela: 'changelogs',
          registroId: changelog.id,
          dadosAnteriores,
          dadosNovos: { versao: changelog.versao, titulo: changelog.titulo, tipo: changelog.tipo },
        }
      )

      return response.json({
        success: true,
        message: 'Changelog atualizado com sucesso',
        changelog,
      })
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao atualizar changelog:', error)
      return response.internalServerError({
        error: 'Erro ao atualizar changelog',
        details: error.message,
      })
    }
  }

  /**
   * Exclui um changelog (soft delete)
   */
  async excluir({ params, request, response, tenant }: HttpContext) {
    try {
      const changelog = await Changelog.find(params.id)

      if (!changelog) {
        return response.notFound({ error: 'Changelog não encontrado' })
      }

      changelog.ativo = false
      await changelog.save()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'DELETE',
          tabela: 'changelogs',
          registroId: params.id,
          dadosAnteriores: { versao: changelog.versao, titulo: changelog.titulo },
        }
      )

      return response.json({
        success: true,
        message: 'Changelog excluído com sucesso',
      })
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao excluir changelog:', error)
      return response.internalServerError({
        error: 'Erro ao excluir changelog',
        details: error.message,
      })
    }
  }

  /**
   * Lista versões públicas (para exibição aos usuários)
   */
  async versoes({ response }: HttpContext) {
    try {
      const changelogs = await Changelog.query()
        .where('ativo', true)
        .orderBy('data_lancamento', 'desc')
        .limit(10)

      return response.json({
        versoes: changelogs.map((c) => ({
          versao: c.versao,
          titulo: c.titulo,
          descricao: c.descricao,
          tipo: c.tipo,
          dataLancamento: c.dataLancamento,
        })),
      })
    } catch (error: any) {
      console.error('[ChangelogController] Erro ao listar versões:', error)
      return response.internalServerError({
        error: 'Erro ao listar versões',
        details: error.message,
      })
    }
  }
}
