/**
 * ===========================================================================
 * ANOMALIAS PROVIDER
 * ===========================================================================
 *
 * Provider do AdonisJS que executa:
 * 1. Monitoramento em tempo real (a cada 30 min durante expediente)
 * 2. Verificação de anomalias do dia anterior (1x ao dia)
 *
 * Detecta automaticamente:
 * - SAIDA_PENDENTE: Funcionário passou do horário de saída + tolerância
 * - SAIDA_NAO_REGISTRADA: Funcionário com batidas ímpares no fim do dia
 * - FALTA_SEM_JUSTIFICATIVA: Funcionário não bateu ponto em dia útil
 *
 * @author Claude
 * @version 2.0.0
 * @since 2024-01-10
 *
 * ===========================================================================
 */

import type { ApplicationService } from '@adonisjs/core/types'

export default class AnomaliasProvider {
  private monitoramentoIntervalId: NodeJS.Timeout | null = null
  private verificacaoDiariaIntervalId: NodeJS.Timeout | null = null
  private ultimaVerificacaoDiaria: string | null = null

  constructor(protected app: ApplicationService) {}

  register() {}

  async boot() {}

  async start() {}

  /**
   * Servidor HTTP pronto - inicia os jobs
   */
  async ready() {
    console.log('[Anomalias Provider] Iniciando sistema de alertas automáticos...')

    // Aguarda serviços estarem prontos
    await new Promise((resolve) => setTimeout(resolve, 8000))

    // =========================================================================
    // 1. MONITORAMENTO EM TEMPO REAL (a cada 30 minutos)
    // =========================================================================
    // Verifica funcionários que deveriam ter batido saída mas não bateram
    // Tolerância: 60 minutos após horário esperado de saída
    this.monitoramentoIntervalId = setInterval(async () => {
      await this.executarMonitoramentoTempoReal()
    }, 30 * 60 * 1000) // 30 minutos

    // Executa primeira verificação após 1 minuto
    setTimeout(async () => {
      await this.executarMonitoramentoTempoReal()
    }, 60 * 1000)

    console.log('[Anomalias Provider] ✅ Monitoramento em tempo real: a cada 30 minutos')

    // =========================================================================
    // 2. VERIFICAÇÃO DIÁRIA (1x ao dia, verifica dia anterior)
    // =========================================================================
    this.verificacaoDiariaIntervalId = setInterval(async () => {
      await this.executarVerificacaoDiaria()
    }, 60 * 60 * 1000) // 1 hora (verifica se já executou hoje)

    // Executa verificação diária após 2 minutos
    setTimeout(async () => {
      await this.executarVerificacaoDiaria()
    }, 2 * 60 * 1000)

    console.log('[Anomalias Provider] ✅ Verificação diária: 1x ao dia (dia anterior)')
    console.log('[Anomalias Provider] ✅ Sistema de alertas inicializado com sucesso!')
  }

  /**
   * Monitoramento em tempo real
   * Verifica funcionários com saída pendente durante o expediente
   */
  private async executarMonitoramentoTempoReal() {
    try {
      const agora = new Date()
      const hora = agora.getHours()

      // Só monitora entre 10h e 23h (após horário de entrada até fim do dia)
      if (hora < 10 || hora > 23) {
        return
      }

      console.log(`[Anomalias Provider] Executando monitoramento em tempo real...`)

      const { dbManager } = await import('#services/database_manager_service')
      const { monitorarTodosBatidasPendentes } = await import('#services/alertas_service')

      // Tolerância de 60 minutos após horário esperado
      const totalAlertas = await monitorarTodosBatidasPendentes(dbManager, 60)

      if (totalAlertas > 0) {
        console.log(`[Anomalias Provider] ⚠️ ${totalAlertas} alerta(s) de saída pendente gerado(s)`)
      }
    } catch (error: any) {
      console.error('[Anomalias Provider] Erro no monitoramento:', error.message)
    }
  }

  /**
   * Verificação diária do dia anterior
   * Detecta anomalias de batidas ímpares e faltas
   */
  private async executarVerificacaoDiaria() {
    try {
      const agora = new Date()
      const hora = agora.getHours()

      // Só verifica entre 6h e 23h
      if (hora < 6) {
        return
      }

      // Data de ontem (o que queremos verificar)
      const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000)
      const dataOntem = ontem.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

      // Se já verificamos ontem, não verifica novamente
      if (this.ultimaVerificacaoDiaria === dataOntem) {
        return
      }

      console.log(`[Anomalias Provider] Executando verificação diária para ${dataOntem}...`)

      const { dbManager } = await import('#services/database_manager_service')
      const { verificarTodasAnomaliasPonto } = await import('#services/alertas_service')

      const totalAnomalias = await verificarTodasAnomaliasPonto(dbManager, dataOntem)

      this.ultimaVerificacaoDiaria = dataOntem
      console.log(`[Anomalias Provider] ✅ Verificação diária concluída: ${totalAnomalias} anomalia(s)`)
    } catch (error: any) {
      console.error('[Anomalias Provider] Erro na verificação diária:', error.message)
    }
  }

  /**
   * Encerra os jobs
   */
  async shutdown() {
    if (this.monitoramentoIntervalId) {
      clearInterval(this.monitoramentoIntervalId)
    }
    if (this.verificacaoDiariaIntervalId) {
      clearInterval(this.verificacaoDiariaIntervalId)
    }
    console.log('[Anomalias Provider] Sistema de alertas encerrado')
  }
}
