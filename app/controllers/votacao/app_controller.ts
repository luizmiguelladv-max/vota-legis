import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class AppVereadorController {
  /** Retorna o schema da câmara do usuário logado */
  private schema(municipioId: number) {
    return `camara_${municipioId}`
  }

  async index({ auth, view, session }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    // Vereador vinculado ao usuário master
    const vereador = await db
      .from(`${s}.vereadores`)
      .where('usuario_id', usuario.id)
      .first()

    // Sessão em andamento
    const sessao = await db
      .from(`${s}.sessoes`)
      .where('status', 'em_andamento')
      .orderBy('created_at', 'desc')
      .first()

    // Se há sessão, busca estado atual (matéria em votação, etc.)
    let estadoAtual = 'aguardando'
    let materiaAtual = null
    let votacaoAtual = null
    let filaVoz: any[] = []

    if (sessao) {
      const votacao = await db
        .from(`${s}.votacoes`)
        .where('sessao_id', sessao.id)
        .where('status', 'aberta')
        .first()

      if (votacao) {
        estadoAtual = 'votacao'
        votacaoAtual = votacao
        materiaAtual = await db.from(`${s}.materias`).where('id', votacao.materia_id).first()

        // Placar parcial
        votacaoAtual.placar = await db
          .from(`${s}.votos`)
          .where('votacao_id', votacao.id)
          .select('opcao', db.raw('count(*) as total'))
          .groupBy('opcao')

        // Verifica se este vereador já votou
        if (vereador) {
          votacaoAtual.meuVoto = await db
            .from(`${s}.votos`)
            .where('votacao_id', votacao.id)
            .where('vereador_id', vereador.id)
            .first()
        }
      } else {
        // Verifica se há leitura em andamento
        const leitura = await db
          .from(`${s}.materias`)
          .where('sessao_id', sessao.id)
          .where('status', 'em_leitura')
          .first()

        if (leitura) {
          estadoAtual = 'leitura'
          materiaAtual = leitura
        } else if (sessao.status_quorum === 'aberto') {
          estadoAtual = 'quorum'
        }
      }

      // Fila de voz
      filaVoz = await db
        .from(`${s}.tempo_fala`)
        .where('sessao_id', sessao.id)
        .where('status', 'aguardando')
        .orderBy('criado_em', 'asc')
        .limit(5)
    }

    return view.render('pages/votacao/app', {
      usuario,
      vereador,
      sessao,
      estadoAtual,
      materiaAtual,
      votacaoAtual,
      filaVoz,
      isPresidente: vereador?.cargo === 'presidente',
    })
  }

  async abrirQuorum({ auth, session, response }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    // Garante que é presidente
    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    if (vereador?.cargo !== 'presidente') {
      return response.forbidden({ error: 'Apenas o presidente pode abrir o quórum' })
    }

    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    if (!sessao) return response.badRequest({ error: 'Nenhuma sessão em andamento' })

    await db.from(`${s}.sessoes`).where('id', sessao.id).update({
      status_quorum: 'aberto',
      quorum_iniciado_em: new Date(),
    })

    return response.json({ success: true })
  }

  async encerrarQuorum({ auth, session, response }: HttpContext) {
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)
    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    if (!sessao) return response.badRequest({ error: 'Nenhuma sessão em andamento' })

    await db.from(`${s}.sessoes`).where('id', sessao.id).update({ status_quorum: 'encerrado' })
    return response.json({ success: true })
  }

  async confirmarPresenca({ auth, session, response }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    if (!vereador) return response.forbidden({ error: 'Vereador não encontrado' })

    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    if (!sessao) return response.badRequest({ error: 'Nenhuma sessão em andamento' })

    // Upsert presença
    const existente = await db
      .from(`${s}.presencas`)
      .where({ sessao_id: sessao.id, vereador_id: vereador.id })
      .first()

    if (!existente) {
      await db.table(`${s}.presencas`).insert({
        sessao_id: sessao.id,
        vereador_id: vereador.id,
        confirmado_em: new Date(),
      })
    }

    return response.json({ success: true })
  }

  async votar({ request, auth, session, response }: HttpContext) {
    const { opcao } = request.only(['opcao']) // 'favor' | 'contra' | 'abstencao'
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    if (!vereador) return response.forbidden({ error: 'Vereador não encontrado' })

    const votacao = await db.from(`${s}.votacoes`).where('status', 'aberta').first()
    if (!votacao) return response.badRequest({ error: 'Nenhuma votação aberta' })

    // Verifica se já votou
    const jaVotou = await db
      .from(`${s}.votos`)
      .where({ votacao_id: votacao.id, vereador_id: vereador.id })
      .first()

    if (jaVotou) return response.badRequest({ error: 'Você já votou nesta matéria' })

    // Votação secreta: se configurado, não salva vereador_id
    const conf = await db.from(`${s}.configuracoes`).first()
    const secreto = conf?.votacao_secreta && votacao.tipo === 'secreta'

    await db.table(`${s}.votos`).insert({
      votacao_id: votacao.id,
      vereador_id: secreto ? null : vereador.id,
      opcao,
      registrado_em: new Date(),
    })

    return response.json({ success: true, opcao })
  }

  async pedirVoz({ auth, session, response }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    if (!vereador) return response.forbidden({ error: 'Vereador não encontrado' })

    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    if (!sessao) return response.badRequest({ error: 'Nenhuma sessão em andamento' })

    const jaFila = await db
      .from(`${s}.tempo_fala`)
      .where({ sessao_id: sessao.id, vereador_id: vereador.id, status: 'aguardando' })
      .first()

    if (jaFila) return response.badRequest({ error: 'Você já está na fila' })

    const posicao = await db
      .from(`${s}.tempo_fala`)
      .where({ sessao_id: sessao.id, status: 'aguardando' })
      .count('* as total')
      .first()

    await db.table(`${s}.tempo_fala`).insert({
      sessao_id: sessao.id,
      vereador_id: vereador.id,
      posicao: Number((posicao as any)?.total || 0) + 1,
      status: 'aguardando',
      criado_em: new Date(),
    })

    return response.json({ success: true })
  }

  async cancelarVoz({ auth, session, response }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    if (!vereador) return response.forbidden({ error: 'Vereador não encontrado' })

    const sessao = await db.from(`${s}.sessoes`).where('status', 'em_andamento').first()
    if (!sessao) return response.badRequest({ error: 'Nenhuma sessão em andamento' })

    await db
      .from(`${s}.tempo_fala`)
      .where({ sessao_id: sessao.id, vereador_id: vereador.id, status: 'aguardando' })
      .delete()

    return response.json({ success: true })
  }

  async ordens({ auth, session, view }: HttpContext) {
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const sessoes = await db
      .from(`${s}.sessoes`)
      .whereIn('status', ['encerrada', 'em_andamento'])
      .orderBy('data_sessao', 'desc')
      .limit(20)

    return view.render('pages/votacao/app', { sessoes, tabAtiva: 'ordens' })
  }

  async perfil({ auth, session, view }: HttpContext) {
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    const vereador = await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).first()
    return view.render('pages/votacao/app', { usuario, vereador, tabAtiva: 'perfil' })
  }

  async updatePerfil({ request, auth, session, response }: HttpContext) {
    const dados = request.only(['nome_parlamentar','email','whatsapp','telefone','facebook','instagram','trajetoria'])
    const usuario = auth.user!
    const municipioId = session.get('municipio_id')
    const s = this.schema(municipioId)

    await db.from(`${s}.vereadores`).where('usuario_id', usuario.id).update(dados)
    return response.json({ success: true })
  }

  async updateSenha({ request, auth, response }: HttpContext) {
    const { nova_senha } = request.only(['nova_senha'])
    const usuario = auth.user!

    const hash = await import('@adonisjs/core/services/hash')
    ;(usuario as any).senha = await hash.default.make(nova_senha)
    await (usuario as any).save()

    return response.json({ success: true })
  }

  async events({ params, response }: HttpContext) {
    response.header('Content-Type', 'text/event-stream')
    response.header('Cache-Control', 'no-cache')
    response.header('Connection', 'keep-alive')

    const data = JSON.stringify({ type: 'connected', sessaoId: params.sessaoId })
    response.response.write(`data: ${data}\n\n`)
  }
}
