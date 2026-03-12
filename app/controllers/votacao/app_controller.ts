import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class AppController {
  private schema(session: any) { return `camara_${session.get('municipioId')}` }

  async index({ session, view }: HttpContext) {
    const s = this.schema(session)
    const mid = session.get('municipioId')
    const uid = session.get('userId')

    const [municipio, sessao, vereador] = await Promise.all([
      db.from('municipios').where('id', mid).first(),
      db.from(`${s}.sessoes`).where('status','em_andamento').orderBy('created_at','desc').first(),
      db.from(`${s}.vereadores`).join(`${s}.partidos`,`${s}.partidos.id`,`${s}.vereadores.partido_id`).select(`${s}.vereadores.*`,`${s}.partidos.sigla as partido_sigla`,`${s}.partidos.cor as partido_cor`).where(`${s}.vereadores.usuario_id`, uid).first(),
    ])

    let presente = false, votacaoAtiva = null, meuVoto = null, inscrito = null, materias: any[] = []

    if (sessao && vereador) {
      const presenca = await db.from(`${s}.presencas`).where({ vereador_id: (vereador as any).id, sessao_id: (sessao as any).id }).first()
      presente = !!(presenca as any)?.presente

      votacaoAtiva = await db.from(`${s}.votacoes as vo`).join(`${s}.materias as m`,'m.id','vo.materia_id').select('vo.*','m.titulo','m.ementa','m.tipo').where('vo.sessao_id',(sessao as any).id).where('vo.status','em_andamento').first()
      if (votacaoAtiva) {
        const voto = await db.from(`${s}.votos`).where({ votacao_id: (votacaoAtiva as any).id, vereador_id: (vereador as any).id }).first()
        meuVoto = (voto as any)?.voto || null
      }

      inscrito = await db.from(`${s}.tempo_fala`).where({ vereador_id: (vereador as any).id, sessao_id: (sessao as any).id }).whereIn('status',['aguardando','em_andamento']).first()
      materias = await db.from(`${s}.materias`).where('sessao_id', (sessao as any).id).orderBy('ordem','asc').orderBy('created_at','asc')
    }

    return view.render('pages/votacao/app', { municipio, sessao, vereador, presente, votacaoAtiva, meuVoto, inscrito, materias })
  }

  async confirmarPresenca({ session, request, response }: HttpContext) {
    const s = this.schema(session)
    const uid = session.get('userId')
    const { sessao_id } = request.only(['sessao_id'])
    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', uid).first() as any
    if (!vereador) return response.status(400).json({ error: 'Vereador não encontrado' })
    const existe = await db.from(`${s}.presencas`).where({ vereador_id: vereador.id, sessao_id }).first()
    if (existe) { await db.from(`${s}.presencas`).where({ vereador_id: vereador.id, sessao_id }).update({ presente: true }) }
    else { await db.table(`${s}.presencas`).insert({ vereador_id: vereador.id, sessao_id, presente: true, chegada_em: new Date() }) }
    return response.json({ success: true })
  }

  async votar({ session, request, response }: HttpContext) {
    const s = this.schema(session)
    const uid = session.get('userId')
    const { voto } = request.only(['voto'])
    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', uid).first() as any
    if (!vereador) return response.status(400).json({ error: 'Vereador não encontrado' })
    const sessao = await db.from(`${s}.sessoes`).where('status','em_andamento').first() as any
    if (!sessao) return response.status(400).json({ error: 'Sem sessão ativa' })
    const votacao = await db.from(`${s}.votacoes`).where('sessao_id', sessao.id).where('status','em_andamento').first() as any
    if (!votacao) return response.status(400).json({ error: 'Sem votação ativa' })
    if (votacao.tipo === 'secreta') return response.status(400).json({ error: 'Votação secreta — use o sistema físico' })
    const existe = await db.from(`${s}.votos`).where({ votacao_id: votacao.id, vereador_id: vereador.id }).first()
    if (existe) return response.status(400).json({ error: 'Voto já registrado' })
    await db.table(`${s}.votos`).insert({ votacao_id: votacao.id, vereador_id: vereador.id, sessao_id: sessao.id, voto, votado_em: new Date() })
    return response.json({ success: true })
  }

  async pedirVoz({ session, request, response }: HttpContext) {
    const s = this.schema(session)
    const uid = session.get('userId')
    const { sessao_id, tempo_minutos } = request.only(['sessao_id','tempo_minutos'])
    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', uid).first() as any
    if (!vereador) return response.status(400).json({ error: 'Vereador não encontrado' })
    await db.table(`${s}.tempo_fala`).insert({ vereador_id: vereador.id, sessao_id, tempo_minutos: tempo_minutos||3, status: 'aguardando' })
    return response.json({ success: true })
  }

  async cancelarVoz({ session, request, response }: HttpContext) {
    const s = this.schema(session)
    const uid = session.get('userId')
    const { sessao_id } = request.only(['sessao_id'])
    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', uid).first() as any
    if (!vereador) return response.status(400).json({ error: 'Vereador não encontrado' })
    await db.from(`${s}.tempo_fala`).where({ vereador_id: vereador.id, sessao_id }).whereIn('status',['aguardando']).update({ status: 'cancelado' })
    return response.json({ success: true })
  }

  async events({ params, session, response }: HttpContext) {
    return response.json({ ts: Date.now() })
  }
}
