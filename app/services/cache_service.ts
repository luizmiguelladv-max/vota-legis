import logger from '@adonisjs/core/services/logger'

/**
 * Serviço de Cache em Memória
 *
 * Cache simples em memória com TTL (Time To Live)
 * Limpa automaticamente ao salvar/editar dados
 */
class CacheService {
  private cache: Map<string, { data: any; expiresAt: number }> = new Map()
  private stats = { hits: 0, misses: 0 }

  /**
   * Obtém um valor do cache
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key)

    if (!item) {
      this.stats.misses++
      return null
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key)
      this.stats.misses++
      return null
    }

    this.stats.hits++
    return item.data as T
  }

  /**
   * Define um valor no cache
   * @param key Chave do cache
   * @param data Dados a serem armazenados
   * @param ttlSeconds Tempo de vida em segundos (padrão: 5 minutos)
   */
  set(key: string, data: any, ttlSeconds: number = 300): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  /**
   * Remove um item específico do cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Remove todos os itens que começam com um prefixo
   * Útil para invalidar cache por entidade/município
   */
  deleteByPrefix(prefix: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
      }
    }
    if (count > 0) {
      logger.debug(`Cache: ${count} entradas removidas com prefixo "${prefix}"`)
    }
    return count
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    logger.info(`Cache limpo: ${size} entradas removidas`)
  }

  /**
   * Limpa cache de um município específico
   */
  clearMunicipio(municipioId: number): void {
    this.deleteByPrefix(`mun:${municipioId}:`)
    logger.debug(`Cache do município ${municipioId} limpo`)
  }

  /**
   * Limpa cache de uma entidade específica em um município
   */
  clearEntidade(municipioId: number, entidade: string, entidadeId?: number): void {
    this.deleteByPrefix(`mun:${municipioId}:${entidade}`)
    if (entidadeId) {
      this.deleteByPrefix(`ent:${entidadeId}:${entidade}`)
    }
    logger.debug(`Cache de ${entidade} do município ${municipioId} limpo`)
  }

  /**
   * Limpa cache usando o tenant (limpa tanto mun: quanto ent:)
   */
  clearTenantCache(tenant: { municipioId?: number; entidadeId?: number }, entidade: string): void {
    if (tenant.municipioId) {
      this.deleteByPrefix(`mun:${tenant.municipioId}:${entidade}`)
    }
    if (tenant.entidadeId) {
      this.deleteByPrefix(`ent:${tenant.entidadeId}:${entidade}`)
    }
    logger.debug(`Cache de ${entidade} limpo para tenant`)
  }

  /**
   * Obtém ou define um valor no cache (helper)
   * Se não existir, executa a função e armazena o resultado
   */
  async getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds: number = 300): Promise<T> {
    const cached = this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    const data = await fetchFn()
    this.set(key, data, ttlSeconds)
    return data
  }

  /**
   * Gera uma chave de cache para município
   */
  keyMunicipio(municipioId: number, entidade: string, params?: string): string {
    let key = `mun:${municipioId}:${entidade}`
    if (params) key += `:${params}`
    return key
  }

  /**
   * Retorna estatísticas do cache
   */
  getStats() {
    const total = this.cache.size
    let validCount = 0
    let expiredCount = 0
    const now = Date.now()

    for (const item of this.cache.values()) {
      if (now <= item.expiresAt) {
        validCount++
      } else {
        expiredCount++
      }
    }

    return {
      total,
      valid: validCount,
      expired: expiredCount,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate:
        this.stats.hits + this.stats.misses > 0
          ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
          : 0,
    }
  }

  /**
   * Limpa entradas expiradas (garbage collection)
   */
  gc(): number {
    const now = Date.now()
    let removed = 0

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key)
        removed++
      }
    }

    if (removed > 0) {
      logger.debug(`Cache GC: ${removed} entradas expiradas removidas`)
    }

    return removed
  }
}

// Exporta instância única (singleton)
export const cacheService = new CacheService()

// Executa GC a cada 5 minutos
setInterval(
  () => {
    cacheService.gc()
  },
  5 * 60 * 1000
)

export default cacheService
