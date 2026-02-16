/**
 * SSE Service - Gerencia conexões Server-Sent Events para tempo real
 * 
 * Usado para:
 * - Atualizar painel de votação em tempo real
 * - Notificar vereadores sobre novas votações
 * - Atualizar cronômetro de fala
 * - Broadcast de eventos da sessão
 */

import { Response } from '@adonisjs/core/http'

interface SSEClient {
  response: Response
  municipioId: number
  sessaoId: number
  userId?: number
  tipo: 'painel' | 'vereador' | 'controle' | 'presidente'
  connectedAt: Date
}

interface SSEEvent {
  type: string
  data: any
  sessaoId: number
  municipioId: number
}

class SSEService {
  private clients: Map<string, SSEClient> = new Map()
  private eventHistory: Map<number, SSEEvent[]> = new Map() // últimos eventos por sessão

  /**
   * Gera ID único para o cliente
   */
  private generateClientId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Registra um novo cliente SSE
   */
  addClient(
    response: Response,
    municipioId: number,
    sessaoId: number,
    tipo: 'painel' | 'vereador' | 'controle' | 'presidente',
    userId?: number
  ): string {
    const clientId = this.generateClientId()

    // Configura headers SSE
    response.response.setHeader('Content-Type', 'text/event-stream')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Connection', 'keep-alive')
    response.response.setHeader('X-Accel-Buffering', 'no')

    // Registra cliente
    this.clients.set(clientId, {
      response,
      municipioId,
      sessaoId,
      userId,
      tipo,
      connectedAt: new Date()
    })

    // Envia evento de conexão
    this.sendToClient(clientId, {
      type: 'connected',
      clientId,
      timestamp: new Date().toISOString()
    })

    // Envia histórico recente de eventos
    const history = this.eventHistory.get(sessaoId) || []
    if (history.length > 0) {
      this.sendToClient(clientId, {
        type: 'history',
        events: history.slice(-10) // últimos 10 eventos
      })
    }

    console.log(`[SSE] Cliente conectado: ${clientId} (${tipo}) - Sessão ${sessaoId}`)

    return clientId
  }

  /**
   * Remove cliente desconectado
   */
  removeClient(clientId: string): void {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId)
      console.log(`[SSE] Cliente desconectado: ${clientId}`)
    }
  }

  /**
   * Envia evento para um cliente específico
   */
  private sendToClient(clientId: string, data: any): boolean {
    const client = this.clients.get(clientId)
    if (!client) return false

    try {
      const message = `data: ${JSON.stringify(data)}\n\n`
      client.response.response.write(message)
      return true
    } catch (error) {
      console.error(`[SSE] Erro ao enviar para ${clientId}:`, error)
      this.removeClient(clientId)
      return false
    }
  }

  /**
   * Broadcast para todos os clientes de uma sessão
   */
  broadcast(sessaoId: number, municipioId: number, eventType: string, data: any): void {
    const event: SSEEvent = {
      type: eventType,
      data,
      sessaoId,
      municipioId
    }

    // Salva no histórico
    if (!this.eventHistory.has(sessaoId)) {
      this.eventHistory.set(sessaoId, [])
    }
    const history = this.eventHistory.get(sessaoId)!
    history.push(event)
    if (history.length > 50) history.shift() // mantém últimos 50

    // Envia para todos os clientes da sessão
    let sent = 0
    this.clients.forEach((client, clientId) => {
      if (client.sessaoId === sessaoId && client.municipioId === municipioId) {
        if (this.sendToClient(clientId, { type: eventType, ...data, timestamp: new Date().toISOString() })) {
          sent++
        }
      }
    })

    console.log(`[SSE] Broadcast ${eventType} para ${sent} clientes - Sessão ${sessaoId}`)
  }

  /**
   * Envia evento apenas para vereadores
   */
  broadcastToVereadores(sessaoId: number, municipioId: number, eventType: string, data: any): void {
    this.clients.forEach((client, clientId) => {
      if (
        client.sessaoId === sessaoId &&
        client.municipioId === municipioId &&
        client.tipo === 'vereador'
      ) {
        this.sendToClient(clientId, { type: eventType, ...data, timestamp: new Date().toISOString() })
      }
    })
  }

  /**
   * Envia evento para um vereador específico
   */
  sendToVereador(sessaoId: number, municipioId: number, userId: number, eventType: string, data: any): void {
    this.clients.forEach((client, clientId) => {
      if (
        client.sessaoId === sessaoId &&
        client.municipioId === municipioId &&
        client.userId === userId
      ) {
        this.sendToClient(clientId, { type: eventType, ...data, timestamp: new Date().toISOString() })
      }
    })
  }

  /**
   * Envia heartbeat para manter conexões ativas
   */
  sendHeartbeat(): void {
    const now = new Date().toISOString()
    this.clients.forEach((client, clientId) => {
      this.sendToClient(clientId, { type: 'heartbeat', timestamp: now })
    })
  }

  /**
   * Retorna estatísticas de conexões
   */
  getStats(): { total: number; porTipo: Record<string, number>; porSessao: Record<number, number> } {
    const stats = {
      total: this.clients.size,
      porTipo: {} as Record<string, number>,
      porSessao: {} as Record<number, number>
    }

    this.clients.forEach((client) => {
      // Por tipo
      stats.porTipo[client.tipo] = (stats.porTipo[client.tipo] || 0) + 1
      // Por sessão
      stats.porSessao[client.sessaoId] = (stats.porSessao[client.sessaoId] || 0) + 1
    })

    return stats
  }

  /**
   * Limpa histórico de sessão encerrada
   */
  clearSessionHistory(sessaoId: number): void {
    this.eventHistory.delete(sessaoId)
  }
}

// Singleton
const sseService = new SSEService()

// Heartbeat a cada 30 segundos
setInterval(() => {
  sseService.sendHeartbeat()
}, 30000)

export default sseService

// Tipos de eventos
export const SSE_EVENTS = {
  // Sessão
  SESSAO_INICIADA: 'sessao:iniciada',
  SESSAO_ENCERRADA: 'sessao:encerrada',
  SESSAO_SUSPENSA: 'sessao:suspensa',
  SESSAO_RETOMADA: 'sessao:retomada',

  // Quórum
  QUORUM_INICIADO: 'quorum:iniciado',
  QUORUM_ATUALIZADO: 'quorum:atualizado',
  QUORUM_FINALIZADO: 'quorum:finalizado',
  PRESENCA_REGISTRADA: 'presenca:registrada',
  PRESENCA_REMOVIDA: 'presenca:removida',

  // Votação
  VOTACAO_INICIADA: 'votacao:iniciada',
  VOTACAO_ATUALIZADA: 'votacao:atualizada',
  VOTACAO_ENCERRADA: 'votacao:encerrada',
  VOTO_REGISTRADO: 'voto:registrado',

  // Tempo de fala
  FALA_INICIADA: 'fala:iniciada',
  FALA_PAUSADA: 'fala:pausada',
  FALA_RETOMADA: 'fala:retomada',
  FALA_ENCERRADA: 'fala:encerrada',
  TEMPO_ATUALIZADO: 'tempo:atualizado',
  APARTE_INICIADO: 'aparte:iniciado',
  APARTE_ENCERRADO: 'aparte:encerrado',

  // Inscrições
  INSCRICAO_ABERTA: 'inscricao:aberta',
  INSCRICAO_FECHADA: 'inscricao:fechada',
  INSCRICAO_REGISTRADA: 'inscricao:registrada',
  INSCRICAO_CANCELADA: 'inscricao:cancelada',

  // Pauta
  MATERIA_EM_PAUTA: 'materia:em_pauta',
  EXPEDIENTE_LIDO: 'expediente:lido',

  // Sistema
  HEARTBEAT: 'heartbeat',
  CONNECTED: 'connected',
  HISTORY: 'history'
} as const
