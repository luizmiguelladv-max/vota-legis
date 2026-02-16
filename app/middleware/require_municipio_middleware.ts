import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware que exige que um município esteja selecionado
 */
export default class RequireMunicipioMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { tenant, response, request } = ctx

    // Se não tem município selecionado
    if (!tenant.municipioId) {
      // Se for requisição de API, retorna erro JSON
      if (request.url().startsWith('/api/')) {
        return response.unauthorized({
          success: false,
          error: 'Municipio nao selecionado',
          message: 'Selecione um municipio para continuar',
        })
      }

      // Se for requisição web, redireciona
      return response.redirect().toRoute('selecionar-municipio')
    }

    // Verifica se o banco do município foi criado
    if (!tenant.municipio?.bancoCriado) {
      if (request.url().startsWith('/api/')) {
        return response.serviceUnavailable({
          success: false,
          error: 'Banco de dados nao configurado',
          message: 'O banco de dados deste municipio ainda nao foi configurado',
        })
      }

      return response.redirect().toRoute('municipio-pendente')
    }

    return next()
  }
}
