import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class ControleController {
  private schema(session: any) {
    return `camara_${session.get('municipioId')}`
  }

  async index({ session, view }: HttpContext) {
    const s = this.schema(session)
    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').orderBy('created_at', 'desc').first()
    const totalSessoes = await db.from(`${s}.sessoes`).count('* as total').first()
    const totalVereadores = await db.from(`${s}.vereadores`).where('ativo', true).count('* as total').first()

    return view.render('pages/votacao/controle', {
      sessaoMunicipioId: session.get('municipioId'),
      sessao,
      totalSessoes: (totalSessoes as any)?.total || 0,
      totalVereadores: (totalVereadores as any)?.total || 0,
    })
  }

  async sessoes({ session, view }: HttpContext) {
    const s = this.schema(session)
    const sessoes = await db.from(`${s}.sessoes`).orderBy('data_sessao', 'desc').limit(50)
    return view.render('pages/votacao/controle', { sessoes, secao: 'sessoes' })
  }

  async storeSessao({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['tipo', 'descricao', 'local', 'data_sessao', 'legislatura_id'])
    const [sessao] = await db.table(`${s}.sessoes`).insert({ ...data, status: 'agendada' }).returning('*')
    return response.json({ success: true, sessao })
  }

  async iniciarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'em_andamento', iniciada_em: new Date() })
    return response.json({ success: true })
  }

  async encerrarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'encerrada', encerrada_em: new Date() })
    return response.json({ success: true })
  }

  async materias({ session, view }: HttpContext) {
    const s = this.schema(session)
    const materias = await db.from(`${s}.materias`).orderBy('created_at', 'desc').limit(50)
    return view.render('pages/votacao/controle', { materias, secao: 'materias' })
  }

  async storemateria({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['sessao_id', 'tipo', 'numero', 'ementa', 'autor'])
    const [materia] = await db.table(`${s}.materias`).insert({ ...data, status: 'pendente' }).returning('*')
    return response.json({ success: true, materia })
  }

  async iniciarVotacao({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { materia_id, sessao_id, tipo_votacao } = request.only(['materia_id', 'sessao_id', 'tipo_votacao'])
    const [votacao] = await db.table(`${s}.votacoes`).insert({
      materia_id, sessao_id,
      tipo: tipo_votacao || 'nominal',
      status: 'em_andamento',
      iniciada_em: new Date(),
    }).returning('*')
    return response.json({ success: true, votacao })
  }

  async encerrarVotacao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    const votos = await db.from(`${s}.votos`).where('votacao_id', params.id)
    const sim = votos.filter((v: any) => v.voto === 'sim').length
    const nao = votos.filter((v: any) => v.voto === 'nao').length
    const abstencao = votos.filter((v: any) => v.voto === 'abstencao').length
    const aprovada = sim > nao
    await db.from(`${s}.votacoes`).where('id', params.id).update({
      status: 'encerrada', encerrada_em: new Date(),
      votos_sim: sim, votos_nao: nao, votos_abstencao: abstencao, aprovada,
    })
    return response.json({ success: true, resultado: { sim, nao, abstencao, aprovada } })
  }

  async vereadores({ session, view }: HttpContext) {
    const s = this.schema(session)
    const vereadores = await db.from(`${s}.vereadores`).where('ativo', true).orderBy('nome')
    return view.render('pages/votacao/controle', { vereadores, secao: 'vereadores' })
  }

  async pedirVoz({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { vereador_id, sessao_id } = request.only(['vereador_id', 'sessao_id'])
    await db.table(`${s}.tempo_fala`).insert({ vereador_id, sessao_id, status: 'aguardando' })
    return response.json({ success: true })
  }

  async concederVoz({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status: 'em_andamento', iniciado_em: new Date() })
    return response.json({ success: true })
  }

  async encerrarVoz({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status: 'encerrado', encerrado_em: new Date() })
    return response.json({ success: true })
  }

  async quorum({ session, view }: HttpContext) {
    const s = this.schema(session)
    const presencas = await db.from(`${s}.presencas`).join(`${s}.vereadores`, `${s}.vereadores.id`, `${s}.presencas.vereador_id`).select(`${s}.presencas.*`, `${s}.vereadores.nome_parlamentar`)
    return view.render('pages/votacao/controle', { presencas, secao: 'quorum' })
  }

  async registrarPresenca({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { vereador_id, sessao_id } = request.only(['vereador_id', 'sessao_id'])
    await db.table(`${s}.presencas`).insert({ vereador_id, sessao_id, presente: true, chegada_em: new Date() })
    return response.json({ success: true })
  }
}
