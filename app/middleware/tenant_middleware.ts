import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import Municipio from '#models/municipio'

/**
 * Dados do tenant disponíveis em ctx.tenant
 */
export interface TenantData {
  municipioId: number | null
  municipio: Municipio | null
  schemaName: string | null
  usuario: {
    id: number
    nome: string
    login: string
    email: string
    perfilId: number
    perfilCodigo: string
  } | null
  isSuperAdmin: boolean
}

/**
 * Middleware que carrega os dados do tenant (município/câmara)
 * e disponibiliza em ctx.tenant
 */
export default class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { auth, session } = ctx

    // Inicializa tenant vazio
    ctx.tenant = {
      municipioId: null,
      municipio: null,
      schemaName: null,
      usuario: null,
      isSuperAdmin: false,
    }

    try {
      // Verifica se está autenticado
      await auth.check()

      if (auth.user) {
        const user = auth.user

        // Carrega o perfil do usuário
        await user.load('perfil')

        // Preenche dados do usuário
        ctx.tenant.usuario = {
          id: user.id,
          nome: user.nome,
          login: user.login,
          email: user.email,
          perfilId: user.perfilId,
          perfilCodigo: user.perfil?.codigo || 'usuario',
        }

        ctx.tenant.isSuperAdmin = user.isSuperAdmin

        // Obtém o município da sessão ou do usuário
        let municipioId = session.get('municipioId') as number | null

        // Se não tiver na sessão, usa o do usuário
        if (!municipioId && user.municipioId) {
          municipioId = user.municipioId
          session.put('municipioId', municipioId)
        }

        // Se tiver município, carrega os dados
        if (municipioId) {
          const municipio = await Municipio.find(municipioId)

          if (municipio && municipio.isAtivo) {
            ctx.tenant.municipioId = municipio.id
            ctx.tenant.municipio = municipio
            ctx.tenant.schemaName = municipio.schemaName
          }
        }
      }
    } catch {
      // Usuário não autenticado, mantém tenant vazio
    }

    // Disponibiliza tenant nas views
    ctx.view.share({
      tenant: ctx.tenant,
    })

    return next()
  }
}

/**
 * Extende o HttpContext para incluir tenant
 */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    tenant: TenantData
  }
}
