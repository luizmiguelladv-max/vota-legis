import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import VotacaoService from '#services/votacao_service'
import sseService, { SSE_EVENTS } from '#services/sse_service'

export default class VereadorAppController {
  /**
   * Painel principal do vereador
   */
  async index({ view, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!

    // Busca vereador vinculado ao usuário
    const vereadorResult = await db.rawQuery(`
      SELECT v.*, p.sigla as partido_sigla, p.nome as partido_nome
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      WHERE v.usuario_id = $1 AND v.status = 'ativo'
    `, [user.id])

    if (vereadorResult.rows.length === 0) {
      return view.render('pages/vereador-app/sem-vinculo', {
        municipio: tenant!.municipio
      })
    }

    const vereador = vereadorResult.rows[0]

    // Busca sessão em andamento
    const sessaoResult = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.status = 'em_andamento'
      ORDER BY s.data DESC
      LIMIT 1
    `, [])

    let sessao = null
    let presenca = null
    let votacaoEmAndamento = null
    let jaVotou = false
    let inscricoes: any[] = []

    if (sessaoResult.rows.length > 0) {
      sessao = sessaoResult.rows[0]

      // Verifica presença do vereador
      const presencaResult = await db.rawQuery(`
        SELECT * FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND vereador_id = $2
      `, [sessao.id, vereador.id])

      presenca = presencaResult.rows[0] || null

      // Busca votação em andamento
      const votacaoService = new VotacaoService(tenant!.municipioId)
      votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(sessao.id)

      if (votacaoEmAndamento) {
        jaVotou = await votacaoService.vereadorJaVotou(votacaoEmAndamento.id, vereador.id)
      }

      // Busca inscrições do vereador
      const inscricoesResult = await db.rawQuery(`
        SELECT * FROM "${schemaName}".inscricoes_fala
        WHERE sessao_id = $1 AND vereador_id = $2 AND status IN ('aguardando', 'falando')
        ORDER BY hora_inscricao
      `, [sessao.id, vereador.id])

      inscricoes = inscricoesResult.rows
    }

    return view.render('pages/vereador-app/index', {
      vereador,
      sessao,
      presenca,
      votacaoEmAndamento,
      jaVotou,
      inscricoes,
      municipio: tenant!.municipio
    })
  }

  /**
   * Marca presença
   */
  async marcarPresenca({ request, response, session, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!

    try {
      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT id, nome, nome_parlamentar FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        session.flash('error', 'Vereador não encontrado')
        return response.redirect().back()
      }

      // Busca sessão em andamento
      const sessao = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        session.flash('error', 'Não há sessão em andamento')
        return response.redirect().back()
      }

      const sessaoId = sessao.rows[0].id
      const vereadorId = vereador.rows[0].id

      // Verifica se já marcou presença
      const existente = await db.rawQuery(`
        SELECT id, presente FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND vereador_id = $2
      `, [sessaoId, vereadorId])

      if (existente.rows.length > 0 && existente.rows[0].presente) {
        session.flash('info', 'Presença já registrada')
        return response.redirect().back()
      }

      if (existente.rows.length > 0) {
        // Atualiza
        await db.rawQuery(`
          UPDATE "${schemaName}".sessao_presencas
          SET presente = true, tipo_registro = 'app_vereador', hora_entrada = NOW(), updated_at = NOW()
          WHERE sessao_id = $1 AND vereador_id = $2
        `, [sessaoId, vereadorId])
      } else {
        // Insere
        await db.rawQuery(`
          INSERT INTO "${schemaName}".sessao_presencas (sessao_id, vereador_id, presente, tipo_registro, hora_entrada, created_at, updated_at)
          VALUES ($1, $2, true, 'app_vereador', NOW(), NOW(), NOW())
        `, [sessaoId, vereadorId])
      }

      // Broadcast
      sseService.broadcast(sessaoId, tenant!.municipioId, SSE_EVENTS.PRESENCA_REGISTRADA, {
        vereadorId,
        nome: vereador.rows[0].nome_parlamentar || vereador.rows[0].nome,
        presente: true
      })

      session.flash('success', 'Presença registrada com sucesso!')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao marcar presença')
    }

    return response.redirect().back()
  }

  /**
   * Registra voto
   */
  async votar({ request, response, session, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const { voto } = request.only(['voto'])

    try {
      // Validar voto
      if (!['sim', 'nao', 'abstencao'].includes(voto)) {
        session.flash('error', 'Voto inválido')
        return response.redirect().back()
      }

      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        session.flash('error', 'Vereador não encontrado')
        return response.redirect().back()
      }

      // Busca sessão e votação em andamento
      const sessao = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        session.flash('error', 'Não há sessão em andamento')
        return response.redirect().back()
      }

      const votacaoService = new VotacaoService(tenant!.municipioId)
      const votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(sessao.rows[0].id)

      if (!votacaoEmAndamento) {
        session.flash('error', 'Não há votação em andamento')
        return response.redirect().back()
      }

      // Registra voto
      await votacaoService.registrarVoto(
        votacaoEmAndamento.id,
        vereador.rows[0].id,
        voto,
        request.ip(),
        request.header('User-Agent')
      )

      const votoTexto = voto === 'sim' ? 'SIM' : voto === 'nao' ? 'NÃO' : 'ABSTENÇÃO'
      session.flash('success', `Voto registrado: ${votoTexto}`)
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao registrar voto')
    }

    return response.redirect().back()
  }

  /**
   * API: Registra voto (JSON)
   */
  async votarApi({ request, response, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const { voto } = request.only(['voto'])

    try {
      if (!['sim', 'nao', 'abstencao'].includes(voto)) {
        return response.status(400).json({ success: false, error: 'Voto inválido' })
      }

      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        return response.status(403).json({ success: false, error: 'Vereador não encontrado' })
      }

      const sessao = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        return response.status(400).json({ success: false, error: 'Não há sessão em andamento' })
      }

      const votacaoService = new VotacaoService(tenant!.municipioId)
      const votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(sessao.rows[0].id)

      if (!votacaoEmAndamento) {
        return response.status(400).json({ success: false, error: 'Não há votação em andamento' })
      }

      await votacaoService.registrarVoto(
        votacaoEmAndamento.id,
        vereador.rows[0].id,
        voto,
        request.ip(),
        request.header('User-Agent')
      )

      return response.json({ success: true, voto })
    } catch (error: any) {
      return response.status(400).json({ success: false, error: error.message })
    }
  }

  /**
   * Pede a palavra (inscrição para fala)
   */
  async pedirPalavra({ request, response, session, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const { tipo } = request.only(['tipo'])

    try {
      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT id, nome, nome_parlamentar FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        session.flash('error', 'Vereador não encontrado')
        return response.redirect().back()
      }

      // Busca sessão
      const sessao = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        session.flash('error', 'Não há sessão em andamento')
        return response.redirect().back()
      }

      const sessaoId = sessao.rows[0].id
      const vereadorId = vereador.rows[0].id

      // Verifica se já está inscrito para esse tipo
      const jaInscrito = await db.rawQuery(`
        SELECT id FROM "${schemaName}".inscricoes_fala
        WHERE sessao_id = $1 AND vereador_id = $2 AND tipo = $3 AND status IN ('aguardando', 'falando')
      `, [sessaoId, vereadorId, tipo])

      if (jaInscrito.rows.length > 0) {
        session.flash('info', 'Você já está inscrito para este tipo de fala')
        return response.redirect().back()
      }

      // Busca próxima ordem
      const ordemResult = await db.rawQuery(`
        SELECT COALESCE(MAX(ordem), 0) + 1 as proxima
        FROM "${schemaName}".inscricoes_fala
        WHERE sessao_id = $1 AND tipo = $2
      `, [sessaoId, tipo])

      const ordem = ordemResult.rows[0].proxima

      // Insere inscrição
      await db.rawQuery(`
        INSERT INTO "${schemaName}".inscricoes_fala (sessao_id, vereador_id, tipo, ordem, status, hora_inscricao)
        VALUES ($1, $2, $3, $4, 'aguardando', NOW())
      `, [sessaoId, vereadorId, tipo, ordem])

      // Broadcast
      sseService.broadcast(sessaoId, tenant!.municipioId, SSE_EVENTS.INSCRICAO_REGISTRADA, {
        vereadorId,
        nome: vereador.rows[0].nome_parlamentar || vereador.rows[0].nome,
        tipo,
        ordem
      })

      session.flash('success', 'Inscrição realizada com sucesso!')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao pedir palavra')
    }

    return response.redirect().back()
  }

  /**
   * Cancela inscrição para fala
   */
  async cancelarPalavra({ params, response, session, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!
    const { inscricaoId } = params

    try {
      // Busca vereador
      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        session.flash('error', 'Vereador não encontrado')
        return response.redirect().back()
      }

      // Verifica se a inscrição é do vereador
      const inscricao = await db.rawQuery(`
        SELECT * FROM "${schemaName}".inscricoes_fala
        WHERE id = $1 AND vereador_id = $2 AND status = 'aguardando'
      `, [inscricaoId, vereador.rows[0].id])

      if (inscricao.rows.length === 0) {
        session.flash('error', 'Inscrição não encontrada ou não pode ser cancelada')
        return response.redirect().back()
      }

      // Atualiza status
      await db.rawQuery(`
        UPDATE "${schemaName}".inscricoes_fala SET status = 'cancelado' WHERE id = $1
      `, [inscricaoId])

      // Broadcast
      sseService.broadcast(inscricao.rows[0].sessao_id, tenant!.municipioId, SSE_EVENTS.INSCRICAO_CANCELADA, {
        inscricaoId: parseInt(inscricaoId),
        vereadorId: vereador.rows[0].id
      })

      session.flash('success', 'Inscrição cancelada')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao cancelar inscrição')
    }

    return response.redirect().back()
  }

  /**
   * Estado atual do vereador (API para polling)
   */
  async estado({ response, tenant, auth }: HttpContext) {
    const schemaName = tenant!.schemaName
    const user = auth.user!

    try {
      const vereador = await db.rawQuery(`
        SELECT id FROM "${schemaName}".vereadores
        WHERE usuario_id = $1 AND status = 'ativo'
      `, [user.id])

      if (vereador.rows.length === 0) {
        return response.status(403).json({ error: 'Vereador não encontrado' })
      }

      const vereadorId = vereador.rows[0].id

      // Busca sessão
      const sessao = await db.rawQuery(`
        SELECT * FROM "${schemaName}".sessoes WHERE status = 'em_andamento' LIMIT 1
      `, [])

      if (sessao.rows.length === 0) {
        return response.json({ sessaoAtiva: false })
      }

      const sessaoId = sessao.rows[0].id

      // Presença
      const presenca = await db.rawQuery(`
        SELECT presente FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND vereador_id = $2
      `, [sessaoId, vereadorId])

      // Votação em andamento
      const votacaoService = new VotacaoService(tenant!.municipioId)
      const votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(sessaoId)

      let jaVotou = false
      if (votacaoEmAndamento) {
        jaVotou = await votacaoService.vereadorJaVotou(votacaoEmAndamento.id, vereadorId)
      }

      // Inscrições
      const inscricoes = await db.rawQuery(`
        SELECT * FROM "${schemaName}".inscricoes_fala
        WHERE sessao_id = $1 AND vereador_id = $2 AND status IN ('aguardando', 'falando')
      `, [sessaoId, vereadorId])

      return response.json({
        sessaoAtiva: true,
        sessao: {
          id: sessao.rows[0].id,
          numero: sessao.rows[0].numero,
          tipo: sessao.rows[0].tipo,
          fase: sessao.rows[0].fase_atual,
          status: sessao.rows[0].status
        },
        presente: presenca.rows[0]?.presente || false,
        votacao: votacaoEmAndamento ? {
          id: votacaoEmAndamento.id,
          descricao: votacaoEmAndamento.descricao,
          tipo: votacaoEmAndamento.tipo,
          materia: votacaoEmAndamento.materia_prefixo ? 
            `${votacaoEmAndamento.materia_prefixo} ${votacaoEmAndamento.materia_numero}/${votacaoEmAndamento.materia_ano}` : null,
          ementa: votacaoEmAndamento.materia_ementa
        } : null,
        jaVotou,
        inscricoes: inscricoes.rows
      })
    } catch (error: any) {
      return response.status(500).json({ error: error.message })
    }
  }
}
