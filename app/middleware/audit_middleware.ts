import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import db from '@adonisjs/lucid/services/db'

/**
 * Middleware de Auditoria
 * Registra todas as requisições HTTP no sistema
 */
export default class AuditMiddleware {
  // Rotas que não devem ser logadas (muito frequentes ou não importantes)
  private static ignoredRoutes = [
    '/api/health',
    '/api/status',
    '/assets/',
    '/favicon.ico',
    '/_vite/',
    '/sw.js',
    '/manifest.json',
  ]

  // Rotas que devem ter log detalhado (dados da requisição)
  private static detailedRoutes = [
    '/api/funcionarios',
    '/api/jornadas',
    '/api/lotacoes',
    '/api/cargos',
    '/api/usuarios',
    '/api/entidades',
    '/api/ponto',
    '/api/espelho',
    '/api/banco-horas',
    '/api/afastamentos',
    '/api/admin',
    '/login',
    '/logout',
  ]

  async handle(ctx: HttpContext, next: NextFn) {
    const startTime = Date.now()
    const { request, response, tenant, auth } = ctx

    const url = request.url()
    const method = request.method()

    // Ignora rotas não importantes
    if (AuditMiddleware.ignoredRoutes.some((r) => url.startsWith(r))) {
      return next()
    }

    // Ignora requisições OPTIONS (CORS preflight)
    if (method === 'OPTIONS') {
      return next()
    }

    // Determina a ação baseada no método e rota
    const acao = this.determinarAcao(method, url)
    const recurso = this.extrairRecurso(url)

    // Captura dados da requisição para rotas detalhadas
    let dadosRequest: any = null
    let queryParams: any = null

    const isDetailed = AuditMiddleware.detailedRoutes.some((r) => url.includes(r))
    if (isDetailed && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try {
        dadosRequest = request.body()
        // Remove campos sensíveis
        dadosRequest = this.sanitizarDados(dadosRequest)
      } catch {
        dadosRequest = null
      }
    }

    if (isDetailed) {
      queryParams = request.qs()
    }

    // Executa a requisição
    let error: Error | null = null
    try {
      await next()
    } catch (err) {
      error = err as Error
      throw err
    } finally {
      const duracao = Date.now() - startTime
      const statusCode = response.getStatus()
      const sucesso = statusCode < 400

      // Log assíncrono (não bloqueia a resposta)
      this.registrarLog({
        // Usuário
        usuario_id: auth?.user?.id || tenant?.usuario?.id || null,
        usuario_nome: auth?.user?.nome || tenant?.usuario?.nome || null,
        usuario_email: auth?.user?.email || tenant?.usuario?.email || null,
        usuario_perfil: tenant?.usuario?.perfil || null,

        // Tenant
        entidade_id: tenant?.entidadeId || null,
        entidade_nome: tenant?.entidade?.nome || null,
        municipio_id: tenant?.municipioId || null,
        municipio_nome: tenant?.municipio?.nome || null,

        // Requisição
        metodo: method,
        rota: this.extrairRota(url),
        url_completa: url,
        ip_address: request.ip(),
        user_agent: request.header('user-agent') || null,
        referer: request.header('referer') || null,

        // Ação
        acao,
        recurso,
        recurso_id: this.extrairRecursoId(url),

        // Dados
        dados_request: dadosRequest,
        query_params: queryParams,

        // Resultado
        status_code: statusCode,
        sucesso,
        mensagem_erro: error?.message || null,
        stack_trace: error?.stack || null,

        // Tempo
        duracao_ms: duracao,
      }).catch((err) => {
        console.error('[Audit] Erro ao registrar log:', err)
      })
    }
  }

  private determinarAcao(method: string, url: string): string {
    if (url.includes('/login')) return 'LOGIN'
    if (url.includes('/logout')) return 'LOGOUT'
    if (url.includes('/export') || url.includes('/download')) return 'EXPORT'
    if (url.includes('/import') || url.includes('/upload')) return 'IMPORT'
    if (url.includes('/sync')) return 'SYNC'

    switch (method) {
      case 'GET':
        return 'VIEW'
      case 'POST':
        return 'CREATE'
      case 'PUT':
      case 'PATCH':
        return 'UPDATE'
      case 'DELETE':
        return 'DELETE'
      default:
        return 'OTHER'
    }
  }

  private extrairRecurso(url: string): string | null {
    // /api/funcionarios/123 -> funcionarios
    const match = url.match(/\/api\/([a-z-]+)/i)
    return match ? match[1] : null
  }

  private extrairRecursoId(url: string): string | null {
    // /api/funcionarios/123 -> 123
    const match = url.match(/\/api\/[a-z-]+\/(\d+)/i)
    return match ? match[1] : null
  }

  private extrairRota(url: string): string {
    // Remove query string e IDs para normalizar
    return url.split('?')[0].replace(/\/\d+/g, '/:id')
  }

  private sanitizarDados(dados: any): any {
    if (!dados || typeof dados !== 'object') return dados

    const camposSensiveis = [
      'senha',
      'password',
      'secret',
      'token',
      'api_key',
      'template',
      'foto_base64',
      'descriptor',
      'biometrico',
    ]

    const resultado: any = Array.isArray(dados) ? [] : {}

    for (const [chave, valor] of Object.entries(dados)) {
      if (camposSensiveis.some((c) => chave.toLowerCase().includes(c))) {
        resultado[chave] = '[REDACTED]'
      } else if (valor && typeof valor === 'object') {
        resultado[chave] = this.sanitizarDados(valor)
      } else {
        resultado[chave] = valor
      }
    }

    return resultado
  }

  private async registrarLog(data: any) {
    try {
      await db.table('public.audit_logs').insert(data)
    } catch (err) {
      console.error('[Audit] Falha ao inserir log:', err)
    }
  }
}
