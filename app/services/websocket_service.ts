/**
 * ===========================================================================
 * SERVIÇO WEBSOCKET - Comunicação em Tempo Real
 * ===========================================================================
 *
 * Este serviço gerencia todas as conexões WebSocket do sistema, permitindo
 * comunicação bidirecional em tempo real entre o servidor e os clientes.
 *
 * FUNCIONALIDADES:
 * ----------------
 * - Notificação de novas batidas de ponto (tempo real)
 * - Atualização de estatísticas do dashboard
 * - Status dos equipamentos REP (online/offline)
 * - Eventos personalizados por município (rooms)
 *
 * ARQUITETURA:
 * ------------
 * O serviço usa Socket.IO para gerenciar as conexões. Cada município
 * possui uma "room" separada, permitindo enviar eventos apenas para
 * os clientes do município específico (multi-tenant).
 *
 * FLUXO DE CONEXÃO:
 * -----------------
 * 1. Cliente conecta via WebSocket em /ws
 * 2. Cliente emite evento 'subscribe' com municipioId
 * 3. Servidor adiciona cliente à room `municipio-{id}`
 * 4. Eventos são enviados apenas para a room correta
 *
 * EVENTOS EMITIDOS:
 * -----------------
 * - 'nova-batida': Nova batida de ponto registrada
 * - 'stats-update': Estatísticas do dashboard atualizadas
 * - 'equipamento-status': Status de equipamento alterado
 *
 * USO NO CLIENTE (JavaScript):
 * ----------------------------
 * ```javascript
 * const socket = io({ path: '/ws' })
 *
 * // Inscrever no município
 * socket.emit('subscribe', municipioId)
 *
 * // Ouvir novas batidas
 * socket.on('nova-batida', (batida) => {
 *   console.log(`${batida.funcionario_nome} - ${batida.sentido}`)
 * })
 * ```
 *
 * INICIALIZAÇÃO:
 * --------------
 * O serviço é inicializado automaticamente pelo WebSocketProvider
 * quando o servidor HTTP do AdonisJS está pronto.
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

import { Server as SocketServer } from 'socket.io'
import type { Server as HttpServer } from 'node:http'

/**
 * Classe de serviço WebSocket
 *
 * Implementa o padrão Singleton para garantir uma única instância
 * do servidor WebSocket em toda a aplicação.
 *
 * O WebSocket é essencial para:
 * - Atualização em tempo real do terminal de ponto
 * - Dashboard com estatísticas ao vivo
 * - Notificações instantâneas de batidas
 *
 * @example
 * ```typescript
 * // Emitir nova batida
 * websocketService.emitNovaBatida(municipioId, {
 *   funcionario_id: 1,
 *   funcionario_nome: 'João',
 *   data_hora: new Date().toISOString(),
 *   sentido: 'ENTRADA',
 *   origem: 'TERMINAL_FACIAL'
 * })
 * ```
 */
class WebSocketService {
  // ===========================================================================
  // PROPRIEDADES PRIVADAS
  // ===========================================================================

  /**
   * Instância do servidor Socket.IO
   * Null até ser inicializado pelo provider
   */
  private io: SocketServer | null = null

  /**
   * Instância única do serviço (Singleton)
   */
  private static instance: WebSocketService

  // ===========================================================================
  // SINGLETON
  // ===========================================================================

  /**
   * Obtém a instância única do serviço
   *
   * O padrão Singleton garante que apenas uma instância do WebSocket
   * existe na aplicação, evitando múltiplos servidores escutando.
   *
   * @returns Instância única do WebSocketService
   *
   * @example
   * ```typescript
   * const ws = WebSocketService.getInstance()
   * ws.emitNovaBatida(1, batida)
   * ```
   */
  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService()
    }
    return WebSocketService.instance
  }

  // ===========================================================================
  // INICIALIZAÇÃO
  // ===========================================================================

  /**
   * Inicializa o servidor WebSocket
   *
   * Este método deve ser chamado apenas uma vez, quando o servidor HTTP
   * do AdonisJS estiver pronto. O WebSocketProvider faz essa chamada
   * automaticamente no lifecycle hook `ready()`.
   *
   * CONFIGURAÇÕES:
   * - CORS habilitado para qualquer origem (development)
   * - Path: /ws (evita conflito com rotas HTTP)
   * - Métodos permitidos: GET, POST
   *
   * EVENTOS REGISTRADOS:
   * - 'connection': Novo cliente conectou
   * - 'subscribe': Cliente quer entrar numa room
   * - 'disconnect': Cliente desconectou
   *
   * @param httpServer - Servidor HTTP do Node.js (do AdonisJS)
   *
   * @example
   * ```typescript
   * // No WebSocketProvider.ready()
   * const httpServer = server.getNodeServer()
   * websocketService.init(httpServer)
   * ```
   */
  init(httpServer: HttpServer): void {
    // -------------------------------------------------------------------------
    // VERIFICA SE JÁ FOI INICIALIZADO
    // -------------------------------------------------------------------------
    // Evita múltiplas inicializações (importante para HMR no dev)
    if (this.io) {
      console.log('[WebSocket] Já inicializado')
      return
    }

    // -------------------------------------------------------------------------
    // CRIA SERVIDOR SOCKET.IO
    // -------------------------------------------------------------------------
    // Attach no servidor HTTP existente do AdonisJS
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: '*', // Em produção, restringir para o domínio específico
        methods: ['GET', 'POST'],
      },
      path: '/ws', // Caminho separado para evitar conflito com rotas HTTP
    })

    // -------------------------------------------------------------------------
    // REGISTRA HANDLERS DE CONEXÃO
    // -------------------------------------------------------------------------
    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Cliente conectado: ${socket.id}`)

      // -----------------------------------------------------------------------
      // EVENTO: subscribe
      // -----------------------------------------------------------------------
      // Cliente se inscreve para receber eventos de um município específico
      // Isso implementa o multi-tenant no WebSocket
      socket.on('subscribe', (municipioId: number) => {
        const room = `municipio-${municipioId}`
        socket.join(room)
        console.log(`[WebSocket] ${socket.id} inscrito em ${room}`)
      })

      // -----------------------------------------------------------------------
      // EVENTO: disconnect
      // -----------------------------------------------------------------------
      // Limpeza quando cliente desconecta
      socket.on('disconnect', () => {
        console.log(`[WebSocket] Cliente desconectado: ${socket.id}`)
      })
    })

    console.log('[WebSocket] Servidor inicializado')
  }

  // ===========================================================================
  // MÉTODOS DE EMISSÃO DE EVENTOS
  // ===========================================================================

  /**
   * Emite evento de nova batida para todos os clientes do município
   *
   * Este é o evento mais importante do sistema. É chamado quando:
   * - Terminal facial registra uma batida
   * - Webhook do REP recebe uma batida
   * - Serviço de sincronização importa do AFD
   *
   * Os clientes (browsers) recebem este evento e podem:
   * - Atualizar lista de batidas na tela
   * - Mostrar notificação toast
   * - Tocar som de confirmação
   * - Atualizar contador no dashboard
   *
   * @param municipioId - ID do município para enviar o evento
   * @param batida - Dados da batida registrada
   * @param batida.funcionario_id - ID do funcionário
   * @param batida.funcionario_nome - Nome do funcionário
   * @param batida.data_hora - Data/hora no formato ISO
   * @param batida.sentido - 'ENTRADA' ou 'SAIDA'
   * @param batida.origem - Origem do registro (TERMINAL_FACIAL, EQUIPAMENTO, etc)
   *
   * @example
   * ```typescript
   * websocketService.emitNovaBatida(1, {
   *   funcionario_id: 42,
   *   funcionario_nome: 'Maria Silva',
   *   data_hora: '2024-12-13T08:00:00.000Z',
   *   sentido: 'ENTRADA',
   *   origem: 'TERMINAL_FACIAL'
   * })
   * ```
   */
  emitNovaBatida(municipioId: number, batida: {
    /** ID do funcionário que bateu ponto */
    funcionario_id: number
    /** Nome completo do funcionário */
    funcionario_nome: string
    /** Data/hora da batida em formato ISO */
    data_hora: string
    /** Sentido: ENTRADA ou SAIDA */
    sentido: string
    /** Origem do registro */
    origem: string
  }): void {
    // Verifica se WebSocket está inicializado
    if (!this.io) return

    // Define a room do município e emite
    const room = `municipio-${municipioId}`
    this.io.to(room).emit('nova-batida', batida)

    // Log para debug
    console.log(`[WebSocket] Emitido nova-batida para ${room}:`, batida.funcionario_nome)
  }

  /**
   * Emite atualização de estatísticas do dashboard
   *
   * Usado para atualizar os cards de estatísticas em tempo real
   * sem necessidade de refresh da página.
   *
   * @param municipioId - ID do município
   * @param stats - Objeto com as estatísticas
   * @param stats.total_funcionarios - Total de funcionários ativos
   * @param stats.presentes_hoje - Funcionários que bateram ponto hoje
   * @param stats.registros_hoje - Total de registros hoje
   * @param stats.equipamentos_online - Equipamentos com status ONLINE
   *
   * @example
   * ```typescript
   * websocketService.emitStatsUpdate(1, {
   *   total_funcionarios: 315,
   *   presentes_hoje: 280,
   *   registros_hoje: 560,
   *   equipamentos_online: 3
   * })
   * ```
   */
  emitStatsUpdate(municipioId: number, stats: {
    /** Total de funcionários ativos no sistema */
    total_funcionarios: number
    /** Funcionários que já bateram ponto hoje */
    presentes_hoje: number
    /** Número total de registros hoje */
    registros_hoje: number
    /** Quantidade de equipamentos REP online */
    equipamentos_online: number
  }): void {
    if (!this.io) return

    const room = `municipio-${municipioId}`
    this.io.to(room).emit('stats-update', stats)
  }

  /**
   * Emite mudança de status de equipamento
   *
   * Notifica os clientes quando um equipamento REP muda de status
   * (ONLINE/OFFLINE). Útil para monitoramento em tempo real.
   *
   * @param municipioId - ID do município
   * @param equipamento - Dados do equipamento
   * @param equipamento.id - ID do equipamento
   * @param equipamento.nome - Nome/descrição do equipamento
   * @param equipamento.status - Novo status (ONLINE, OFFLINE)
   *
   * @example
   * ```typescript
   * websocketService.emitEquipamentoStatus(1, {
   *   id: 1,
   *   nome: 'REP Entrada Principal',
   *   status: 'ONLINE'
   * })
   * ```
   */
  emitEquipamentoStatus(municipioId: number, equipamento: {
    /** ID do equipamento */
    id: number
    /** Nome/descrição do equipamento */
    nome: string
    /** Status atual: ONLINE ou OFFLINE */
    status: string
  }): void {
    if (!this.io) return

    const room = `municipio-${municipioId}`
    this.io.to(room).emit('equipamento-status', equipamento)
  }

  /**
   * Emite progresso do processamento de espelhos
   * 
   * Usado para mostrar barra de progresso durante o processamento
   * de espelhos de ponto (operação que pode levar minutos).
   * 
   * @param municipioId - ID do município
   * @param progresso - Dados do progresso
   */
  emitProgressoEspelho(municipioId: number, progresso: {
    /** Funcionário sendo processado atualmente */
    funcionario_nome: string
    /** Índice atual (1-based) */
    atual: number
    /** Total de funcionários */
    total: number
    /** Percentual concluído (0-100) */
    percentual: number
    /** Status: 'processando' ou 'concluido' */
    status: string
  }): void {
    if (!this.io) return

    const room = `municipio-${municipioId}`
    this.io.to(room).emit('progresso-espelho', progresso)
  }

  /**
   * Emite evento genérico para um município
   *
   * Método flexível para emitir qualquer tipo de evento personalizado.
   * Use para casos não cobertos pelos métodos específicos.
   *
   * @param municipioId - ID do município
   * @param event - Nome do evento
   * @param data - Dados a serem enviados (qualquer tipo)
   *
   * @example
   * ```typescript
   * // Evento customizado
   * websocketService.emit(1, 'feriado-adicionado', {
   *   data: '2024-12-25',
   *   descricao: 'Natal'
   * })
   * ```
   */
  emit(municipioId: number, event: string, data: any): void {
    if (!this.io) return

    const room = `municipio-${municipioId}`
    this.io.to(room).emit(event, data)
  }

  /**
   * Emite nova notificação para todos os clientes do município
   *
   * @param municipioId - ID do município
   * @param notificacao - Dados da notificação
   */
  emitNovaNotificacao(municipioId: number, notificacao: {
    id: number
    titulo: string
    mensagem: string
    tipo: string
    categoria: string
    funcionario_id?: number
  }): void {
    if (!this.io) return

    const room = `municipio-${municipioId}`
    this.io.to(room).emit('nova-notificacao', notificacao)
    console.log(`[WebSocket] Emitido nova-notificacao para ${room}:`, notificacao.titulo)
  }

  /**
   * Broadcast para todos os clientes conectados
   *
   * Envia evento para TODOS os clientes, independente do município.
   * Use com cautela - apenas para eventos globais do sistema.
   *
   * @param event - Nome do evento
   * @param data - Dados a serem enviados
   *
   * @example
   * ```typescript
   * // Aviso de manutenção para todos
   * websocketService.broadcast('manutencao', {
   *   mensagem: 'Sistema entrará em manutenção em 5 minutos'
   * })
   * ```
   */
  broadcast(event: string, data: any): void {
    if (!this.io) return
    this.io.emit(event, data)
  }

  // ===========================================================================
  // MÉTODOS UTILITÁRIOS
  // ===========================================================================

  /**
   * Retorna instância do Socket.IO
   *
   * Permite acesso direto ao servidor Socket.IO para casos
   * avançados não cobertos pelos métodos do serviço.
   *
   * @returns Instância do Socket.IO Server ou null se não inicializado
   *
   * @example
   * ```typescript
   * const io = websocketService.getIO()
   * if (io) {
   *   // Acesso direto ao Socket.IO
   *   const sockets = await io.fetchSockets()
   *   console.log(`${sockets.length} clientes conectados`)
   * }
   * ```
   */
  getIO(): SocketServer | null {
    return this.io
  }
}

// =============================================================================
// EXPORTAÇÕES
// =============================================================================

/**
 * Instância singleton do serviço WebSocket
 *
 * Use esta exportação em qualquer parte do código para emitir eventos:
 *
 * @example
 * ```typescript
 * import { websocketService } from '#services/websocket_service'
 *
 * // Emitir evento
 * websocketService.emitNovaBatida(municipioId, batida)
 * ```
 */
export const websocketService = WebSocketService.getInstance()

/**
 * Exportação default (mesmo que websocketService)
 */
export default websocketService
