import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import logger from '@adonisjs/core/services/logger'

/**
 * Rate Limiting Middleware
 *
 * Protege contra ataques de força bruta limitando tentativas por IP.
 * Configurado especificamente para rotas de autenticação.
 */

interface RateLimitEntry {
  count: number
  firstAttempt: number
  blockedUntil?: number
}

// Cache em memória para rate limiting (produção deveria usar Redis)
const rateLimitCache = new Map<string, RateLimitEntry>()

// Configurações
const MAX_ATTEMPTS = 30             // Máximo de tentativas por janela
const WINDOW_MS = 5 * 60 * 1000     // Janela de 5 minutos
const BLOCK_DURATION_MS = 2 * 60 * 1000   // Bloqueio de 2 minutos após exceder limite

export default class RateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const ip = ctx.request.ip()
    const path = ctx.request.url()
    const key = `${ip}:${path}`
    const now = Date.now()

    let entry = rateLimitCache.get(key)

    // Limpar entradas antigas periodicamente
    if (rateLimitCache.size > 10000) {
      this.cleanup()
    }

    // Verificar se está bloqueado
    if (entry?.blockedUntil && now < entry.blockedUntil) {
      const remainingSeconds = Math.ceil((entry.blockedUntil - now) / 1000)
      logger.warn(`[RateLimit] IP ${ip} bloqueado por ${remainingSeconds}s - tentativa em ${path}`)

      return ctx.response.status(429).json({
        success: false,
        error: 'Muitas tentativas. Tente novamente em alguns minutos.',
        retryAfter: remainingSeconds
      })
    }

    // Resetar se a janela expirou
    if (!entry || (now - entry.firstAttempt) > WINDOW_MS) {
      entry = { count: 1, firstAttempt: now }
    } else {
      entry.count++
    }

    // Verificar se excedeu o limite
    if (entry.count > MAX_ATTEMPTS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS
      rateLimitCache.set(key, entry)

      logger.warn(`[RateLimit] IP ${ip} bloqueado após ${entry.count} tentativas em ${path}`)

      return ctx.response.status(429).json({
        success: false,
        error: 'Muitas tentativas. Tente novamente em alguns minutos.',
        retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000)
      })
    }

    rateLimitCache.set(key, entry)

    // Log de tentativas (apenas em debug para não poluir produção)
    if (entry.count >= 3) {
      logger.debug(`[RateLimit] IP ${ip}: ${entry.count}/${MAX_ATTEMPTS} tentativas em ${path}`)
    }

    return next()
  }

  /**
   * Remove entradas expiradas do cache
   */
  private cleanup() {
    const now = Date.now()
    for (const [key, entry] of rateLimitCache.entries()) {
      // Remove se passou do tempo de bloqueio ou da janela
      const maxAge = entry.blockedUntil
        ? entry.blockedUntil + 60000  // 1 min após desbloqueio
        : entry.firstAttempt + WINDOW_MS + 60000

      if (now > maxAge) {
        rateLimitCache.delete(key)
      }
    }
  }
}
