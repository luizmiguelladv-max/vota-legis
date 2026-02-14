import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class SessoesController {
  /**
   * Lista todas as sessoes
   */
  async index({ view, request, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { status, tipo, legislatura_id } = request.qs()

    let whereClause = ''
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      whereClause += ` AND s.status = $${paramIndex++}`
      params.push(status)
    }

    if (tipo) {
      whereClause += ` AND s.tipo = $${paramIndex++}`
      params.push(tipo)
    }

    if (legislatura_id) {
      whereClause += ` AND s.legislatura_id = $${paramIndex++}`
      params.push(legislatura_id)
    }

    const result = await db.rawQuery(`
      SELECT s.*,
        l.numero as legislatura_numero,
        (SELECT COUNT(*) FROM "${schemaName}".sessao_presencas p WHERE p.sessao_id = s.id AND p.presente = true) as total_presentes,
        (SELECT COUNT(*) FROM "${schemaName}".votacoes v WHERE v.sessao_id = s.id) as total_votacoes
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE 1=1 ${whereClause}
      ORDER BY s.data DESC, s.hora_inicio_prevista DESC
    `, params)

    // Busca legislaturas para o filtro
    const legislaturas = await db.rawQuery(`
      SELECT id, numero, atual FROM "${schemaName}".legislaturas ORDER BY numero DESC
    `)

    return view.render('pages/sessoes/index', {
      sessoes: result.rows,
      legislaturas: legislaturas.rows,
      filtros: { status, tipo, legislatura_id }
    })
  }

  /**
   * Formulario de nova sessao
   */
  async create({ view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const legislaturas = await db.rawQuery(`
      SELECT id, numero, atual FROM "${schemaName}".legislaturas ORDER BY numero DESC
    `)

    // Busca a próxima numeração
    const ultimaSessao = await db.rawQuery(`
      SELECT MAX(numero) as ultimo FROM "${schemaName}".sessoes WHERE EXTRACT(YEAR FROM data) = EXTRACT(YEAR FROM CURRENT_DATE)
    `)

    const proximoNumero = (ultimaSessao.rows[0]?.ultimo || 0) + 1

    return view.render('pages/sessoes/create', {
      legislaturas: legislaturas.rows,
      proximoNumero
    })
  }

  /**
   * Salva nova sessao
   */
  async store({ request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only([
      'numero', 'tipo', 'data', 'hora_inicio_prevista', 'hora_fim_prevista',
      'legislatura_id', 'descricao', 'titulo'
    ])

    try {
      // Verifica se já existe sessão com mesmo número no ano
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes
        WHERE numero = $1 AND EXTRACT(YEAR FROM data) = EXTRACT(YEAR FROM $2::date)
      `, [data.numero, data.data])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe uma sessão com este número neste ano')
        return response.redirect().back()
      }

      const ano = new Date(data.data).getFullYear()

      await db.rawQuery(`
        INSERT INTO "${schemaName}".sessoes (
          numero, ano, tipo, data, hora_inicio_prevista, hora_fim_prevista,
          legislatura_id, titulo, descricao, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agendada', NOW(), NOW())
      `, [
        data.numero,
        ano,
        data.tipo,
        data.data,
        data.hora_inicio_prevista || null,
        data.hora_fim_prevista || null,
        data.legislatura_id || null,
        data.titulo || null,
        data.descricao || null
      ])

      session.flash('success', 'Sessão cadastrada com sucesso')
      return response.redirect().toRoute('sessoes.index')
    } catch (error) {
      console.error('Erro ao criar sessão:', error)
      session.flash('error', 'Erro ao cadastrar sessão')
      return response.redirect().back()
    }
  }

  /**
   * Exibe detalhes da sessao
   */
  async show({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Sessão não encontrada')
      return response.redirect().toRoute('sessoes.index')
    }

    // Busca presenças
    const presencas = await db.rawQuery(`
      SELECT p.*, v.nome, v.nome_parlamentar, v.foto_url,
        pt.sigla as partido_sigla
      FROM "${schemaName}".sessao_presencas p
      JOIN "${schemaName}".vereadores v ON p.vereador_id = v.id
      LEFT JOIN "${schemaName}".partidos pt ON v.partido_id = pt.id
      WHERE p.sessao_id = $1 AND p.presente = true
      ORDER BY p.hora_entrada ASC
    `, [params.id])

    // Busca votações
    const votacoes = await db.rawQuery(`
      SELECT vt.*, m.numero as materia_numero, m.tipo as materia_tipo, m.ementa
      FROM "${schemaName}".votacoes vt
      LEFT JOIN "${schemaName}".materias m ON vt.materia_id = m.id
      WHERE vt.sessao_id = $1
      ORDER BY vt.ordem ASC
    `, [params.id])

    // Busca vereadores ativos para quorum
    const vereadoresAtivos = await db.rawQuery(`
      SELECT COUNT(*) as total FROM "${schemaName}".vereadores WHERE status = 'ativo'
    `)

    const totalVereadores = parseInt(vereadoresAtivos.rows[0]?.total || '0')
    const quorumMinimo = Math.ceil(totalVereadores / 2) + 1

    return view.render('pages/sessoes/show', {
      sessao: result.rows[0],
      presencas: presencas.rows,
      votacoes: votacoes.rows,
      quorum: {
        total: totalVereadores,
        presentes: presencas.rows.length,
        minimo: quorumMinimo,
        atingido: presencas.rows.length >= quorumMinimo
      }
    })
  }

  /**
   * Formulario de edicao
   */
  async edit({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT * FROM "${schemaName}".sessoes WHERE id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Sessão não encontrada')
      return response.redirect().toRoute('sessoes.index')
    }

    const legislaturas = await db.rawQuery(`
      SELECT id, numero, atual FROM "${schemaName}".legislaturas ORDER BY numero DESC
    `)

    return view.render('pages/sessoes/edit', {
      sessao: result.rows[0],
      legislaturas: legislaturas.rows
    })
  }

  /**
   * Atualiza sessao
   */
  async update({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only([
      'numero', 'tipo', 'data', 'hora_inicio_prevista', 'hora_fim_prevista',
      'legislatura_id', 'titulo', 'descricao', 'status'
    ])

    try {
      // Verifica se já existe outra sessão com mesmo número no ano
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessoes
        WHERE numero = $1 AND EXTRACT(YEAR FROM data) = EXTRACT(YEAR FROM $2::date) AND id != $3
      `, [data.numero, data.data, params.id])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe outra sessão com este número neste ano')
        return response.redirect().back()
      }

      const ano = new Date(data.data).getFullYear()

      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET numero = $1, ano = $2, tipo = $3, data = $4, hora_inicio_prevista = $5, hora_fim_prevista = $6,
            legislatura_id = $7, titulo = $8, descricao = $9, status = $10,
            updated_at = NOW()
        WHERE id = $11
      `, [
        data.numero,
        ano,
        data.tipo,
        data.data,
        data.hora_inicio_prevista || null,
        data.hora_fim_prevista || null,
        data.legislatura_id || null,
        data.titulo || null,
        data.descricao || null,
        data.status,
        params.id
      ])

      session.flash('success', 'Sessão atualizada com sucesso')
      return response.redirect().toRoute('sessoes.show', { id: params.id })
    } catch (error) {
      console.error('Erro ao atualizar sessão:', error)
      session.flash('error', 'Erro ao atualizar sessão')
      return response.redirect().back()
    }
  }

  /**
   * Remove sessao
   */
  async destroy({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      // Verifica se há votações vinculadas
      const votacoes = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".votacoes WHERE sessao_id = $1
      `, [params.id])

      if (parseInt(votacoes.rows[0].total) > 0) {
        session.flash('error', 'Não é possível excluir sessão com votações vinculadas')
        return response.redirect().toRoute('sessoes.index')
      }

      // Remove presenças primeiro
      await db.rawQuery(`
        DELETE FROM "${schemaName}".sessao_presencas WHERE sessao_id = $1
      `, [params.id])

      // Remove a sessão
      await db.rawQuery(`
        DELETE FROM "${schemaName}".sessoes WHERE id = $1
      `, [params.id])

      session.flash('success', 'Sessão excluída com sucesso')
    } catch (error) {
      console.error('Erro ao excluir sessão:', error)
      session.flash('error', 'Erro ao excluir sessão')
    }

    return response.redirect().toRoute('sessoes.index')
  }

  /**
   * Inicia uma sessao
   */
  async iniciar({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'em_andamento', hora_inicio_real = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [params.id])

      session.flash('success', 'Sessão iniciada com sucesso')
    } catch (error) {
      console.error('Erro ao iniciar sessão:', error)
      session.flash('error', 'Erro ao iniciar sessão')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Encerra uma sessao
   */
  async encerrar({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'encerrada', hora_fim_real = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [params.id])

      session.flash('success', 'Sessão encerrada com sucesso')
    } catch (error) {
      console.error('Erro ao encerrar sessão:', error)
      session.flash('error', 'Erro ao encerrar sessão')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Suspende uma sessao
   */
  async suspender({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'suspensa', updated_at = NOW()
        WHERE id = $1
      `, [params.id])

      session.flash('success', 'Sessão suspensa')
    } catch (error) {
      console.error('Erro ao suspender sessão:', error)
      session.flash('error', 'Erro ao suspender sessão')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Retoma uma sessao suspensa
   */
  async retomar({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'em_andamento', updated_at = NOW()
        WHERE id = $1
      `, [params.id])

      session.flash('success', 'Sessão retomada')
    } catch (error) {
      console.error('Erro ao retomar sessão:', error)
      session.flash('error', 'Erro ao retomar sessão')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Cancela uma sessao
   */
  async cancelar({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { motivo } = request.only(['motivo'])

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessoes
        SET status = 'cancelada', observacoes = COALESCE(observacoes, '') || ' [CANCELADA: ' || $2 || ']', updated_at = NOW()
        WHERE id = $1
      `, [params.id, motivo || 'Sem motivo informado'])

      session.flash('success', 'Sessão cancelada')
    } catch (error) {
      console.error('Erro ao cancelar sessão:', error)
      session.flash('error', 'Erro ao cancelar sessão')
    }

    return response.redirect().toRoute('sessoes.index')
  }

  /**
   * Registra presenca de vereador
   */
  async registrarPresenca({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { vereador_id, tipo_registro } = request.only(['vereador_id', 'tipo_registro'])

    try {
      // Verifica se já existe presença
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".sessao_presencas WHERE sessao_id = $1 AND vereador_id = $2
      `, [params.id, vereador_id])

      if (existente.rows.length > 0) {
        // Atualiza
        await db.rawQuery(`
          UPDATE "${schemaName}".sessao_presencas
          SET tipo_registro = $3, presente = true, hora_entrada = NOW(), updated_at = NOW()
          WHERE sessao_id = $1 AND vereador_id = $2
        `, [params.id, vereador_id, tipo_registro || 'manual'])
      } else {
        // Insere
        await db.rawQuery(`
          INSERT INTO "${schemaName}".sessao_presencas (sessao_id, vereador_id, tipo_registro, presente, hora_entrada, created_at)
          VALUES ($1, $2, $3, true, NOW(), NOW())
        `, [params.id, vereador_id, tipo_registro || 'manual'])
      }

      session.flash('success', 'Presença registrada')
    } catch (error) {
      console.error('Erro ao registrar presença:', error)
      session.flash('error', 'Erro ao registrar presença')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Remove presenca de vereador
   */
  async removerPresenca({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const { vereador_id } = request.only(['vereador_id'])

    try {
      await db.rawQuery(`
        UPDATE "${schemaName}".sessao_presencas
        SET presente = false, hora_saida = NOW(), updated_at = NOW()
        WHERE sessao_id = $1 AND vereador_id = $2
      `, [params.id, vereador_id])

      session.flash('success', 'Presença removida')
    } catch (error) {
      console.error('Erro ao remover presença:', error)
      session.flash('error', 'Erro ao remover presença')
    }

    return response.redirect().toRoute('sessoes.show', { id: params.id })
  }

  /**
   * Pagina de controle de presencas
   */
  async presencas({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const sessaoResult = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.id = $1
    `, [params.id])

    if (sessaoResult.rows.length === 0) {
      session.flash('error', 'Sessão não encontrada')
      return response.redirect().toRoute('sessoes.index')
    }

    // Busca todos os vereadores ativos
    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.foto_url, v.numero_cadeira,
        p.sigla as partido_sigla,
        pr.id as presenca_id, pr.hora_entrada, pr.tipo_registro as presenca_tipo, pr.presente
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      LEFT JOIN "${schemaName}".sessao_presencas pr ON pr.vereador_id = v.id AND pr.sessao_id = $1
      WHERE v.status = 'ativo'
      ORDER BY v.numero_cadeira ASC, v.nome ASC
    `, [params.id])

    const totalVereadores = vereadores.rows.length
    const presentes = vereadores.rows.filter((v: any) => v.presente === true).length
    const quorumMinimo = Math.ceil(totalVereadores / 2) + 1

    return view.render('pages/sessoes/presencas', {
      sessao: sessaoResult.rows[0],
      vereadores: vereadores.rows,
      quorum: {
        total: totalVereadores,
        presentes,
        minimo: quorumMinimo,
        atingido: presentes >= quorumMinimo
      }
    })
  }

  /**
   * API: Lista sessoes (JSON)
   */
  async list({ response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT s.id, s.numero, s.tipo, s.data, s.hora_inicio_prevista, s.status,
        l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      ORDER BY s.data DESC
      LIMIT 50
    `)

    return response.json(result.rows)
  }

  /**
   * API: Sessao atual em andamento
   */
  async atual({ response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT s.*, l.numero as legislatura_numero
      FROM "${schemaName}".sessoes s
      LEFT JOIN "${schemaName}".legislaturas l ON s.legislatura_id = l.id
      WHERE s.status = 'em_andamento'
      ORDER BY s.data DESC
      LIMIT 1
    `)

    if (result.rows.length === 0) {
      return response.json({ sessao: null, message: 'Nenhuma sessão em andamento' })
    }

    // Busca presenças
    const presencas = await db.rawQuery(`
      SELECT p.*, v.nome, v.nome_parlamentar
      FROM "${schemaName}".sessao_presencas p
      JOIN "${schemaName}".vereadores v ON p.vereador_id = v.id
      WHERE p.sessao_id = $1 AND p.presente = true
    `, [result.rows[0].id])

    return response.json({
      sessao: result.rows[0],
      presencas: presencas.rows
    })
  }
}
