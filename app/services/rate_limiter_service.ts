/**
 * ===========================================================================
 * RATE LIMITER SERVICE - Proteção contra Força Bruta e Abuso de API
 * ===========================================================================
 *
 * Este serviço implementa rate limiting (limitação de taxa) para proteger
 * o sistema contra ataques de força bruta, DDoS e abuso de recursos.
 *
 * ESTRATÉGIAS IMPLEMENTADAS:
 * --------------------------
 * 1. **Por IP**: Limita requisições por endereço IP
 * 2. **Por Usuário**: Limita requisições por usuário autenticado
 * 3. **Por Endpoint**: Limita requisições em endpoints específicos
 * 4. **Por Recurso**: Limita operações em recursos específicos (ex: reconhecimento facial)
 *
 * ARMAZENAMENTO:
 * --------------
 * - Em memória (Map) para desenvolvimento
 * - Redis para produção (escalável e distribuído)
 *
 * CONFIGURAÇÕES PADRÃO:
 * ---------------------
 * - Login: 5 tentativas por 15 minutos
 * - API Geral: 100 requisições por minuto
 * - Reconhecimento Facial: 10 tentativas por minuto
 * - Webhook REP: 1000 requisições por minuto
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2026-01-06
 *
 * ===========================================================================
 */

interface RateLimitEntry {
  count: number
  resetAt: number
  blocked: boolean
}

export default class RateLimiterService {
  private static attempts = new Map<string, RateLimitEntry>()
  private static cleanupInterval: NodeJS.Timeout | null = null

  /**
   * Inicializa o serviço de rate limiting
   *
   * Inicia a limpeza automática de entradas expiradas a cada 5 minutos.
   */
  static initialize() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup()
      }, 5 * 60 * 1000) // 5 minutos
    }
  }

  /**
   * Verifica se uma chave excedeu o limite de requisições
   *
   * @param key - Chave única (ex: "login:192.168.1.1", "api:user:123")
   * @param maxAttempts - Número máximo de tentativas permitidas
   * @param windowMs - Janela de tempo em milissegundos
   * @returns true se permitido, false se bloqueado
   */
  static check(key: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now()
    const entry = this.attempts.get(key)

    // Se não existe entrada, cria uma nova
    if (!entry) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + windowMs,
        blocked: false,
      })
      return true
    }

    // Se a janela expirou, reseta o contador
    if (now > entry.resetAt) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + windowMs,
        blocked: false,
      })
      return true
    }

    // Se está bloqueado, retorna false
    if (entry.blocked) {
      return false
    }

    // Incrementa o contador
    entry.count++

    // Se excedeu o limite, bloqueia
    if (entry.count > maxAttempts) {
      entry.blocked = true
      return false
    }

    return true
  }

  /**
   * Registra uma tentativa para uma chave
   *
   * @param key - Chave única
   * @param windowMs - Janela de tempo em milissegundos
   */
  static record(key: string, windowMs: number = 60000) {
    const now = Date.now()
    const entry = this.attempts.get(key)

    if (!entry || now > entry.resetAt) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + windowMs,
        blocked: false,
      })
    } else {
      entry.count++
    }
  }

  /**
   * Obtém informações sobre o rate limit de uma chave
   *
   * @param key - Chave única
   * @returns Informações do rate limit ou null
   */
  static getInfo(key: string): RateLimitEntry | null {
    return this.attempts.get(key) || null
  }

  /**
   * Reseta o rate limit de uma chave específica
   *
   * @param key - Chave única
   */
  static reset(key: string) {
    this.attempts.delete(key)
  }

  /**
   * Reseta todos os rate limits
   */
  static resetAll() {
    this.attempts.clear()
  }

  /**
   * Remove entradas expiradas do Map
   *
   * Executado automaticamente a cada 5 minutos.
   */
  private static cleanup() {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.attempts.entries()) {
      if (now > entry.resetAt) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.attempts.delete(key)
    }

    if (keysToDelete.length > 0) {
      console.log(`[RateLimiter] Limpou ${keysToDelete.length} entradas expiradas`)
    }
  }

  /**
   * Para o serviço de rate limiting
   *
   * Remove o intervalo de limpeza automática.
   */
  static shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  // ===========================================================================
  // MÉTODOS AUXILIARES PARA CASOS DE USO ESPECÍFICOS
  // ===========================================================================

  /**
   * Verifica rate limit para login
   *
   * Limite: 5 tentativas por 15 minutos
   *
   * @param identifier - IP ou login do usuário
   * @returns true se permitido, false se bloqueado
   */
  static checkLogin(identifier: string): boolean {
    const key = `login:${identifier}`
    return this.check(key, 5, 15 * 60 * 1000) // 5 tentativas, 15 minutos
  }

  /**
   * Verifica rate limit para API geral
   *
   * Limite: 100 requisições por minuto
   *
   * @param ip - Endereço IP
   * @returns true se permitido, false se bloqueado
   */
  static checkAPI(ip: string): boolean {
    const key = `api:${ip}`
    return this.check(key, 100, 60 * 1000) // 100 requisições, 1 minuto
  }

  /**
   * Verifica rate limit para reconhecimento facial
   *
   * Limite: 10 tentativas por minuto
   *
   * @param ip - Endereço IP
   * @returns true se permitido, false se bloqueado
   */
  static checkFacialRecognition(ip: string): boolean {
    const key = `facial:${ip}`
    return this.check(key, 10, 60 * 1000) // 10 tentativas, 1 minuto
  }

  /**
   * Verifica rate limit para webhook do REP
   *
   * Limite: 1000 requisições por minuto
   *
   * @param deviceId - ID do dispositivo REP
   * @returns true se permitido, false se bloqueado
   */
  static checkWebhookREP(deviceId: string): boolean {
    const key = `webhook:rep:${deviceId}`
    return this.check(key, 1000, 60 * 1000) // 1000 requisições, 1 minuto
  }

  /**
   * Verifica rate limit para envio de SMS (2FA)
   *
   * Limite: 3 SMS por hora
   *
   * @param telefone - Número de telefone
   * @returns true se permitido, false se bloqueado
   */
  static checkSMS(telefone: string): boolean {
    const key = `sms:${telefone}`
    return this.check(key, 3, 60 * 60 * 1000) // 3 SMS, 1 hora
  }

  /**
   * Verifica rate limit para geração de relatórios
   *
   * Limite: 10 relatórios por hora
   *
   * @param userId - ID do usuário
   * @returns true se permitido, false se bloqueado
   */
  static checkRelatorio(userId: number): boolean {
    const key = `relatorio:${userId}`
    return this.check(key, 10, 60 * 60 * 1000) // 10 relatórios, 1 hora
  }
}

// Inicializa o serviço automaticamente
RateLimiterService.initialize()
