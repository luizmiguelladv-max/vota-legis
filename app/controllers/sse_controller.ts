import type { HttpContext } from '@adonisjs/core/http'
import sseService from '#services/sse_service'

export default class SSEController {
  /**
   * Conexão SSE para sessão (autenticado)
   */
  async sessao({ params, response, tenant, auth }: HttpContext) {
    const { sessaoId } = params
    const user = auth.user

    // Configura SSE
    response.response.setHeader('Content-Type', 'text/event-stream')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Connection', 'keep-alive')
    response.response.setHeader('X-Accel-Buffering', 'no')

    // Registra cliente
    const clientId = sseService.addClient(
      response,
      tenant!.municipioId,
      parseInt(sessaoId),
      'vereador',
      user?.id
    )

    // Quando conexão fecha
    response.response.on('close', () => {
      sseService.removeClient(clientId)
    })

    // Mantém conexão aberta (não retorna)
    return new Promise(() => {})
  }

  /**
   * Conexão SSE para controle (operador)
   */
  async controle({ params, response, tenant, auth }: HttpContext) {
    const { sessaoId } = params

    response.response.setHeader('Content-Type', 'text/event-stream')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Connection', 'keep-alive')
    response.response.setHeader('X-Accel-Buffering', 'no')

    const clientId = sseService.addClient(
      response,
      tenant!.municipioId,
      parseInt(sessaoId),
      'controle',
      auth.user?.id
    )

    response.response.on('close', () => {
      sseService.removeClient(clientId)
    })

    return new Promise(() => {})
  }

  /**
   * Conexão SSE para painel público (TV)
   */
  async painel({ params, response }: HttpContext) {
    const { codigo, sessaoId } = params

    // Busca município
    const db = (await import('@adonisjs/lucid/services/db')).default
    const municipio = await db.rawQuery(`
      SELECT id FROM municipios WHERE codigo = $1 OR slug = $1 AND ativo = true
    `, [codigo])

    if (municipio.rows.length === 0) {
      return response.status(404).json({ error: 'Câmara não encontrada' })
    }

    response.response.setHeader('Content-Type', 'text/event-stream')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Connection', 'keep-alive')
    response.response.setHeader('X-Accel-Buffering', 'no')

    const clientId = sseService.addClient(
      response,
      municipio.rows[0].id,
      parseInt(sessaoId),
      'painel'
    )

    response.response.on('close', () => {
      sseService.removeClient(clientId)
    })

    return new Promise(() => {})
  }

  /**
   * Conexão SSE para presidente
   */
  async presidente({ params, response, tenant, auth }: HttpContext) {
    const { sessaoId } = params

    response.response.setHeader('Content-Type', 'text/event-stream')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Connection', 'keep-alive')
    response.response.setHeader('X-Accel-Buffering', 'no')

    const clientId = sseService.addClient(
      response,
      tenant!.municipioId,
      parseInt(sessaoId),
      'presidente',
      auth.user?.id
    )

    response.response.on('close', () => {
      sseService.removeClient(clientId)
    })

    return new Promise(() => {})
  }

  /**
   * Estatísticas de conexões (admin)
   */
  async stats({ response }: HttpContext) {
    return response.json(sseService.getStats())
  }
}
