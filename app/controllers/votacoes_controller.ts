import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import VotacaoService from '#services/votacao_service'
import sseService, { SSE_EVENTS } from '#services/sse_service'

export default class VotacoesController {
  /**
   * Lista votações de uma sessão
   */
  async index({ params, view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { sessaoId } = params

    const votacoes = await db.rawQuery(`
      SELECT v.*,
        m.numero as materia_numero,
        tm.prefixo as materia_prefixo,
        m.ano as materia_ano,
        m.ementa as materia_ementa
      FROM "${schemaName}".votacoes v
      LEFT JOIN "${schemaName}".materias m ON v.materia_id = m.id
      LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE v.sessao_id = $1
      ORDER BY v.numero_votacao
    `, [sessaoId])

    const sessao = await db.rawQuery(`
      SELECT * FROM "${schemaName}".sessoes WHERE id = $1
    `, [sessaoId])

    return view.render('pages/votacoes/index', {
      votacoes: votacoes.rows,
      sessao: sessao.rows[0]
    })
  }

  /**
   * Formulário para iniciar votação
   */
  async create({ params, view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { sessaoId } = params

    // Busca matérias da ordem do dia pendentes
    const materias = await db.rawQuery(`
      SELECT od.*, m.numero, m.ementa, m.ano, tm.prefixo, tm.nome as tipo_nome
      FROM "${schemaName}".ordem_dia od
      LEFT JOIN "${schemaName}".materias m ON od.materia_id = m.id
      LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE od.sessao_id = $1 AND od.situacao = 'pendente'
      ORDER BY od.ordem
    `, [sessaoId])

    const sessao = await db.rawQuery(`
      SELECT * FROM "${schemaName}".sessoes WHERE id = $1
    `, [sessaoId])

    return view.render('pages/votacoes/create', {
      materias: materias.rows,
      sessao: sessao.rows[0]
    })
  }

  /**
   * Inicia uma votação
   */
  async store({ request, response, session, params, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { sessaoId } = params

    const data = request.only([
      'materia_id', 'descricao', 'tipo', 'quorum_tipo', 'tempo_limite'
    ])

    try {
      const votacaoService = new VotacaoService(tenant!.municipioId)

      const votacaoId = await votacaoService.iniciarVotacao(
        parseInt(sessaoId),
        data.materia_id ? parseInt(data.materia_id) : null,
        data.descricao || 'Votação',
        {
          tipo: data.tipo || 'nominal',
          quorumTipo: data.quorum_tipo || 'maioria_simples',
          tempoLimite: data.tempo_limite ? parseInt(data.tempo_limite) : undefined,
          permitirAbstencao: true
        }
      )

      session.flash('success', 'Votação iniciada com sucesso')
      return response.redirect().toRoute('controle.sessao', { id: sessaoId })
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao iniciar votação')
      return response.redirect().back()
    }
  }

  /**
   * Detalhes de uma votação
   */
  async show({ params, view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    const votacaoService = new VotacaoService(tenant!.municipioId)
    const votacao = await votacaoService.getVotacaoDetalhes(parseInt(id))

    if (!votacao) {
      return view.render('pages/errors/404', { message: 'Votação não encontrada' })
    }

    // Busca votos detalhados
    const votos = await db.rawQuery(`
      SELECT vo.*, ve.nome, ve.nome_parlamentar, ve.foto_url, p.sigla as partido
      FROM "${schemaName}".votos vo
      JOIN "${schemaName}".vereadores ve ON vo.vereador_id = ve.id
      LEFT JOIN "${schemaName}".partidos p ON ve.partido_id = p.id
      WHERE vo.votacao_id = $1
      ORDER BY vo.hora_voto
    `, [id])

    return view.render('pages/votacoes/show', {
      votacao,
      votos: votos.rows
    })
  }

  /**
   * Encerra uma votação
   */
  async encerrar({ params, response, session, tenant }: HttpContext) {
    const { id, sessaoId } = params

    try {
      const votacaoService = new VotacaoService(tenant!.municipioId)
      const resultado = await votacaoService.encerrarVotacao(parseInt(id))

      session.flash('success', `Votação encerrada. Resultado: ${resultado.aprovado ? 'APROVADO' : 'REJEITADO'}`)
      return response.redirect().toRoute('controle.sessao', { id: sessaoId })
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao encerrar votação')
      return response.redirect().back()
    }
  }

  /**
   * Registra voto (API para vereador)
   */
  async registrarVoto({ request, response, params, tenant, auth }: HttpContext) {
    const { id } = params
    const { voto } = request.only(['voto'])

    try {
      const user = auth.user!
      const schemaName = tenant!.schemaName

      // Busca o vereador vinculado ao usuário
      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        return response.status(403).json({
          success: false,
          error: 'Usuário não é um vereador ativo'
        })
      }

      const vereadorId = vereador.rows[0].id
      const votacaoService = new VotacaoService(tenant!.municipioId)

      await votacaoService.registrarVoto(
        parseInt(id),
        vereadorId,
        voto,
        request.ip(),
        request.header('User-Agent')
      )

      return response.json({
        success: true,
        message: 'Voto registrado com sucesso'
      })
    } catch (error: any) {
      return response.status(400).json({
        success: false,
        error: error.message || 'Erro ao registrar voto'
      })
    }
  }

  /**
   * Estado atual da votação (API)
   */
  async estado({ params, response, tenant }: HttpContext) {
    const { id } = params

    try {
      const votacaoService = new VotacaoService(tenant!.municipioId)
      const votacao = await votacaoService.getVotacaoDetalhes(parseInt(id))

      if (!votacao) {
        return response.status(404).json({ error: 'Votação não encontrada' })
      }

      // Busca votos se nominal e em andamento
      let votos: any[] = []
      if (votacao.tipo === 'nominal') {
        const schemaName = tenant!.schemaName
        const votosResult = await db.rawQuery(`
          SELECT vo.voto, ve.id as vereador_id, ve.nome, ve.nome_parlamentar, p.sigla as partido
          FROM "${schemaName}".votos vo
          JOIN "${schemaName}".vereadores ve ON vo.vereador_id = ve.id
          LEFT JOIN "${schemaName}".partidos p ON ve.partido_id = p.id
          WHERE vo.votacao_id = $1
          ORDER BY vo.hora_voto
        `, [id])
        votos = votosResult.rows
      }

      // Busca quem ainda não votou
      const aguardando = await votacaoService.getVereadoresAguardando(
        parseInt(id),
        votacao.sessao_id
      )

      return response.json({
        votacao,
        votos,
        aguardando,
        contagem: {
          sim: votacao.votos_sim || 0,
          nao: votacao.votos_nao || 0,
          abstencao: votacao.votos_abstencao || 0,
          total: votacao.total_votos || 0
        }
      })
    } catch (error: any) {
      return response.status(500).json({ error: error.message })
    }
  }

  /**
   * Votação em andamento da sessão (API)
   */
  async emAndamento({ params, response, tenant }: HttpContext) {
    const { sessaoId } = params

    try {
      const votacaoService = new VotacaoService(tenant!.municipioId)
      const votacao = await votacaoService.getVotacaoEmAndamento(parseInt(sessaoId))

      if (!votacao) {
        return response.json({ emAndamento: false })
      }

      // Busca quem ainda não votou
      const aguardando = await votacaoService.getVereadoresAguardando(
        votacao.id,
        parseInt(sessaoId)
      )

      return response.json({
        emAndamento: true,
        votacao,
        aguardando,
        contagem: {
          sim: votacao.votos_sim || 0,
          nao: votacao.votos_nao || 0,
          abstencao: votacao.votos_abstencao || 0,
          total: votacao.total_votos || 0
        }
      })
    } catch (error: any) {
      return response.status(500).json({ error: error.message })
    }
  }
}
