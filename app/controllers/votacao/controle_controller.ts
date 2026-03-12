import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class ControleController {
  private schema(session: any) {
    const mid = session.get('municipioId')
    return `camara_${mid}`
  }

  private async baseData(session: any) {
    const mid = session.get('municipioId')
    const s = `camara_${mid}`
    const [municipio, totalSessoes, totalVereadores, totalMaterias] = await Promise.all([
      db.from('municipios').where('id', mid).first(),
      db.from(`${s}.sessoes`).count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
      db.from(`${s}.vereadores`).where('ativo', true).count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
      db.from(`${s}.materias`).whereIn('status',['aprovada','rejeitada']).count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
    ])
    return { municipio, totalSessoes, totalVereadores, totalMaterias }
  }

  async index({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [sessao, vereadores, proximasSessoes] = await Promise.all([
      db.from(`${s}.sessoes`).where('status', 'em_andamento').orderBy('created_at','desc').first(),
      db.from(`${s}.vereadores`).join(`${s}.partidos`,`${s}.partidos.id`,`${s}.vereadores.partido_id`).select(`${s}.vereadores.*`,`${s}.partidos.sigla as partido_sigla`,`${s}.partidos.cor as partido_cor`).where(`${s}.vereadores.ativo`,true).orderBy(`${s}.vereadores.nome_parlamentar`).limit(9),
      db.from(`${s}.sessoes`).whereIn('status',['agendada','em_andamento']).orderBy('data_sessao','asc').limit(5),
    ])
    return view.render('pages/votacao/controle/index', { ...base, sessao, vereadores, proximasSessoes })
  }

  async sessoes({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [sessoes, sessaoAtiva, contAgendadas, contEncerradas] = await Promise.all([
      db.from(`${s}.sessoes`).orderBy('data_sessao','desc').limit(100),
      db.from(`${s}.sessoes`).where('status','em_andamento').first(),
      db.from(`${s}.sessoes`).where('status','agendada').count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
      db.from(`${s}.sessoes`).where('status','encerrada').count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
    ])
    return view.render('pages/votacao/controle/sessoes', { ...base, sessoes, sessaoAtiva, contAgendadas, contEncerradas })
  }

  async showSessao({ params, session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [sessao, materias, vereadores, presencas] = await Promise.all([
      db.from(`${s}.sessoes`).where('id', params.id).firstOrFail(),
      db.from(`${s}.materias`).where('sessao_id', params.id).orderBy('ordem','asc').orderBy('created_at','asc'),
      db.from(`${s}.vereadores`).join(`${s}.partidos`,`${s}.partidos.id`,`${s}.vereadores.partido_id`).select(`${s}.vereadores.*`,`${s}.partidos.sigla as partido_sigla`,`${s}.partidos.cor as partido_cor`).where(`${s}.vereadores.ativo`,true).orderBy(`${s}.vereadores.nome_parlamentar`),
      db.from(`${s}.presencas`).where('sessao_id', params.id),
    ])
    const presencasMap: Record<number,string> = {}
    for (const p of presencas as any[]) presencasMap[p.vereador_id] = p.presente ? 'presente' : 'justificado'
    const presentes = Object.values(presencasMap).filter(v => v === 'presente').length
    const votacaoAtiva = await db.from(`${s}.votacoes`).where('sessao_id', params.id).where('status','em_andamento').first()
    const filaFala = await db.from(`${s}.tempo_fala`).join(`${s}.vereadores`,`${s}.vereadores.id`,`${s}.tempo_fala.vereador_id`).select(`${s}.tempo_fala.*`,`${s}.vereadores.nome_parlamentar`,`${s}.vereadores.cargo`).where(`${s}.tempo_fala.sessao_id`, params.id).where(`${s}.tempo_fala.status`,'aguardando').orderBy(`${s}.tempo_fala.created_at`)
    const falando = await db.from(`${s}.tempo_fala`).join(`${s}.vereadores`,`${s}.vereadores.id`,`${s}.tempo_fala.vereador_id`).select(`${s}.tempo_fala.*`,`${s}.vereadores.nome_parlamentar`,`${s}.vereadores.cargo`).where(`${s}.tempo_fala.sessao_id`, params.id).where(`${s}.tempo_fala.status`,'em_andamento').first()
    return view.render('pages/votacao/controle/sessao', { ...base, sessao, materias, vereadores, presencasMap, presentes, votacaoAtiva, filaFala, falando })
  }

  async storeSessao({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['tipo','descricao','local','data_sessao','hora_inicio','numero'])
    const [sessao] = await db.table(`${s}.sessoes`).insert({ ...data, status: 'agendada' }).returning('*')
    return response.json({ success: true, sessao })
  }

  async updateSessao({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['descricao','local','data_sessao','hora_inicio'])
    await db.from(`${s}.sessoes`).where('id', params.id).update(data)
    return response.json({ success: true })
  }

  async destroySessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).delete()
    return response.json({ success: true })
  }

  async iniciarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('status','em_andamento').update({ status: 'suspensa' })
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'em_andamento', iniciada_em: new Date() })
    return response.json({ success: true })
  }

  async encerrarSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'encerrada', encerrada_em: new Date() })
    return response.json({ success: true })
  }

  async suspenderSessao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.sessoes`).where('id', params.id).update({ status: 'suspensa' })
    return response.json({ success: true })
  }

  async vereadores({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [vereadores, partidos] = await Promise.all([
      db.from(`${s}.vereadores`).join(`${s}.partidos`,`${s}.partidos.id`,`${s}.vereadores.partido_id`).select(`${s}.vereadores.*`,`${s}.partidos.sigla as partido_sigla`,`${s}.partidos.cor as partido_cor`).where(`${s}.vereadores.ativo`,true).orderBy(`${s}.vereadores.nome_parlamentar`),
      db.from(`${s}.partidos`).orderBy('sigla'),
    ])
    return view.render('pages/votacao/controle/vereadores', { ...base, vereadores, partidos })
  }

  async storeVereador({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['nome','nome_parlamentar','cargo','partido_id','cpf','email'])
    const [v] = await db.table(`${s}.vereadores`).insert({ ...data, ativo: true }).returning('*')
    return response.json({ success: true, vereador: v })
  }

  async updateVereador({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['nome_parlamentar','cargo','partido_id'])
    await db.from(`${s}.vereadores`).where('id', params.id).update(data)
    return response.json({ success: true })
  }

  // Matérias
  async materias({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const materias = await db.from(`${s}.materias`).orderBy('created_at','desc').limit(50)
    return view.render('pages/votacao/controle/index', { ...base, materias })
  }

  async storemateria({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['sessao_id','tipo','numero','titulo','ementa','autores'])
    const [m] = await db.table(`${s}.materias`).insert({ sessao_id:data.sessao_id, tipo:data.tipo, numero:data.numero, titulo:data.titulo, ementa:data.ementa, status:'pendente' }).returning('*')
    return response.json({ success: true, materia: m })
  }

  async updateMateria({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['titulo','ementa','tipo','numero'])
    await db.from(`${s}.materias`).where('id', params.id).update(data)
    return response.json({ success: true })
  }

  async destroyMateria({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).delete()
    return response.json({ success: true })
  }

  async iniciarLeitura({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'em_leitura' })
    return response.json({ success: true })
  }

  async encerrarLeitura({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'pendente' })
    return response.json({ success: true })
  }

  async abrirVotacao({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { sessao_id, tipo_votacao } = request.only(['sessao_id','tipo_votacao'])
    await db.from(`${s}.votacoes`).where('sessao_id', sessao_id).where('status','em_andamento').update({ status: 'cancelada' })
    await db.from(`${s}.materias`).where('sessao_id', sessao_id).where('status','em_votacao').update({ status: 'pendente' })
    const [votacao] = await db.table(`${s}.votacoes`).insert({ materia_id:params.id, sessao_id, tipo:tipo_votacao||'nominal', status:'em_andamento', iniciada_em:new Date() }).returning('*')
    await db.from(`${s}.materias`).where('id', params.id).update({ status: 'em_votacao' })
    return response.json({ success: true, votacao })
  }

  async encerrarVotacao({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    const votacao = await db.from(`${s}.votacoes`).where('id', params.id).firstOrFail() as any
    const votos = await db.from(`${s}.votos`).where('votacao_id', params.id)
    const sim = (votos as any[]).filter(v => v.voto==='sim').length
    const nao = (votos as any[]).filter(v => v.voto==='nao').length
    const abstencao = (votos as any[]).filter(v => v.voto==='abstencao').length
    const aprovada = sim > nao
    await db.from(`${s}.votacoes`).where('id', params.id).update({ status:'encerrada', encerrada_em:new Date(), votos_sim:sim, votos_nao:nao, votos_abstencao:abstencao, aprovada })
    await db.from(`${s}.materias`).where('id', votacao.materia_id).update({ status: aprovada?'aprovada':'rejeitada', votos_sim:sim, votos_nao:nao, votos_abstencao:abstencao })
    return response.json({ success: true, resultado: { sim, nao, abstencao, aprovada } })
  }

  // Voz
  async concederVoz({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('status','em_andamento').whereNot('id',params.id).update({ status:'encerrado', encerrado_em:new Date() })
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status:'em_andamento', iniciado_em:new Date() })
    return response.json({ success: true })
  }

  async cancelarVozControle({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.tempo_fala`).where('id', params.id).update({ status:'cancelado' })
    return response.json({ success: true })
  }

  async setTimer({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { vereador_id, sessao_id, tempo_minutos } = request.only(['vereador_id','sessao_id','tempo_minutos'])
    await db.table(`${s}.tempo_fala`).insert({ vereador_id, sessao_id, tempo_minutos:tempo_minutos||3, status:'aguardando' })
    return response.json({ success: true })
  }

  // Quórum
  async quorum({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const presencas = await db.from(`${s}.presencas`).join(`${s}.vereadores`,`${s}.vereadores.id`,`${s}.presencas.vereador_id`).select(`${s}.presencas.*`,`${s}.vereadores.nome_parlamentar`)
    return view.render('pages/votacao/controle/index', { ...base, presencas })
  }

  async registrarPresenca({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { vereador_id, sessao_id, status } = request.only(['vereador_id','sessao_id','status'])
    const existe = await db.from(`${s}.presencas`).where({ vereador_id, sessao_id }).first()
    if (existe) {
      await db.from(`${s}.presencas`).where({ vereador_id, sessao_id }).update({ presente: status==='presente', chegada_em:new Date() })
    } else {
      await db.table(`${s}.presencas`).insert({ vereador_id, sessao_id, presente: status==='presente', chegada_em:new Date() })
    }
    return response.json({ success: true })
  }

  async events({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    const sessaoId = params.sessaoId
    response.header('Content-Type','text/event-stream')
    response.header('Cache-Control','no-cache')
    response.header('Connection','keep-alive')
    const votacao = await db.from(`${s}.votacoes`).where('sessao_id',sessaoId).where('status','em_andamento').first()
    const data = { votacao, ts: Date.now() }
    response.response.write(`data: ${JSON.stringify(data)}\n\n`)
    response.response.end()
  }

  // ===========================================================================
  // PARTIDOS
  // ===========================================================================

  async partidos({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const partidos = await db.from(`${s}.partidos`).orderBy('sigla')
    return view.render('pages/votacao/controle/partidos', { ...base, partidos })
  }

  async storePartido({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['sigla', 'nome', 'cor'])
    const [p] = await db.table(`${s}.partidos`).insert(data).returning('*')
    return response.json({ success: true, partido: p })
  }

  async updatePartido({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['sigla', 'nome', 'cor'])
    await db.from(`${s}.partidos`).where('id', params.id).update(data)
    return response.json({ success: true })
  }

  async destroyPartido({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.partidos`).where('id', params.id).delete()
    return response.json({ success: true })
  }

  // ===========================================================================
  // LEGISLATURAS
  // ===========================================================================

  async legislaturas({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const legislaturas = await db.from(`${s}.legislaturas`).orderBy('ano_inicio', 'desc')
    return view.render('pages/votacao/controle/legislaturas', { ...base, legislaturas })
  }

  async storeLegislatura({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['numero', 'ano_inicio', 'ano_fim', 'ativa'])
    if (data.ativa) {
      await db.from(`${s}.legislaturas`).update({ ativa: false })
    }
    const [l] = await db.table(`${s}.legislaturas`).insert({ ...data, ativa: data.ativa ?? false }).returning('*')
    return response.json({ success: true, legislatura: l })
  }

  async updateLegislatura({ params, request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only(['numero', 'ano_inicio', 'ano_fim', 'ativa'])
    if (data.ativa) {
      await db.from(`${s}.legislaturas`).whereNot('id', params.id).update({ ativa: false })
    }
    await db.from(`${s}.legislaturas`).where('id', params.id).update(data)
    return response.json({ success: true })
  }

  // ===========================================================================
  // CONFIGURAÇÕES
  // ===========================================================================

  async configuracoes({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const conf = await db.from(`${s}.configuracoes`).first()
    return view.render('pages/votacao/controle/configuracoes', { ...base, conf })
  }

  async updateConfiguracoes({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const data = request.only([
      'nome_camara', 'nome_municipio', 'cor_primaria',
      'quorum_minimo', 'tempo_fala_padrao', 'votacao_secreta_padrao', 'exibir_foto_quorum',
    ])
    const existe = await db.from(`${s}.configuracoes`).first()
    if (existe) {
      await db.from(`${s}.configuracoes`).where('id', existe.id).update(data)
    } else {
      await db.table(`${s}.configuracoes`).insert(data)
    }
    return response.json({ success: true })
  }

  async updateTema({ request, session, response }: HttpContext) {
    const s = this.schema(session)
    const { cor_primaria } = request.only(['cor_primaria'])
    const existe = await db.from(`${s}.configuracoes`).first()
    if (existe) {
      await db.from(`${s}.configuracoes`).where('id', existe.id).update({ cor_primaria })
    }
    return response.json({ success: true })
  }

  // ===========================================================================
  // RELATÓRIOS
  // ===========================================================================

  async relatorios({ session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [ultimasSessoes, totalVotacoes] = await Promise.all([
      db.from(`${s}.sessoes`).orderBy('data_sessao', 'desc').limit(10),
      db.from(`${s}.votacoes`).count('* as total').first().then(r => Number((r as any)?.total ?? 0)),
    ])
    return view.render('pages/votacao/controle/relatorios', { ...base, ultimasSessoes, totalVotacoes })
  }

  async relatorioSessao({ params, session, view }: HttpContext) {
    const s = this.schema(session)
    const base = await this.baseData(session)
    const [sessao, materias, presencas, votacoes] = await Promise.all([
      db.from(`${s}.sessoes`).where('id', params.id).firstOrFail(),
      db.from(`${s}.materias`).where('sessao_id', params.id).orderBy('ordem', 'asc'),
      db.from(`${s}.presencas`).join(`${s}.vereadores`, `${s}.vereadores.id`, `${s}.presencas.vereador_id`)
        .select(`${s}.presencas.*`, `${s}.vereadores.nome_parlamentar`)
        .where(`${s}.presencas.sessao_id`, params.id),
      db.from(`${s}.votacoes`).where('sessao_id', params.id).orderBy('iniciada_em', 'asc'),
    ])
    return view.render('pages/votacao/controle/relatorio-sessao', { ...base, sessao, materias, presencas, votacoes })
  }

  async exportarRelatorio({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    const sessao = await db.from(`${s}.sessoes`).where('id', params.id).first() as any
    const materias = await db.from(`${s}.materias`).where('sessao_id', params.id).orderBy('ordem', 'asc')
    return response.json({ sessao, materias })
  }

  // ===========================================================================
  // DESTRUIÇÃO DE VEREADOR
  // ===========================================================================

  async destroyVereador({ params, session, response }: HttpContext) {
    const s = this.schema(session)
    await db.from(`${s}.vereadores`).where('id', params.id).update({ ativo: false })
    return response.json({ success: true })
  }
}
