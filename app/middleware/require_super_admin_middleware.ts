import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware que exige que o usuário seja Super Admin
 */
export default class RequireSuperAdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { tenant, response, request } = ctx

    if (!tenant.isSuperAdmin) {
      if (request.url().startsWith('/api/')) {
        return response.forbidden({
          success: false,
          error: 'Acesso negado',
          message: 'Voce nao tem permissao para acessar este recurso',
        })
      }

      return response.redirect().toRoute('dashboard')
    }

    return next()
  }
}
