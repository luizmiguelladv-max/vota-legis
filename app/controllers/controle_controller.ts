import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import VotacaoService from '#services/votacao_service'
import sseService, { SSE_EVENTS } from '#services/sse_service'

export default class ControleController {
  /**
   * Painel principal de controle da sessão
   */
  async sessao({ params, view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    // Busca sessão
    const sessaoResult = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.id = $1
    `, [id])

    if (sessaoResult.rows.length === 0) {
      return view.render('pages/errors/404', { message: 'Sessão não encontrada' })
    }

    const sessao = sessaoResult.rows[0]

    // Busca vereadores com presença
    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.foto_url, v.cargo,
        p.sigla as partido_sigla, p.cor as partido_cor,
        COALESCE(sp.presente, false) as presente,
        sp.hora_entrada
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".sessao_presencas sp ON v.id = sp.vereador_id AND sp.sessao_id = $1
      WHERE v.status = 'ativo'
      ORDER BY v.nome_parlamentar, v.nome
    `, [id])

    // Conta presenças
    const totalPresentes = vereadores.rows.filter((v: any) => v.presente).length
    const totalVereadores = vereadores.rows.length
    const quorumMinimo = Math.floor(totalVereadores / 2) + 1

    // Busca votação em andamento
    const votacaoService = new VotacaoService(tenant!.municipioId)
    const votacaoEmAndamento = await votacaoService.getVotacaoEmAndamento(parseInt(id))

    // Busca ordem do dia
    const ordemDia = await db.rawQuery(`
      SELECT od.*, m.numero, m.ementa, m.ano, tm.prefixo, tm.nome as tipo_nome, tm.quorum_aprovacao
      FROM "${schemaName}".ordem_dia od
      LEFT JOIN "${schemaName}".materias m ON od.materia_id = m.id
      LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE od.sessao_id = $1
      ORDER BY od.ordem
    `, [id])

    // Busca expedientes
    const expedientes = await db.rawQuery(`
      SELECT * FROM "${schemaName}".expedientes
      WHERE sessao_id = $1
      ORDER BY ordem
    `, [id])

    // Busca inscrições para fala
    const inscricoes = await db.rawQuery(`
      SELECT i.*, v.nome, v.nome_parlamentar, p.sigla as partido
      FROM "${schemaName}".inscricoes_fala i
      JOIN "${schemaName}".vereadores v ON i.vereador_id = v.id
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      WHERE i.sessao_id = $1 AND i.status IN ('aguardando', 'falando')
      ORDER BY i.ordem, i.hora_inscricao
    `, [id])

    // Busca votações já realizadas
    const votacoes = await db.rawQuery(`
      SELECT v.*, m.numero as materia_numero, m.ementa, tm.prefixo
      FROM "${schemaName}".votacoes v
      LEFT JOIN "${schemaName}".materias m ON v.materia_id = m.id
      LEFT JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE v.sessao_id = $1
      ORDER BY v.numero_votacao DESC
    `, [id])

    return view.render('pages/controle/sessao', {
      sessao,
      vereadores: vereadores.rows,
      quorum: {
        total: totalVereadores,
        presentes: totalPresentes,
        minimo: quorumMinimo,
        atingido: totalPresentes >= quorumMinimo
      },
      votacaoEmAndamento,
      ordemDia: ordemDia.rows,
      expedientes: expedientes.rows,
      inscricoes: inscricoes.rows,
      votacoes: votacoes.rows,
      municipio: tenant!.municipio
    })
  }

  /**
   * Inicia registro de quórum
   */
  async iniciarQuorum({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    try {
      // Atualiza status da sessão
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET fase_atual = 'quorum', updated_at = NOW()
        WHERE id = $1
      `, [id])

      // Broadcast
      sseService.broadcast(parseInt(id), tenant!.municipioId, SSE_EVENTS.QUORUM_INICIADO, {
        sessaoId: id,
        fase: 'quorum'
      })

      session.flash('success', 'Registro de quórum iniciado')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao iniciar quórum')
    }

    return response.redirect().back()
  }

  /**
   * Registra presença de vereador
   */
  async registrarPresenca({ params, request, response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id, vereadorId } = params
    const { presente, tipo } = request.only(['presente', 'tipo'])

    try {
      // Verifica se já existe registro
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND vereador_id = $2
      `, [id, vereadorId])

      if (existente.rows.length > 0) {
        // Atualiza
        await db.rawQuery(`
          UPDATE "${schemaName}".sessao_presencas
          SET presente = $1, tipo_registro = $2, hora_entrada = CASE WHEN $1 THEN NOW() ELSE hora_entrada END, updated_at = NOW()
          WHERE sessao_id = $3 AND vereador_id = $4
        `, [presente, tipo || 'manual', id, vereadorId])
      } else {
        // Insere
        await db.rawQuery(`
          INSERT INTO "${schemaName}".sessao_presencas (sessao_id, vereador_id, presente, tipo_registro, hora_entrada, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
        `, [id, vereadorId, presente, tipo || 'manual'])
      }

      // Atualiza quórum na sessão
      const quorum = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND presente = true
      `, [id])

      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET quorum_atual = $1, updated_at = NOW()
        WHERE id = $2
      `, [quorum.rows[0].total, id])

      // Busca info do vereador para broadcast
      const vereador = await db.rawQuery(`
        SELECT v.nome, v.nome_parlamentar, p.sigla as partido
        FROM "${schemaName}".vereadores v
        LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
        WHERE v.id = $1
      `, [vereadorId])

      // Broadcast
      const evento = presente ? SSE_EVENTS.PRESENCA_REGISTRADA : SSE_EVENTS.PRESENCA_REMOVIDA
      sseService.broadcast(parseInt(id), tenant!.municipioId, evento, {
        vereadorId: parseInt(vereadorId),
        nome: vereador.rows[0]?.nome_parlamentar || vereador.rows[0]?.nome,
        partido: vereador.rows[0]?.partido,
        presente,
        quorumAtual: parseInt(quorum.rows[0].total)
      })

      return response.json({ success: true, quorum: parseInt(quorum.rows[0].total) })
    } catch (error: any) {
      return response.status(500).json({ success: false, error: error.message })
    }
  }

  /**
   * Finaliza registro de quórum
   */
  async finalizarQuorum({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    try {
      // Busca total de presentes
      const quorum = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".sessao_presencas
        WHERE sessao_id = $1 AND presente = true
      `, [id])

      const totalPresentes = parseInt(quorum.rows[0].total)

      // Busca total de vereadores
      const vereadores = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".vereadores WHERE status = 'ativo'
      `, [])

      const totalVereadores = parseInt(vereadores.rows[0].total)
      const quorumMinimo = Math.floor(totalVereadores / 2) + 1

      // Atualiza sessão
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET fase_atual = 'abertura',
            quorum_minimo = $1,
            quorum_atual = $2,
            updated_at = NOW()
        WHERE id = $3
      `, [quorumMinimo, totalPresentes, id])

      // Broadcast
      sseService.broadcast(parseInt(id), tenant!.municipioId, SSE_EVENTS.QUORUM_FINALIZADO, {
        sessaoId: id,
        quorum: {
          total: totalVereadores,
          presentes: totalPresentes,
          minimo: quorumMinimo,
          atingido: totalPresentes >= quorumMinimo
        }
      })

      session.flash('success', `Quórum finalizado. ${totalPresentes} presentes de ${totalVereadores} (mínimo: ${quorumMinimo})`)
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao finalizar quórum')
    }

    return response.redirect().back()
  }

  /**
   * Inicia sessão
   */
  async iniciarSessao({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'em_andamento',
            hora_inicio_real = NOW(),
            fase_atual = 'abertura',
            updated_at = NOW()
        WHERE id = $1
      `, [id])

      sseService.broadcast(parseInt(id), tenant!.municipioId, SSE_EVENTS.SESSAO_INICIADA, {
        sessaoId: id
      })

      session.flash('success', 'Sessão iniciada')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao iniciar sessão')
    }

    return response.redirect().back()
  }

  /**
   * Encerra sessão
   */
  async encerrarSessao({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'encerrada',
            hora_fim_real = NOW(),
            fase_atual = 'encerrada',
            updated_at = NOW()
        WHERE id = $1
      `, [id])

      sseService.broadcast(parseInt(id), tenant!.municipioId, SSE_EVENTS.SESSAO_ENCERRADA, {
        sessaoId: id
      })

      session.flash('success', 'Sessão encerrada')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao encerrar sessão')
    }

    return response.redirect().back()
  }

  /**
   * Inicia votação rápida (sem matéria)
   */
  async iniciarVotacaoRapida({ params, request, response, session, tenant }: HttpContext) {
    const { id } = params
    const { descricao, tipo, quorum_tipo } = request.only(['descricao', 'tipo', 'quorum_tipo'])

    try {
      const votacaoService = new VotacaoService(tenant!.municipioId)

      await votacaoService.iniciarVotacao(
        parseInt(id),
        null,
        descricao || 'Votação',
        {
          tipo: tipo || 'nominal',
          quorumTipo: quorum_tipo || 'maioria_simples',
          permitirAbstencao: true
        }
      )

      session.flash('success', 'Votação iniciada')
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao iniciar votação')
    }

    return response.redirect().back()
  }

  /**
   * Inicia votação de matéria da ordem do dia
   */
  async iniciarVotacaoMateria({ params, request, response, session, tenant }: HttpContext) {
    const { id, materiaId } = params
    const schemaName = tenant!.schemaName

    try {
      // Busca a matéria e seu tipo
      const materia = await db.rawQuery(`
        SELECT m.*, tm.quorum_aprovacao, tm.prefixo, tm.nome as tipo_nome
        FROM "${schemaName}".materias m
        JOIN "${schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
        WHERE m.id = $1
      `, [materiaId])

      if (materia.rows.length === 0) {
        session.flash('error', 'Matéria não encontrada')
        return response.redirect().back()
      }

      const mat = materia.rows[0]
      const descricao = `${mat.prefixo} ${mat.numero}/${mat.ano} - ${mat.ementa?.substring(0, 100)}...`

      const votacaoService = new VotacaoService(tenant!.municipioId)

      await votacaoService.iniciarVotacao(
        parseInt(id),
        parseInt(materiaId),
        descricao,
        {
          tipo: 'nominal',
          quorumTipo: mat.quorum_aprovacao || 'maioria_simples',
          permitirAbstencao: true
        }
      )

      session.flash('success', `Votação de ${mat.prefixo} ${mat.numero}/${mat.ano} iniciada`)
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao iniciar votação')
    }

    return response.redirect().back()
  }

  /**
   * Encerra votação em andamento
   */
  async encerrarVotacao({ params, response, session, tenant }: HttpContext) {
    const { id } = params
    const schemaName = tenant!.schemaName

    try {
      // Busca votação em andamento
      const votacao = await db.rawQuery(`
        SELECT id FROM "${schemaName}".votacoes
        WHERE sessao_id = $1 AND status = 'em_andamento'
      `, [id])

      if (votacao.rows.length === 0) {
        session.flash('error', 'Não há votação em andamento')
        return response.redirect().back()
      }

      const votacaoService = new VotacaoService(tenant!.municipioId)
      const resultado = await votacaoService.encerrarVotacao(votacao.rows[0].id)

      session.flash('success', `Votação encerrada. Resultado: ${resultado.aprovado ? 'APROVADO' : 'REJEITADO'} (${resultado.votosSim} x ${resultado.votosNao})`)
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao encerrar votação')
    }

    return response.redirect().back()
  }

  /**
   * Muda fase da sessão
   */
  async mudarFase({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { id } = params
    const { fase } = request.only(['fase'])

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET fase_atual = $1, updated_at = NOW()
        WHERE id = $2
      `, [fase, id])

      // Broadcast
      sseService.broadcast(parseInt(id), tenant!.municipioId, 'sessao:fase_mudou', {
        sessaoId: id,
        fase
      })

      session.flash('success', `Fase alterada para: ${fase}`)
    } catch (error: any) {
      session.flash('error', error.message || 'Erro ao mudar fase')
    }

    return response.redirect().back()
  }
}
