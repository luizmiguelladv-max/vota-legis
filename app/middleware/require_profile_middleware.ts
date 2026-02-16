import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware que requer perfil específico
 */
export default class RequireProfileMiddleware {
  async handle(ctx: HttpContext, next: NextFn, allowedProfiles: string[]) {
    const { response } = ctx
    const userProfile = ctx.tenant?.usuario?.perfil

    // Super admin sempre tem acesso
    if (ctx.tenant?.isSuperAdmin) {
      return next()
    }

    if (!userProfile || !allowedProfiles.includes(userProfile)) {
      if (ctx.request.url().startsWith('/api')) {
        return response.forbidden({ error: 'Acesso negado. Perfil não autorizado.' })
      }
      return response.redirect('/dashboard')
    }

    await next()
  }
}
