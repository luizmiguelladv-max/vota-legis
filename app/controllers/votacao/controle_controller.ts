import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class ControleController {
  private schema(session: any) {
    return `camara_${session.get('municipio_id')}`
  }

  async index({ session, view }: HttpContext) {
    const s = this.schema(session)
    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').orderBy('created_at', 'desc').first()
    const totalSessoes = await db.from(`${s}.sessoes`).count('* as total').first()
    const totalVereadores = await db.from(`${s}.vereadores`).where('ativo', true).count('* as total').first()

    return view.render('pages/votacao/controle', {
      sessao,
      totalSessoes: (totalSessoes as any)?.total || 0,
      totalVereadores: (totalVereadores as any)?.total || 0,
    })
  }

  // ── SESSÕES ──────────────────────────────────────────────

  async sessoes({ session, view }: HttpContext) {
    const s = this.schema(session)
    const sessoes = await db.from(`${s}.sessoes`).orderBy('data_sessao', 'desc').limit(50)
    return view.render('pages/votacao/controle', { sessoes, secao: 'sessoes' })
  }

  async storeSessao({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['numero','tipo','data_sessao','hora_inicio','descricao','legislatura_id'])
    const [id] = await db.table(`${s}.sessoes`).insert({ ...dados, status: 'planejada' }).returning('id')
    return response.json({ success: true, id })
  }

  async showSessao({ params, session, view }: HttpContext) {
    const s = this.schema(session)
    const sessao = await db.from(`${s}.sessoes`).where('id', params.id).first()
    const materias = await db.from(`${s}.materias`).where('sessao_id', params.id).orderBy('ordem', 'asc')
    const presencas = await db.from(`${s}.presencas`).where('sessao_id', params.id)
    return view.render('pages/votacao/controle', { sessao, materias, presencas, secao: 'sessao-detalhe' })
  }

  async updateSessao({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['numero','tipo','data_sessao','hora_inicio','descricao'])
    await db.from(`${s}.sessoes`).where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroySessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).where('status', 'planejada').delete()
    return response.json({ success: true })
  }

  async iniciarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({
      status: 'em_andamento',
      iniciada_em: new Date(),
    })
    return response.json({ success: true })
  }

  async encerrarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({
      status: 'encerrada',
      encerrada_em: new Date(),
    })
    return response.json({ success: true })
  }

  async suspenderSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'suspensa' })
    return response.json({ success: true })
  }

  // ── MATÉRIAS ─────────────────────────────────────────────

  async materias({ session, view }: HttpContext) {
    const s = this.schema(session)
    const materias = await db.from(`${s}.materias`).orderBy('created_at', 'desc').limit(50)
    return view.render('pages/votacao/controle', { materias, secao: 'materias' })
  }

  async storemateria({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['sessao_id','tipo','numero','ementa','autor_id','pdf_url','ordem'])
    const [id] = await db.table(`${s}.materias`).insert({ ...dados, status: 'pendente' }).returning('id')
    return response.json({ success: true, id })
  }

  async updateMateria({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['tipo','numero','ementa','pdf_url','ordem'])
    await db.from(`${s}.materias`).where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroyMateria({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).where('status', 'pendente').delete()
    return response.json({ success: true })
  }

  async iniciarLeitura({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'em_leitura', leitura_iniciada_em: new Date() })
    return response.json({ success: true })
  }

  async encerrarLeitura({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'pendente_votacao', leitura_encerrada_em: new Date() })
    return response.json({ success: true })
  }

  async abrirVotacao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'em_votacao' })
    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    const [id] = await db.table(`${s}.votacoes`).insert({
      materia_id: params.id,
      sessao_id: sessao?.id,
      status: 'aberta',
      aberta_em: new Date(),
    }).returning('id')
    return response.json({ success: true, votacao_id: id })
  }

  async encerrarVotacao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    const votacao = await db.from(`${s}.votacoes`).where('materia_id', params.id).where('status', 'aberta').first()
    if (!votacao) return response.badRequest({ error: 'Votação não encontrada' })

    // Contagem
    const votos = await db
      .from(`${s}.votos`)
      .where('votacao_id', votacao.id)
      .select('opcao', db.raw('count(*) as total'))
      .groupBy('opcao')

    const favor     = Number(votos.find((v: any) => v.opcao === 'favor')?.total || 0)
    const contra    = Number(votos.find((v: any) => v.opcao === 'contra')?.total || 0)
    const resultado = favor > contra ? 'aprovada' : favor < contra ? 'rejeitada' : 'empate'

    await db.from(`${s}.votacoes`).where('id', votacao.id).update({ status: 'encerrada', resultado, encerrada_em: new Date() })
    await db.from(`${s}.materias`).where('id', params.id).update({ status: resultado })

    return response.json({ success: true, resultado, favor, contra })
  }

  // ── VOZ / TIMER ──────────────────────────────────────────

  async concederVoz({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status: 'falando', iniciado_em: new Date() })
    return response.json({ success: true })
  }

  async cancelarVozControle({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status: 'cancelado' })
    return response.json({ success: true })
  }

  async setTimer({ request, session, response }: HttpContext) {
    const { fala_id, segundos } = request.only(['fala_id', 'segundos'])
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', fala_id).update({ duracao_segundos: segundos })
    return response.json({ success: true })
  }

  // ── VEREADORES ───────────────────────────────────────────

  async vereadores({ session, view }: HttpContext) {
    const s = this.schema(session)
    const vereadores = await db.from(`${s}.vereadores`).orderBy('nome', 'asc')
    return view.render('pages/votacao/controle', { vereadores, secao: 'vereadores' })
  }

  async storeVereador({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['nome','nome_parlamentar','partido_id','cargo','foto_url','email','whatsapp'])
    const [id] = await db.table(`${s}.vereadores`).insert({ ...dados, ativo: true }).returning('id')
    return response.json({ success: true, id })
  }

  async updateVereador({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['nome','nome_parlamentar','partido_id','cargo','foto_url','email','whatsapp','ativo'])
    await db.from(`${s}.vereadores`).where('id', params.id).update(dados)
    return response.json({ success: true })
  }

  async destroyVereador({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.vereadores`).where('id', params.id).update({ ativo: false })
    return response.json({ success: true })
  }

  // ── CONFIGURAÇÕES ────────────────────────────────────────

  async configuracoes({ session, view }: HttpContext) {
    const s = this.schema(session)
    const conf = await db.from(`${s}.configuracoes`).first()
    return view.render('pages/votacao/controle', { configuracoes: conf, secao: 'configuracoes' })
  }

  async updateConfiguracoes({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['nome_camara','nome_municipio','quorum_minimo','tempo_fala_padrao','votacao_secreta_padrao'])
    await db.from(`${s}.configuracoes`).update(dados)
    return response.json({ success: true })
  }

  async updateTema({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const dados = request.only(['cor_primaria','logo_url','brasao_url'])
    await db.from(`${s}.configuracoes`).update(dados)
    return response.json({ success: true })
  }

  // ── RELATÓRIOS ───────────────────────────────────────────

  async relatorios({ session, view }: HttpContext) {
    const s = this.schema(session)
    const sessoes = await db.from(`${s}.sessoes`).where('status', 'encerrada').orderBy('data_sessao', 'desc').limit(20)
    return view.render('pages/votacao/controle', { sessoes, secao: 'relatorios' })
  }

  async relatorioSessao({ params, session, view }: HttpContext) {
    const s = this.schema(session)
    const sessao   = await db.from(`${s}.sessoes`).where('id', params.id).first()
    const materias = await db.from(`${s}.materias`).where('sessao_id', params.id).orderBy('ordem')
    const presencas = await db.from(`${s}.presencas`).where('sessao_id', params.id)
    return view.render('pages/votacao/controle', { sessao, materias, presencas, secao: 'relatorio-sessao' })
  }

  async exportarRelatorio({ params, session, response }: HttpContext) {
    // TODO: gerar PDF com puppeteer ou similar
    return response.json({ message: 'Exportação em implementação', sessao_id: params.id })
  }

  async events({ params, response }: HttpContext) {
    response.header('Content-Type', 'text/event-stream')
    response.header('Cache-Control', 'no-cache')
    response.header('Connection', 'keep-alive')
    const data = JSON.stringify({ type: 'connected', sessaoId: params.sessaoId })
    response.response.write(`data: ${data}\n\n`)
  }
}
