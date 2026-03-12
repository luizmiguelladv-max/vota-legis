import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PainelController {
  async show({ params, view }: HttpContext) {
    const municipio = await db.from('municipios').where('slug', params.slug).firstOrFail() as any
    const s = `camara_${municipio.id}`
    const legislatura = await db.from(`${s}.legislaturas`).where('ativa', true).first()
    const sessao = await db.from(`${s}.sessoes`).where('status','em_andamento').orderBy('created_at','desc').first() as any
    const totalVereadores = await db.from(`${s}.vereadores`).where('ativo',true).count('* as total').first().then(r => Number((r as any)?.total ?? 0))
    const vereadores = await db.from(`${s}.vereadores`).join(`${s}.partidos`,`${s}.partidos.id`,`${s}.vereadores.partido_id`).select(`${s}.vereadores.*`,`${s}.partidos.sigla as partido_sigla`,`${s}.partidos.cor as partido_cor`).where(`${s}.vereadores.ativo`,true).orderBy(`${s}.vereadores.nome_parlamentar`)

    let presentes = 0, materiasPendentes: any[] = [], votacaoAtiva = null, falando = null

    if (sessao) {
      const presencas = await db.from(`${s}.presencas`).where('sessao_id', sessao.id).where('presente', true)
      presentes = (presencas as any[]).length
      const presencasIds = new Set((presencas as any[]).map((p: any) => p.vereador_id))
      for (const v of vereadores as any[]) { v.presente = presencasIds.has(v.id) }

      materiasPendentes = await db.from(`${s}.materias`).where('sessao_id', sessao.id).orderBy('ordem','asc').orderBy('created_at','asc')
      votacaoAtiva = await db.from(`${s}.votacoes as vo`)
        .join(`${s}.materias as m`, 'm.id', 'vo.materia_id')
        .select('vo.*', 'm.titulo', 'm.ementa', 'm.tipo')
        .where('vo.sessao_id', sessao.id).where('vo.status','em_andamento').first()
      falando = await db.from(`${s}.tempo_fala`).join(`${s}.vereadores`,`${s}.vereadores.id`,`${s}.tempo_fala.vereador_id`).select(`${s}.tempo_fala.*`,`${s}.vereadores.nome_parlamentar`,`${s}.vereadores.cargo`).where(`${s}.tempo_fala.sessao_id`, sessao.id).where(`${s}.tempo_fala.status`,'em_andamento').first()
    }

    return view.render('pages/votacao/painel', { municipio, legislatura, sessao, vereadores, totalVereadores, presentes, materiasPendentes, votacaoAtiva, falando })
  }

  async events({ params, response }: HttpContext) {
    const municipio = await db.from('municipios').where('slug', params.slug).first() as any
    if (!municipio) return response.json({})
    const s = `camara_${municipio.id}`
    const sessao = await db.from(`${s}.sessoes`).where('status','em_andamento').first() as any
    if (!sessao) return response.json({ sessao: null })
    const presentes = await db.from(`${s}.presencas`).where('sessao_id', sessao.id).where('presente',true).count('* as total').first().then(r => Number((r as any)?.total ?? 0))
    const votacao = await db.from(`${s}.votacoes as vo`).join(`${s}.materias as m`,'m.id','vo.materia_id').select('vo.*','m.titulo','m.ementa').where('vo.sessao_id', sessao.id).where('vo.status','em_andamento').first()
    return response.json({ sessao, presentes, votacao, ts: Date.now() })
  }
}
