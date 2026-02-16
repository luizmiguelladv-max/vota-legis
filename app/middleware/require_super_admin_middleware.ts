import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware que requer super admin
 */
export default class RequireSuperAdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { response } = ctx

    if (!ctx.tenant?.isSuperAdmin) {
      if (ctx.request.url().startsWith('/api')) {
        return response.forbidden({ error: 'Acesso negado. Requer privilégios de administrador.' })
      }
      return response.redirect('/dashboard')
    }

    await next()
  }
}
