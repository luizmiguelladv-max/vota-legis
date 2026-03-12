import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Municipio from '#models/municipio'

export default class PainelController {
  async show({ params, view, response }: HttpContext) {
    const municipio = await Municipio.findBy('slug', params.slug)
    if (!municipio) return response.notFound({ error: 'Câmara não encontrada' })

    const s = `camara_${municipio.id}`

    // Sessão em andamento
    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()

    // Configurações da câmara
    const configuracoes = await db.from(`${s}.configuracoes`).first()

    // Vereadores ativos com partido
    const vereadores = await db
      .from(`${s}.vereadores as v`)
      .leftJoin(`${s}.partidos as p`, 'p.id', 'v.partido_id')
      .where('v.ativo', true)
      .orderBy('v.cargo', 'asc')
      .orderBy('v.nome_parlamentar', 'asc')
      .select('v.*', 'p.sigla as partido_sigla')

    // Votação ativa (se houver sessão)
    let votacaoAtiva = null
    let presencasIds: number[] = []
    let presentes = 0

    if (sessao) {
      votacaoAtiva = await db
        .from(`${s}.votacoes as vt`)
        .leftJoin(`${s}.materias as m`, 'm.id', 'vt.materia_id')
        .where('vt.status', 'em_andamento')
        .select('vt.*', 'm.ementa', 'm.tipo as materia_tipo')
        .first()

      const presencas = await db
        .from(`${s}.presencas`)
        .where('sessao_id', sessao.id)
        .where('presente', true)
        .select('vereador_id')

      presencasIds = presencas.map((p: any) => p.vereador_id)
      presentes = presencasIds.length
    }

    return view.render('pages/votacao/painel', {
      municipio,
      configuracoes,
      sessao,
      vereadores,
      votacaoAtiva,
      presencasIds,
      presentes,
    })
  }
}
