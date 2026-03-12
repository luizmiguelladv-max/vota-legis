import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PainelController {
  async show({ params, view, response }: HttpContext) {
    const slug = params.slug

    // Busca município pelo slug
    const municipio = await db
      .from('public.municipios')
      .where('slug', slug)
      .first()

    if (!municipio) {
      return response.notFound({ error: 'Câmara não encontrada' })
    }

    // Busca sessão em andamento no schema da câmara
    const schema = `camara_${municipio.id}`
    const sessao = await db
      .from(`${schema}.sessoes`)
      .where('status', 'em_andamento')
      .orderBy('created_at', 'desc')
      .first()

    const configuracoes = await db
      .from(`${schema}.configuracoes`)
      .first()

    return view.render('pages/votacao/painel', {
      municipio,
      sessao,
      configuracoes,
    })
  }

  async events({ params, response }: HttpContext) {
    // SSE — será implementado com @adonisjs/transmit
    response.header('Content-Type', 'text/event-stream')
    response.header('Cache-Control', 'no-cache')
    response.header('Connection', 'keep-alive')

    const data = JSON.stringify({ type: 'connected', slug: params.slug })
    response.response.write(`data: ${data}\n\n`)
  }
}
