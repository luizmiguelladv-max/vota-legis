import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware de Manutenção
 * 
 * Quando o município está em modo_manutencao = true:
 * - Super admins e ADMIN podem acessar normalmente
 * - Outros usuários são redirecionados para página de manutenção
 */
export default class MaintenanceMiddleware {
    async handle(ctx: HttpContext, next: NextFn) {
        const { tenant, response, request } = ctx

        // Se não tem tenant ou não está em manutenção, prossegue normalmente
        if (!tenant?.municipio?.modoManutencao) {
            return next()
        }

        // Super admin sempre pode acessar
        if (tenant.isSuperAdmin) {
            return next()
        }

        // Admin do município pode acessar
        if (tenant.usuario?.perfil === 'ADMIN') {
            return next()
        }

        // URLs que sempre devem ser acessíveis (logout, assets, etc.)
        const allowedPaths = [
            '/logout',
            '/api/auth/logout',
            '/manutencao',
            '/public',
            '/assets',
        ]

        const currentPath = request.url()
        if (allowedPaths.some(p => currentPath.startsWith(p))) {
            return next()
        }

        // Redireciona para página de manutenção
        return response.redirect().toPath('/manutencao')
    }
}
