import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as sessionErrors } from '@adonisjs/session'

/**
 * Interface para erro padronizado
 */
interface ErrorResponse {
  success: false
  error: string
  code?: string
  details?: string
  stack?: string
}

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (_error, { view }) => {
      return view.render('pages/404')
    },
    '500..599': (_error, { view }) => {
      return view.render('pages/500')
    },
  }

  /**
   * Códigos de erro conhecidos e suas mensagens amigáveis
   */
  private errorMessages: Record<string, string> = {
    E_UNAUTHORIZED_ACCESS: 'Acesso não autorizado. Faça login para continuar.',
    E_INVALID_CREDENTIALS: 'Credenciais inválidas.',
    E_SESSION_EXPIRED: 'Sua sessão expirou. Faça login novamente.',
    E_ROW_NOT_FOUND: 'Registro não encontrado.',
    E_VALIDATION_ERROR: 'Erro de validação nos dados enviados.',
    E_ROUTE_NOT_FOUND: 'Página não encontrada.',
    E_UNAUTHORIZED: 'Você não tem permissão para acessar este recurso.',
    E_FORBIDDEN: 'Acesso negado.',
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const { request, response } = ctx

    // Verifica se é uma requisição de API (JSON)
    const isApiRequest =
      request.url().startsWith('/api/') ||
      request.accepts(['html', 'json']) === 'json' ||
      request.header('accept')?.includes('application/json')

    // Se for API, retorna JSON padronizado
    if (isApiRequest) {
      return this.handleApiError(error, ctx)
    }

    // Para requisições normais, usa o handler padrão
    return super.handle(error, ctx)
  }

  /**
   * Trata erros de API retornando JSON padronizado
   */
  private handleApiError(error: unknown, ctx: HttpContext) {
    const { response } = ctx

    // Extrai informações do erro
    const errorObj = error as any
    const status = errorObj.status || errorObj.statusCode || 500
    const code = errorObj.code || 'E_UNKNOWN_ERROR'
    const message = this.getErrorMessage(error)

    // Monta resposta padronizada
    const errorResponse: ErrorResponse = {
      success: false,
      error: message,
      code,
    }

    // Em modo debug, adiciona detalhes
    if (this.debug) {
      errorResponse.details = errorObj.message
      if (errorObj.stack) {
        errorResponse.stack = errorObj.stack
      }
    }

    // Log do erro (apenas em produção ou para erros 500)
    if (status >= 500) {
      console.error(`[ERROR ${status}] ${code}: ${message}`, error)
    }

    return response.status(status).json(errorResponse)
  }

  /**
   * Obtém mensagem de erro amigável
   */
  private getErrorMessage(error: unknown): string {
    const errorObj = error as any
    const code = errorObj.code

    // Verifica se tem mensagem mapeada
    if (code && this.errorMessages[code]) {
      return this.errorMessages[code]
    }

    // Erros de autenticação (verificação segura)
    try {
      if (authErrors.E_UNAUTHORIZED_ACCESS && error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
        return 'Acesso não autorizado. Faça login para continuar.'
      }

      if (authErrors.E_INVALID_CREDENTIALS && error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return 'Credenciais inválidas.'
      }
    } catch {
      // Ignora erros de instanceof
    }

    // Erros de sessão (verificação segura)
    try {
      if (sessionErrors.E_UNABLE_TO_FIND_SESSION && error instanceof sessionErrors.E_UNABLE_TO_FIND_SESSION) {
        return 'Sessão não encontrada. Faça login novamente.'
      }
    } catch {
      // Ignora erros de instanceof
    }

    // Erros de validação
    if (errorObj.messages) {
      const messages = errorObj.messages
      if (Array.isArray(messages) && messages.length > 0) {
        return messages[0].message || 'Erro de validação'
      }
    }

    // Erros de banco de dados
    if (errorObj.code === '23505') {
      return 'Registro duplicado. Este item já existe.'
    }

    if (errorObj.code === '23503') {
      return 'Não é possível excluir este registro pois está sendo usado.'
    }

    if (errorObj.code === '42P01') {
      return 'Erro de estrutura do banco de dados.'
    }

    // Mensagem do erro ou genérica
    if (errorObj.message && !app.inProduction) {
      return errorObj.message
    }

    return 'Ocorreu um erro ao processar sua solicitação.'
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    const errorObj = error as any
    const status = errorObj.status || errorObj.statusCode || 500

    // Apenas reporta erros 500+ ou em modo debug
    if (status >= 500 || this.debug) {
      // Log estruturado
      const logData = {
        timestamp: new Date().toISOString(),
        url: ctx.request.url(),
        method: ctx.request.method(),
        ip: ctx.request.ip(),
        userAgent: ctx.request.header('user-agent'),
        error: {
          name: errorObj.name,
          message: errorObj.message,
          code: errorObj.code,
          status,
        },
      }

      // Adiciona informações do usuário se disponível
      if (ctx.auth?.user) {
        ;(logData as any).userId = ctx.auth.user.id
      }

      console.error('[EXCEPTION]', JSON.stringify(logData, null, 2))

      // Em desenvolvimento, mostra stack trace
      if (this.debug && errorObj.stack) {
        console.error(errorObj.stack)
      }
    }

    return super.report(error, ctx)
  }
}
