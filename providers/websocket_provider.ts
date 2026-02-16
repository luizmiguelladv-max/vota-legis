/**
 * WebSocket Provider
 * Inicializa o servidor WebSocket quando a aplicação inicia
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { websocketService } from '#services/websocket_service'

export default class WebSocketProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register bindings to the container
   */
  register() {}

  /**
   * The container bindings have booted
   */
  async boot() {}

  /**
   * The application has been booted
   */
  async start() {}

  /**
   * Preparing to shutdown the app
   */
  async shutdown() {}

  /**
   * The HTTP server is ready
   */
  async ready() {
    // Obtém o servidor HTTP do AdonisJS
    const server = await this.app.container.make('server')
    const httpServer = server.getNodeServer()

    if (httpServer) {
      websocketService.init(httpServer)
      console.log('[WebSocket Provider] WebSocket inicializado na porta do servidor')
    } else {
      console.warn('[WebSocket Provider] Servidor HTTP não disponível')
    }
  }
}
