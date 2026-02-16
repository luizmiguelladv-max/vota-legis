/**
 * ===========================================================================
 * REP SYNC PROVIDER
 * ===========================================================================
 *
 * Provider do AdonisJS que inicializa automaticamente o serviço de
 * sincronização com os equipamentos REP Control iD.
 *
 * Este provider é executado durante o boot da aplicação e garante que o
 * serviço de sincronização esteja rodando em background para:
 * - Buscar batidas do REP automaticamente a cada 5 segundos
 * - Importar novos registros de ponto para o banco
 * - Enviar notificações via WebSocket
 *
 * @author Claude
 * @version 1.0.0
 * @since 2024-12-14
 *
 * ===========================================================================
 * CICLO DE VIDA DO PROVIDER
 * ===========================================================================
 *
 * 1. register()  - Registra bindings no container (não usado aqui)
 * 2. boot()      - Container pronto, mas servidor ainda não iniciou
 * 3. start()     - Aplicação iniciando
 * 4. ready()     - Servidor HTTP pronto - AQUI INICIAMOS A SINCRONIZAÇÃO
 * 5. shutdown()  - Aplicação encerrando - AQUI PARAMOS A SINCRONIZAÇÃO
 *
 * ===========================================================================
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { repSyncService } from '#services/rep_sync_service'

/**
 * Provider responsável por inicializar o serviço de sincronização REP
 */
export default class RepSyncProvider {
  /**
   * Referência ao serviço de aplicação do AdonisJS
   */
  constructor(protected app: ApplicationService) {}

  /**
   * ===========================================================================
   * REGISTER - Registro de Bindings
   * ===========================================================================
   */
  register() {
    // Sem bindings necessários
  }

  /**
   * ===========================================================================
   * BOOT - Container Inicializado
   * ===========================================================================
   */
  async boot() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * START - Aplicação Iniciando
   * ===========================================================================
   */
  async start() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * READY - Servidor HTTP Pronto
   * ===========================================================================
   *
   * Aqui iniciamos o serviço de sincronização com os REPs.
   * Esperamos alguns segundos para garantir que todos os outros
   * serviços (banco, WebSocket, etc.) estejam prontos.
   */
  async ready() {
    try {
      console.log('[REP Sync Provider] Iniciando serviço de sincronização REP...')

      // Aguarda 3 segundos para garantir que outros serviços estejam prontos
      await new Promise((resolve) => setTimeout(resolve, 3000))

      // Inicia o serviço de sincronização
      await repSyncService.start()

      console.log('[REP Sync Provider] ✅ Serviço de sincronização REP inicializado com sucesso')
      console.log('[REP Sync Provider] → Intervalo: 5 segundos')
      console.log('[REP Sync Provider] → Auto-restart: HABILITADO')
    } catch (error) {
      console.error('[REP Sync Provider] ❌ Erro ao inicializar sincronização REP:', error)
      console.error('[REP Sync Provider] → Execute manualmente: node --insecure-http-parser scripts/servico-sincronizacao.mjs')
    }
  }

  /**
   * ===========================================================================
   * SHUTDOWN - Aplicação Encerrando
   * ===========================================================================
   */
  async shutdown() {
    try {
      if (repSyncService.isRunning()) {
        console.log('[REP Sync Provider] Encerrando serviço de sincronização REP...')
        await repSyncService.stop()
        console.log('[REP Sync Provider] ✅ Serviço de sincronização REP encerrado com sucesso')
      }
    } catch (error) {
      console.error('[REP Sync Provider] ❌ Erro ao encerrar sincronização REP:', error)
    }
  }
}
