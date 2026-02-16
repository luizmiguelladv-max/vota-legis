import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware que requer município selecionado
 */
export default class RequireMunicipioMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { response } = ctx

    // Super admin pode acessar sem município em algumas rotas
    if (ctx.tenant?.isSuperAdmin && !ctx.tenant.municipioId) {
      // Permite acesso a rotas admin sem município selecionado
      const path = ctx.request.url()
      if (path.startsWith('/admin') || path.startsWith('/api/admin')) {
        return next()
      }
    }

    // Verifica se há município selecionado
    if (!ctx.tenant?.municipioId || !ctx.tenant.municipio) {
      // Para APIs retorna JSON
      if (ctx.request.url().startsWith('/api')) {
        return response.unauthorized({ error: 'Nenhum município selecionado' })
      }

      // Para páginas redireciona para seleção
      return response.redirect('/selecionar-municipio')
    }

    await next()
  }
}
