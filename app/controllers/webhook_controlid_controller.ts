/**
 * ===========================================================================
 * WEBHOOK CONTROL ID - Recebe Batidas do REP em Tempo Real
 * ===========================================================================
 *
 * Este controller recebe as batidas de ponto enviadas pelo REP Control iD.
 * O REP envia um POST para este endpoint a cada registro de biometria.
 *
 * CONFIGURAÇÃO NO REP:
 * --------------------
 * 1. Acessar painel do REP: https://192.168.0.200
 * 2. Menu > Comunicação > Servidor (ou Push Server)
 * 3. URL: http://[IP_SERVIDOR]:3333/api/webhook/controlid
 * 4. Habilitar "Envio em tempo real" ou "Push imediato"
 *
 * FLUXO DE PROCESSAMENTO:
 * -----------------------
 * 1. REP envia POST com dados da batida
 * 2. Controller valida o payload
 * 3. Busca equipamento no banco (multi-tenant)
 * 4. Busca funcionário pelo ID ou PIS
 * 5. Calcula ENTRADA/SAÍDA baseado nas batidas do dia
 * 6. Gera NSR (Número Sequencial de Registro)
 * 7. Verifica duplicidade (±1 minuto)
 * 8. Insere registro no banco
 * 9. Emite WebSocket para atualização em tempo real
 *
 * MULTI-TENANT:
 * -------------
 * O campo `municipio_id` no payload permite identificar para qual
 * município a batida pertence. Default: 1 (primeiro município).
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

import type { HttpContext } from '@adonisjs/core/http'
import { dbManager } from '#services/database_manager_service'
import { websocketService } from '#services/websocket_service'

/**
 * Data inicial para filtrar registros antigos
 *
 * Se configurada, registros anteriores a esta data serão ignorados.
 * Útil para importações onde há dados históricos que não devem entrar.
 *
 * Configurar via variável de ambiente: DATA_INICIAL_REGISTROS=2024-12-13
 * Formato: 'YYYY-MM-DD' ou null para aceitar todos
 */
const DATA_INICIAL_REGISTROS = process.env.DATA_INICIAL_REGISTROS || null

/**
 * Controller para recebimento de batidas do REP Control iD
 *
 * Endpoints:
 * - POST /api/webhook/controlid - Recebe batida
 * - GET /api/webhook/controlid - Health check
 */
export default class WebhookControlIdController {

  /**
   * Recebe batida do REP Control iD
   *
   * Este é o endpoint principal que o REP chama a cada registro.
   *
   * ESTRUTURA DO PAYLOAD (Control iD):
   * ```json
   * {
   *   "device_id": "123456",        // ID/Serial do equipamento
   *   "identifier": {
   *     "user_id": 1,               // ID do usuário no REP
   *     "pis": "12345678901"        // PIS do funcionário
   *   },
   *   "time": 1702300800,           // Timestamp Unix (segundos)
   *   "event": 7,                   // Tipo de evento (7=entrada, 8=saída)
   *   "portal_id": 1,               // ID da porta (opcional)
   *   "municipio_id": 1             // ID do município (multi-tenant)
   * }
   * ```
   *
   * CÓDIGOS DE EVENTO:
   * - 7: Entrada
   * - 8: Saída
   * - Outros: Calculado automaticamente baseado nas batidas do dia
   *
   * @param request - Objeto de requisição HTTP
   * @param response - Objeto de resposta HTTP
   * @returns Resposta JSON com status da operação
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3333/api/webhook/controlid \
   *   -H "Content-Type: application/json" \
   *   -d '{
   *     "device_id": "123456",
   *     "identifier": { "user_id": 1, "pis": "12345678901" },
   *     "time": 1702300800,
   *     "event": 7,
   *     "municipio_id": 1
   *   }'
   * ```
   */
  async receberBatida({ request, response }: HttpContext) {
    try {
      // =========================================================================
      // ETAPA 1: Receber e logar payload
      // =========================================================================
      const payload = request.body()
      console.log('[Webhook ControliD] Recebido:', JSON.stringify(payload))

      // =========================================================================
      // ETAPA 2: Extrair dados do payload
      // =========================================================================
      // O Control iD pode enviar em diferentes formatos, então verificamos
      // múltiplos campos possíveis para cada informação

      // ID do equipamento (pode vir em diferentes campos)
      const deviceId = payload.device_id || payload.serial || payload.equipamento

      // ID do usuário no REP (pode vir aninhado ou direto)
      const userId = payload.identifier?.user_id || payload.user_id || payload.usuario_id

      // PIS do funcionário (identificador único)
      const pis = payload.identifier?.pis || payload.pis

      // Timestamp da batida (Unix timestamp ou ISO string)
      const timestamp = payload.time || payload.timestamp || payload.data_hora

      // Tipo de evento (7=entrada, 8=saída no Control iD)
      const event = payload.event || payload.evento

      // ID do município para multi-tenant (default: 1)
      const municipioId = payload.municipio_id || 1

      // =========================================================================
      // ETAPA 3: Validar payload mínimo
      // =========================================================================
      // Precisa do ID do equipamento e alguma forma de identificar o funcionário
      if (!deviceId || (!userId && !pis)) {
        console.log('[Webhook ControliD] Payload inválido - falta deviceId ou identificação')
        return response.badRequest({ error: 'Payload inválido' })
      }

      // =========================================================================
      // ETAPA 4: Converter timestamp para Date
      // =========================================================================
      let dataHora: Date
      if (typeof timestamp === 'number') {
        // Timestamp Unix (segundos desde 1970)
        dataHora = new Date(timestamp * 1000)
      } else if (timestamp) {
        // String ISO ou outro formato
        dataHora = new Date(timestamp)
      } else {
        // Se não veio timestamp, usa agora
        dataHora = new Date()
      }

      // =========================================================================
      // ETAPA 5: Filtrar por data inicial (se configurada)
      // =========================================================================
      // Ignora registros anteriores à data configurada
      if (DATA_INICIAL_REGISTROS) {
        const dataRegistro = dataHora.toISOString().split('T')[0]
        if (dataRegistro < DATA_INICIAL_REGISTROS) {
          console.log(`[Webhook ControliD] Registro ignorado: ${dataRegistro} < ${DATA_INICIAL_REGISTROS}`)
          return response.ok({ success: true, message: 'Registro anterior à data inicial, ignorado' })
        }
      }

      // =========================================================================
      // ETAPA 6: Determinar sentido pelo evento (se disponível)
      // =========================================================================
      // O REP pode enviar o tipo de evento, mas geralmente calculamos
      // automaticamente baseado nas batidas do dia
      let sentidoDoEvento: string | null = null
      if (event === 7 || event === '7' || event === 'entrada') {
        sentidoDoEvento = 'ENTRADA'
      } else if (event === 8 || event === '8' || event === 'saida') {
        sentidoDoEvento = 'SAIDA'
      }

      // =========================================================================
      // ETAPA 7: Buscar equipamento no banco (multi-tenant)
      // =========================================================================
      // Procura pelo código ou número de série do equipamento
      const equipResult = await dbManager.queryMunicipio(
        municipioId,
        `SELECT id FROM equipamentos WHERE codigo = $1 OR numero_serie = $1 LIMIT 1`,
        [deviceId]
      )

      if (equipResult.length === 0) {
        console.log(`[Webhook ControliD] Equipamento não encontrado: ${deviceId}`)
        return response.badRequest({ error: 'Equipamento não encontrado' })
      }

      const equipamentoId = equipResult[0].id

      // =========================================================================
      // ETAPA 8: Buscar funcionário (multi-tenant)
      // =========================================================================
      // Tenta primeiro pelo ID/matrícula, depois pelo PIS
      let funcResult
      if (userId) {
        funcResult = await dbManager.queryMunicipio(
          municipioId,
          `SELECT id FROM funcionarios WHERE id = $1 OR matricula = $2 LIMIT 1`,
          [userId, String(userId)]
        )
      }

      // Se não encontrou pelo ID, tenta pelo PIS
      if ((!funcResult || funcResult.length === 0) && pis) {
        funcResult = await dbManager.queryMunicipio(
          municipioId,
          `SELECT id FROM funcionarios WHERE pis = $1 LIMIT 1`,
          [pis]
        )
      }

      if (!funcResult || funcResult.length === 0) {
        console.log(`[Webhook ControliD] Funcionário não encontrado: userId=${userId}, pis=${pis}`)
        return response.badRequest({ error: 'Funcionário não encontrado' })
      }

      const funcionarioId = funcResult[0].id

      // =========================================================================
      // ETAPA 9: Calcular ENTRADA/SAÍDA baseado nas batidas do dia
      // =========================================================================
      // Mesma lógica usada no terminal facial para consistência:
      // - 0 batidas → ENTRADA
      // - 1 batida → SAÍDA
      // - 2 batidas → ENTRADA
      // - etc (par=entrada, ímpar=saída)
      const hoje = dataHora.toISOString().split('T')[0]
      const batidasResult = await dbManager.queryMunicipio(
        municipioId,
        `SELECT COUNT(*) as total FROM registros_ponto
         WHERE funcionario_id = $1 AND DATE(data_hora) = $2`,
        [funcionarioId, hoje]
      )
      const totalBatidas = parseInt(batidasResult[0]?.total || '0')

      // Se veio evento do REP, usa ele. Senão, calcula.
      const sentido = sentidoDoEvento || (totalBatidas % 2 === 0 ? 'ENTRADA' : 'SAIDA')

      console.log(`[Webhook ControliD] Funcionário ${funcionarioId} - Batidas hoje: ${totalBatidas}, próximo: ${sentido}`)

      // =========================================================================
      // ETAPA 10: Buscar cooldown configurado
      // =========================================================================
      const cooldownConfig = await dbManager.queryMunicipio(
        municipioId,
        `SELECT valor FROM configuracoes_sistema WHERE chave = 'cooldown_terminal'`
      )
      const cooldownSegundos = parseInt(cooldownConfig[0]?.valor || '60')

      // =========================================================================
      // ETAPA 11: Verificar duplicidade (cooldown global)
      // =========================================================================
      // Ignora se já existe registro do mesmo funcionário dentro do cooldown
      // Isso evita duplicidade quando vem de múltiplas origens
      const dataHoraStr = dataHora.toISOString()
      const dupResult = await dbManager.queryMunicipio(
        municipioId,
        `SELECT id FROM registros_ponto
         WHERE funcionario_id = $1
         AND data_hora BETWEEN ($2::TIMESTAMP - INTERVAL '${cooldownSegundos} seconds') AND ($2::TIMESTAMP + INTERVAL '${cooldownSegundos} seconds')
         LIMIT 1`,
        [funcionarioId, dataHoraStr]
      )

      if (dupResult.length > 0) {
        console.log(`[Webhook ControliD] Registro duplicado ignorado (cooldown ${cooldownSegundos}s)`)
        return response.ok({ success: true, message: 'Registro duplicado ignorado' })
      }

      // =========================================================================
      // ETAPA 12: Gerar NSR (Número Sequencial de Registro)
      // =========================================================================
      // O NSR é obrigatório pela Portaria 671/2021
      // Pegamos o maior NSR existente e incrementamos
      const nsrResult = await dbManager.queryMunicipio(
        municipioId,
        `SELECT COALESCE(MAX(nsr), 0) + 1 as next_nsr FROM registros_ponto WHERE nsr IS NOT NULL`
      )
      const nsr = String(nsrResult[0]?.next_nsr || 1).padStart(9, '0')

      // =========================================================================
      // ETAPA 13: Inserir registro no banco
      // =========================================================================
      await dbManager.queryMunicipio(
        municipioId,
        `INSERT INTO registros_ponto
         (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem, created_at)
         VALUES ($1, $2, $3, 'BIOMETRIA', $4, $5, $6, 'EQUIPAMENTO', NOW())`,
        [funcionarioId, equipamentoId, dataHoraStr, sentido, nsr, pis || '']
      )

      // =========================================================================
      // ETAPA 13: Atualizar status do equipamento
      // =========================================================================
      // Marca o equipamento como ONLINE e atualiza última comunicação
      await dbManager.queryMunicipio(
        municipioId,
        `UPDATE equipamentos SET ultima_comunicacao = NOW(), status = 'ONLINE' WHERE id = $1`,
        [equipamentoId]
      )

      // =========================================================================
      // ETAPA 14: Buscar nome do funcionário para WebSocket
      // =========================================================================
      const funcNomeResult = await dbManager.queryMunicipio(
        municipioId,
        `SELECT nome FROM funcionarios WHERE id = $1`,
        [funcionarioId]
      )
      const funcionarioNome = funcNomeResult[0]?.nome || 'Funcionário'

      // =========================================================================
      // ETAPA 15: Emitir evento WebSocket
      // =========================================================================
      // Notifica todos os clientes conectados sobre a nova batida
      // Isso atualiza as páginas /ponto e /dashboard em tempo real
      websocketService.emitNovaBatida(municipioId, {
        funcionario_id: funcionarioId,
        funcionario_nome: funcionarioNome,
        data_hora: dataHoraStr,
        sentido: sentido,
        origem: 'EQUIPAMENTO'
      })

      // =========================================================================
      // ETAPA 16: Responder sucesso
      // =========================================================================
      console.log(`[Webhook ControliD] ✅ Registro salvo: func=${funcionarioId}, equip=${equipamentoId}, ${sentido}`)
      return response.ok({ success: true, message: 'Registro salvo', sentido })

    } catch (error: any) {
      // =========================================================================
      // TRATAMENTO DE ERROS
      // =========================================================================
      console.error('[Webhook ControliD] Erro:', error.message)
      return response.internalServerError({ error: error.message })
    }
  }

  /**
   * Health check para o REP testar conexão
   *
   * O REP pode chamar este endpoint (GET) para verificar se o
   * servidor está online antes de enviar batidas.
   *
   * @param response - Objeto de resposta HTTP
   * @returns JSON com status do serviço
   *
   * @example
   * ```bash
   * curl http://localhost:3333/api/webhook/controlid
   * # { "status": "online", "service": "...", "timestamp": "..." }
   * ```
   */
  async health({ response }: HttpContext) {
    return response.ok({
      status: 'online',
      service: 'Ponto Eletrônico - Webhook Control iD',
      timestamp: new Date().toISOString()
    })
  }
}
