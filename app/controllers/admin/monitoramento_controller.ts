import type { HttpContext } from '@adonisjs/core/http'
import Municipio from '#models/municipio'
import CacheService from '#services/cache_service'
import os from 'os'

export default class MonitoramentoController {
  /**
   * Obtém dados de monitoramento do sistema
   */
  async obter({ response }: HttpContext) {
    try {
      // CPU
      const cpus = os.cpus()
      const cpuUsage = this.calcularUsoCPU(cpus)

      // Memória
      const totalMemory = os.totalmem()
      const freeMemory = os.freemem()
      const usedMemory = totalMemory - freeMemory
      const memoryUsage = Math.round((usedMemory / totalMemory) * 100)

      // Uptime
      const uptime = process.uptime()
      const uptimeFormatado = this.formatarUptime(uptime)

      // Cache
      const cacheStats = CacheService.getStats()

      // Conexões de banco (estimativa baseada nos pools)
      const municipios = await Municipio.query().where('ativo', true).count('* as total')
      const poolsAtivos = Number(municipios[0].$extras.total) || 0

      // Versões
      const nodeVersion = process.version
      const platform = os.platform()
      const arch = os.arch()

      return response.json({
        sistema: {
          nodeVersion,
          platform,
          arch,
          uptime: uptimeFormatado,
          uptimeSeconds: uptime,
        },
        cpu: {
          cores: cpus.length,
          modelo: cpus[0]?.model || 'Desconhecido',
          uso: cpuUsage,
        },
        memoria: {
          total: this.formatarBytes(totalMemory),
          usada: this.formatarBytes(usedMemory),
          livre: this.formatarBytes(freeMemory),
          uso: memoryUsage,
        },
        cache: {
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          hitRate: cacheStats.hitRate,
          tamanho: cacheStats.size,
        },
        banco: {
          poolsAtivos,
          status: 'online',
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      console.error('[MonitoramentoController] Erro ao obter dados:', error)
      return response.internalServerError({
        error: 'Erro ao obter dados de monitoramento',
        details: error.message,
      })
    }
  }

  /**
   * Obtém estatísticas gerais do sistema
   */
  async estatisticas({ response }: HttpContext) {
    try {
      // Conta municípios
      const municipios = await Municipio.query()
        .count('* as total')
        .where('ativo', true)
        .first()

      const totalMunicipios = Number(municipios?.$extras.total) || 0

      // Conta usuários master
      const UsuarioMaster = (await import('#models/usuario_master')).default
      const usuarios = await UsuarioMaster.query()
        .count('* as total')
        .where('ativo', true)
        .first()

      const totalUsuarios = Number(usuarios?.$extras.total) || 0

      // Logs de auditoria recentes
      const AuditLog = (await import('#models/audit_log')).default
      const logsHoje = await AuditLog.query()
        .whereRaw("DATE(created_at) = CURRENT_DATE")
        .count('* as total')
        .first()

      const totalLogsHoje = Number(logsHoje?.$extras.total) || 0

      return response.json({
        municipios: {
          total: totalMunicipios,
        },
        usuarios: {
          total: totalUsuarios,
        },
        auditoria: {
          registrosHoje: totalLogsHoje,
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      console.error('[MonitoramentoController] Erro ao obter estatísticas:', error)
      return response.internalServerError({
        error: 'Erro ao obter estatísticas',
        details: error.message,
      })
    }
  }

  /**
   * Limpa o cache do sistema
   */
  async limparCache({ response }: HttpContext) {
    try {
      CacheService.clear()

      return response.json({
        success: true,
        message: 'Cache limpo com sucesso',
      })
    } catch (error: any) {
      console.error('[MonitoramentoController] Erro ao limpar cache:', error)
      return response.internalServerError({
        error: 'Erro ao limpar cache',
        details: error.message,
      })
    }
  }

  /**
   * Obtém logs recentes do sistema
   */
  async logsRecentes({ request, response }: HttpContext) {
    try {
      const limite = Number(request.input('limite', 50))

      const AuditLog = (await import('#models/audit_log')).default
      const logs = await AuditLog.query()
        .orderBy('created_at', 'desc')
        .limit(limite)

      return response.json({
        logs: logs.map((l) => ({
          id: l.id,
          usuarioId: l.usuarioId,
          usuarioTipo: l.usuarioTipo,
          acao: l.acao,
          tabela: l.tabela,
          registroId: l.registroId,
          ip: l.ip,
          createdAt: l.createdAt,
        })),
      })
    } catch (error: any) {
      console.error('[MonitoramentoController] Erro ao obter logs:', error)
      return response.internalServerError({
        error: 'Erro ao obter logs',
        details: error.message,
      })
    }
  }

  /**
   * Calcula uso de CPU (aproximado)
   */
  private calcularUsoCPU(cpus: os.CpuInfo[]): number {
    let totalIdle = 0
    let totalTick = 0

    for (const cpu of cpus) {
      for (const tipo in cpu.times) {
        totalTick += cpu.times[tipo as keyof typeof cpu.times]
      }
      totalIdle += cpu.times.idle
    }

    return Math.round(100 - (totalIdle / totalTick) * 100)
  }

  /**
   * Formata bytes para leitura humana
   */
  private formatarBytes(bytes: number): string {
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let tamanho = bytes

    while (tamanho >= 1024 && i < unidades.length - 1) {
      tamanho /= 1024
      i++
    }

    return `${tamanho.toFixed(1)} ${unidades[i]}`
  }

  /**
   * Formata uptime para leitura humana
   */
  private formatarUptime(segundos: number): string {
    const dias = Math.floor(segundos / 86400)
    const horas = Math.floor((segundos % 86400) / 3600)
    const minutos = Math.floor((segundos % 3600) / 60)

    const partes: string[] = []
    if (dias > 0) partes.push(`${dias}d`)
    if (horas > 0) partes.push(`${horas}h`)
    if (minutos > 0) partes.push(`${minutos}m`)

    return partes.length > 0 ? partes.join(' ') : '< 1m'
  }
}
